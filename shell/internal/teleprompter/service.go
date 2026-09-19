// Package teleprompter owns one live teleprompter session: it launches the
// streaming sidecar, relays each NDJSON event it prints to the frontend
// verbatim, and keeps just enough state (phase, the script description, the
// latest position) for a view that opens mid-session to catch up. Mic capture
// and speech recognition stay in the sidecar; this package owns the process
// lifecycle only, and introduces no server, port or polling.
package teleprompter

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

	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// defaultGrace is how long a stopping sidecar gets to flush and exit on its
// own before it is killed.
const defaultGrace = 8 * time.Second

// supportedEngines are the live engines the desktop host can launch today.
var supportedEngines = map[string]bool{"whisper": true}

type Config struct{ Project, SessionDir, Python, Backend string }

type Service struct {
	mu       sync.RWMutex
	config   Config
	sidecars *process.Supervisor
	emit     func(json.RawMessage)
	changed  func(map[string]any)
	grace    time.Duration

	state    map[string]any
	script   json.RawMessage
	position json.RawMessage
	child    *process.StreamChild
	stopFile string
	stopping bool
	// finished is closed by the watcher once it has recorded the session's
	// final state, which is later than the child process exiting.
	finished chan struct{}
}

// New builds the service. emit receives every JSON line the sidecar prints;
// changed receives a state snapshot whenever the phase changes.
func New(config Config, sidecars *process.Supervisor, emit func(json.RawMessage), changed func(map[string]any)) *Service {
	return &Service{config: config, sidecars: sidecars, emit: emit, changed: changed, grace: defaultGrace, state: idleState()}
}

func idleState() map[string]any {
	return map[string]any{"phase": "idle", "message": "Choose a chapter to start the teleprompter.", "engine": nil, "chapter": nil}
}

func active(phase string) bool {
	return phase == "starting" || phase == "running" || phase == "stopping"
}

func decodeOrNil(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

func (s *Service) snapshotLocked() map[string]any {
	result := make(map[string]any, len(s.state)+2)
	for key, value := range s.state {
		result[key] = value
	}
	result["script"], result["position"] = decodeOrNil(s.script), decodeOrNil(s.position)
	return result
}

// Snapshot is the current state, including the last script description and
// position event so a view that opens mid-session can catch up.
func (s *Service) Snapshot() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}

// Busy reports whether a session is starting, running or stopping; the host
// must not detach from REAPER while one is.
func (s *Service) Busy() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	phase, _ := s.state["phase"].(string)
	return active(phase)
}

func (s *Service) notify() {
	if s.changed != nil {
		s.changed(s.Snapshot())
	}
}

func option(options map[string]string, key, fallback string) string {
	if value := strings.TrimSpace(options[key]); value != "" {
		return value
	}
	return fallback
}

type launch struct {
	args                      []string
	engine, chapter, stopFile string
}

// plan validates a request and builds the sidecar arguments. It has no side
// effects, so a rejected request leaves the service exactly as it was.
func (s *Service) plan(options map[string]string) (launch, error) {
	if s.config.Project == "" {
		return launch{}, errors.New("save the REAPER project and import a manuscript first")
	}
	manuscript := filepath.Join(s.config.Project, "narration-utils", "manuscript", "manuscript.json")
	if _, err := os.Stat(manuscript); err != nil {
		return launch{}, errors.New("import a manuscript first")
	}
	chapter := option(options, "chapter", "")
	if chapter == "" {
		return launch{}, errors.New("choose a chapter to read")
	}
	engine := option(options, "engine", "whisper")
	if !supportedEngines[engine] {
		return launch{}, fmt.Errorf("the %s engine is not available yet", engine)
	}
	device, wav := option(options, "device", ""), option(options, "wav", "")
	if device == "" && wav == "" {
		return launch{}, errors.New("choose a microphone")
	}
	if s.config.Python == "" || s.sidecars == nil {
		return launch{}, errors.New("configure the teleprompter executable before continuing")
	}

	stopFile := filepath.Join(s.config.SessionDir, fmt.Sprintf("teleprompter_%d.stop", time.Now().UnixNano()))
	args := []string{"--engine", engine, "--model", option(options, "model", "small"), "--manuscript", manuscript, "--chapter", chapter, "--stop-file", stopFile}
	if modelDir := option(options, "modelDir", ""); modelDir != "" {
		args = append(args, "--model-dir", modelDir)
	}
	if language := option(options, "language", ""); language != "" {
		args = append(args, "--language", language)
	}
	if wav != "" {
		args = append(args, "--wav", wav)
	} else {
		args = append(args, "--mic", device)
	}
	if s.config.Backend != "" {
		args = append([]string{s.config.Backend}, args...)
	}
	return launch{args: args, engine: engine, chapter: chapter, stopFile: stopFile}, nil
}

