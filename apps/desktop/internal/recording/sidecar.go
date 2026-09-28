package recording

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// Runner is the part of process.Supervisor the sidecar adapter uses: every child it starts is in the app's Job Object,
// so it dies with the app.
type Runner interface {
	Run(ctx context.Context, program string, args ...string) (int, string, string, error)
	StartStream(ctx context.Context, onLine func(string), program string, args ...string) (*process.StreamChild, error)
}

// SidecarConfig is how to run the teleprompter sidecar: the program and the arguments before its own (a developer run is
// `python live_asr.py`; the packaged app runs the frozen executable with none).
type SidecarConfig struct {
	Program string
	Prefix  []string
	// SessionDir holds the stop files.
	SessionDir string
}

// Sidecar is the Engine over one capture port row, run in the teleprompter sidecar (`live_asr.py --capture <row>`):
// `--list-devices`, `--meter` and `--record` (ADR 0357, 0455). It depends on the row's name and level only; what the row
// opens is the sidecar's business.
type Sidecar struct {
	backend captureport.Backend
	config  SidecarConfig
	runner  Runner
}

// NewSidecar is the sidecar engine for backend.
func NewSidecar(backend captureport.Backend, config SidecarConfig, runner Runner) *Sidecar {
	return &Sidecar{backend: backend, config: config, runner: runner}
}

// Backend is the capture row it records through.
func (e *Sidecar) Backend() captureport.Backend { return e.backend }

func (e *Sidecar) args(own ...string) []string {
	return append(append(append([]string{}, e.config.Prefix...), own...), "--capture", e.backend.Name())
}

func (e *Sidecar) configured() error {
	if e.config.Program == "" || e.runner == nil {
		return errors.New("configure the teleprompter executable before recording")
	}
	return nil
}

// Devices runs `--list-devices --capture <row>` once; see Engine.Devices.
func (e *Sidecar) Devices(ctx context.Context) ([]Device, string, error) {
	if err := e.configured(); err != nil {
		return nil, "", err
	}
	code, out, stderr, err := e.runner.Run(ctx, e.config.Program, e.args("--list-devices")...)
	if err != nil {
		return nil, err.Error(), nil
	}
	if code != 0 {
		return nil, lastLine(stderr, fmt.Sprintf("Could not list input devices (exit code %d).", code)), nil
	}
	var result struct {
		Devices []Device `json:"devices"`
		Error   *string  `json:"error"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &result); err != nil {
		return nil, "the recorder returned an unreadable device list", nil
	}
	message := ""
	if result.Error != nil {
		message = *result.Error
	}
	return result.Devices, message, nil
}

// Meter runs `--meter --mic <device> --capture <row>` until stopped.
func (e *Sidecar) Meter(device string, events Events) (Run, error) {
	return e.start(events, "The microphone level stopped unexpectedly.", "--meter", "--mic", device)
}

// Record runs `--record <path> --mic <device> --capture <row>` until stopped.
func (e *Sidecar) Record(device, path string, events Events) (Run, error) {
	return e.start(events, "The recorder stopped unexpectedly.", "--record", path, "--mic", device)
}

func (e *Sidecar) start(events Events, fallback string, own ...string) (Run, error) {
	if err := e.configured(); err != nil {
		return nil, err
	}
	dir := e.config.SessionDir
	if dir == "" {
		dir = os.TempDir()
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	stopFile := filepath.Join(dir, fmt.Sprintf("recorder_%d.stop", time.Now().UnixNano()))
	_ = os.Remove(stopFile)
	run := &sidecarRun{stopFile: stopFile, fallback: fallback, done: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	child, err := e.runner.StartStream(ctx, func(line string) { relay(line, events) }, e.config.Program, e.args(append(own, "--stop-file", stopFile)...)...)
	if err != nil {
		cancel()
		return nil, err
	}
	run.child = child
	go run.watch(cancel)
	return run, nil
}

// relay hands the sidecar's level and recorded events to events; any other line is not the recorder's.
func relay(line string, events Events) {
	var head struct {
		Type string `json:"type"`
	}
	if json.Unmarshal([]byte(line), &head) != nil {
		return
	}
	switch head.Type {
	case "level":
		var level Level
		if events.Level != nil && json.Unmarshal([]byte(line), &level) == nil {
			events.Level(level)
		}
	case "recorded":
		var result Result
		if events.Recorded != nil && json.Unmarshal([]byte(line), &result) == nil {
			events.Recorded(result)
		}
	}
}

type sidecarRun struct {
	child    *process.StreamChild
	stopFile string
	mu       sync.Mutex
	// +checklocks:mu
	fallback string
	// +checklocks:mu
	stopping bool
	// +checklocks:mu
	failure string
	done    chan struct{}
}

func (r *sidecarRun) Stop() {
	r.mu.Lock()
	r.stopping = true
	r.mu.Unlock()
	_ = os.WriteFile(r.stopFile, nil, 0o600)
}

func (r *sidecarRun) Kill() { _ = r.child.Kill() }

func (r *sidecarRun) Done() <-chan struct{} { return r.done }

func (r *sidecarRun) Failure() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.failure
}

func (r *sidecarRun) watch(cancel context.CancelFunc) {
	<-r.child.Done()
	cancel()
	code, _ := r.child.ExitCode()
	_ = os.Remove(r.stopFile)
	r.mu.Lock()
	if code != 0 && !r.stopping {
		r.failure = lastLine(r.child.StderrTail(), r.fallback)
	}
	r.mu.Unlock()
	close(r.done)
}

// lastLine is stderr's last non-empty line (the sidecar's sentence), capped, or fallback.
func lastLine(stderr, fallback string) string {
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if line := strings.TrimSpace(lines[index]); line != "" {
			if len(line) > 300 {
				line = line[:300]
			}
			return line
		}
	}
	return fallback
}
