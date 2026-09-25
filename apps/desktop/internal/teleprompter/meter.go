package teleprompter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// The level meter (read-aloud-control-bar PRD Phase 4, Q6 A): a second, separate sidecar child, `live_asr.py --meter`, that
// opens the chosen microphone and prints only `level` events, with no model and no script, so the narrator can check the
// microphone before Start. At most one runs; it is refused while a session runs, stopped when a session starts, when the UI
// asks (the microphone popover closes) and on shutdown. Its levels go out on the session's own event channel, so the UI
// reads one `level` stream whichever child measured it. When it ends, the host adds one `meter_stopped` event, with the
// sidecar's last stderr line as `error` when it ended by itself on a failure (a microphone that would not open).

// meterEventType is the one sidecar event the meter relays; meterStoppedType is the event the host adds when it ends.
const (
	meterEventType   = "level"
	meterStoppedType = "meter_stopped"
)

type meterRun struct {
	child    *process.StreamChild
	stopFile string
	stopping bool
	finished chan struct{}
}

// Metering reports whether a meter child is running.
func (s *Service) Metering() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.meter != nil
}

// MeterStart starts the level meter on device, replacing a meter already running (at most one). It is refused while a
// session is starting, running or stopping: the session reports its own levels.
func (s *Service) MeterStart(device string) error {
	device = strings.TrimSpace(device)
	if device == "" {
		return errors.New("choose a microphone")
	}
	s.mu.RLock()
	python, backend, sidecars, sessionDir := s.config.Python, s.config.Backend, s.sidecars, s.config.SessionDir
	phase, _ := s.state["phase"].(string)
	s.mu.RUnlock()
	if python == "" || sidecars == nil {
		return errors.New("configure the teleprompter executable before continuing")
	}
	if active(phase) {
		return errors.New("the reading session is using the microphone; its level shows in the bar")
	}
	s.stopMeterAndWait()

	stopFile := filepath.Join(sessionDir, fmt.Sprintf("teleprompter_meter_%d.stop", time.Now().UnixNano()))
	args := []string{"--meter", "--mic", device, "--stop-file", stopFile}
	if backend != "" {
		args = append([]string{backend}, args...)
	}
	_ = os.MkdirAll(sessionDir, 0o755)
	_ = os.Remove(stopFile)
	ctx, cancel := context.WithCancel(context.Background())
	child, err := sidecars.StartStream(ctx, s.onMeterLine, python, args...)
	if err != nil {
		cancel()
		return err
	}
	run := &meterRun{child: child, stopFile: stopFile, finished: make(chan struct{})}
	s.mu.Lock()
	phase, _ = s.state["phase"].(string)
	if active(phase) || s.meter != nil { // a session or another meter started while this one was launching
		s.mu.Unlock()
		_ = child.Kill()
		<-child.Done()
		cancel()
		_ = os.Remove(stopFile)
		return errors.New("the microphone is already in use")
	}
	s.meter = run
	s.mu.Unlock()
	go s.watchMeter(run, cancel)
	return nil
}

// MeterStop asks a running meter to end and returns at once; it is killed if it has not ended after the grace period.
func (s *Service) MeterStop() {
	s.stopMeter()
}

func (s *Service) stopMeter() *meterRun {
	s.mu.Lock()
	run, grace := s.meter, s.grace
	if run == nil || run.stopping {
		s.mu.Unlock()
		return run
	}
	run.stopping = true
	s.mu.Unlock()
	_ = os.WriteFile(run.stopFile, nil, 0o600)
	go func() {
		select {
		case <-run.child.Done():
		case <-time.After(grace):
			_ = run.child.Kill()
		}
	}()
	return run
}

// stopMeterAndWait stops a running meter and waits until it has released the microphone and been recorded as gone.
func (s *Service) stopMeterAndWait() {
	run := s.stopMeter()
	if run == nil {
		return
	}
	s.mu.RLock()
	grace := s.grace
	s.mu.RUnlock()
	select {
	case <-run.finished:
	case <-time.After(grace + 2*time.Second):
		_ = run.child.Kill()
		<-run.finished
	}
}

func (s *Service) watchMeter(run *meterRun, cancel context.CancelFunc) {
	<-run.child.Done()
	cancel()
	code, _ := run.child.ExitCode()
	s.mu.Lock()
	if s.meter == run {
		s.meter = nil
	}
	stopping := run.stopping
	s.mu.Unlock()
	_ = os.Remove(run.stopFile)
	var failure any
	if !stopping && code != 0 {
		failure = failureMessage(code, run.child.StderrTail(), "The microphone level stopped unexpectedly")
	}
	close(run.finished)
	if s.emit != nil {
		if raw, err := json.Marshal(map[string]any{"type": meterStoppedType, "error": failure}); err == nil {
			s.emit(raw)
		}
	}
}

// onMeterLine relays the meter's `level` events and nothing else: the meter has no session, so any other event is not
// the UI's to see.
func (s *Service) onMeterLine(line string) {
	raw := json.RawMessage(line)
	if !json.Valid(raw) {
		return
	}
	if kind, ok := isEvent(raw); ok && kind == meterEventType && s.emit != nil {
		s.emit(raw)
	}
}