// Start launches a session for one chapter.
func (s *Service) Start(options map[string]string) error {
	plan, err := s.plan(options)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if phase, _ := s.state["phase"].(string); active(phase) {
		s.mu.Unlock()
		return errors.New("a teleprompter session is already running")
	}
	s.state = map[string]any{"phase": "starting", "message": "Starting the teleprompter…", "engine": plan.engine, "chapter": plan.chapter}
	s.script, s.position, s.stopping, s.stopFile = nil, nil, false, plan.stopFile
	s.mu.Unlock()
	s.notify()

	_ = os.MkdirAll(s.config.SessionDir, 0o755)
	_ = os.Remove(plan.stopFile)
	ctx, cancel := context.WithCancel(context.Background())
	child, err := s.sidecars.StartStream(ctx, s.onLine, s.config.Python, plan.args...)
	if err != nil {
		cancel()
		s.fail(err.Error())
		return err
	}
	finished := make(chan struct{})
	s.mu.Lock()
	s.child, s.finished = child, finished
	s.state["phase"], s.state["message"] = "running", "Listening…"
	s.mu.Unlock()
	s.notify()
	go s.watch(child, cancel, finished)
	return nil
}

func (s *Service) fail(message string) {
	s.mu.Lock()
	s.state["phase"], s.state["message"] = "error", message
	s.mu.Unlock()
	s.notify()
}

// onLine handles one stdout line. Anything that is not a JSON value is stray
// output (a library print) and is dropped; the rest is relayed unchanged.
func (s *Service) onLine(line string) {
	if !json.Valid([]byte(line)) {
		return
	}
	raw := json.RawMessage(line)
	var head struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(raw, &head)
	switch head.Type {
	case "script":
		s.mu.Lock()
		s.script = raw
		s.mu.Unlock()
	case "position":
		s.mu.Lock()
		s.position = raw
		s.mu.Unlock()
	}
	if s.emit != nil {
		s.emit(raw)
	}
}

func failureMessage(code int, stderr string) string {
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if line := strings.TrimSpace(lines[index]); line != "" {
			if len(line) > 300 {
				line = line[:300]
			}
			return line
		}
	}
	return fmt.Sprintf("The teleprompter stopped unexpectedly (exit code %d).", code)
}

func (s *Service) watch(child *process.StreamChild, cancel context.CancelFunc, finished chan struct{}) {
	<-child.Done()
	cancel()
	code, _ := child.ExitCode()
	s.mu.Lock()
	stopFile := s.stopFile
	if s.stopping || code == 0 {
		s.state["phase"], s.state["message"] = "stopped", "Stopped."
	} else {
		s.state["phase"], s.state["message"] = "error", failureMessage(code, child.StderrTail())
	}
	s.child, s.stopping = nil, false
	s.mu.Unlock()
	close(finished)
	_ = os.Remove(stopFile)
	s.notify()
}

// Stop asks the sidecar to finish (it flushes what it heard, then exits) by
// creating its stop file, and kills it if it has not exited after the grace
// period. It returns immediately; the phase reaches "stopped" when it is done.
func (s *Service) Stop() {
	s.mu.Lock()
	child := s.child
	if child == nil || s.stopping {
		s.mu.Unlock()
		return
	}
	s.stopping = true
	s.state["phase"], s.state["message"] = "stopping", "Stopping…"
	stopFile, grace := s.stopFile, s.grace
	s.mu.Unlock()
	s.notify()

	_ = os.WriteFile(stopFile, nil, 0o600)
	go func() {
		select {
		case <-child.Done():
		case <-time.After(grace):
			_ = child.Kill()
		}
	}()
}

// Close stops any session and waits for the sidecar to be gone, for host
// shutdown.
func (s *Service) Close(ctx context.Context) error {
	s.Stop()
	s.mu.RLock()
	child, grace, finished := s.child, s.grace, s.finished
	s.mu.RUnlock()
	if child == nil {
		return nil
	}
	select {
	case <-finished:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(grace + 2*time.Second):
		_ = child.Kill()
		return errors.New("the teleprompter did not stop in time")
	}
}
