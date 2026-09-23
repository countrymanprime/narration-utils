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
	report   func(kind, message string)
	grace    time.Duration
	dropped  int

	state       map[string]any
	script      json.RawMessage
	position    json.RawMessage
	child       *process.StreamChild
	stopFile    string
	controlFile string
	stopping    bool
	// afterFunc schedules the auto-stop (time.AfterFunc outside tests); autoStop is the pending one, autoStopRound
	// tells a stale callback from the current one, and autoStopped records that the session ended itself at Done.
	afterFunc     func(time.Duration, func()) stoppable
	autoStop      stoppable
	autoStopRound int
	autoStopped   bool
	// finished is closed by the watcher once it has recorded the session's
	// final state, which is later than the child process exiting.
	finished chan struct{}
}

// New builds the service. emit receives every JSON line the sidecar prints;
// changed receives a state snapshot whenever the phase changes.
func New(config Config, sidecars *process.Supervisor, emit func(json.RawMessage), changed func(map[string]any)) *Service {
	return &Service{config: config, sidecars: sidecars, emit: emit, changed: changed, grace: defaultGrace, state: idleState(), afterFunc: realAfterFunc}
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
	args                                   []string
	engine, chapter, stopFile, controlFile string
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

	stamp := time.Now().UnixNano()
	stopFile := filepath.Join(s.config.SessionDir, fmt.Sprintf("teleprompter_%d.stop", stamp))
	controlFile := filepath.Join(s.config.SessionDir, fmt.Sprintf("teleprompter_%d.control", stamp))
	args := []string{
		"--engine", engine, "--model", option(options, "model", "small"), "--manuscript", manuscript, "--chapter", chapter,
		"--stop-file", stopFile, "--control-file", controlFile,
	}
	if modelDir := option(options, "modelDir", ""); modelDir != "" {
		args = append(args, "--model-dir", modelDir)
	}
	if language := option(options, "language", ""); language != "" {
		args = append(args, "--language", language)
	}
	if startWord := option(options, "startWord", ""); startWord != "" {
		args = append(args, "--start-word", startWord)
	}
	if wav != "" {
		args = append(args, "--wav", wav)
	} else {
		args = append(args, "--mic", device)
	}
	if s.config.Backend != "" {
		args = append([]string{s.config.Backend}, args...)
	}
	return launch{args: args, engine: engine, chapter: chapter, stopFile: stopFile, controlFile: controlFile}, nil
}

// Device is one input device the sidecar's `--list-devices` reported, by the
// same name its capture path (`dshow`) opens it under.
type Device struct {
	Name string `json:"name"`
}

// devicesResult mirrors the sidecar's `--list-devices` NDJSON line:
// {"type":"devices","devices":[...],"error":null}.
type devicesResult struct {
	Devices []Device `json:"devices"`
	Error   *string  `json:"error"`
}

// Devices asks the sidecar to list input devices, honoring ctx's deadline and caching nothing (a fresh list every
// call). It returns a Go error only for a setup problem (the service is not configured); every sidecar-side or
// process-level failure - a bad exit code, a timeout, unparseable output - is folded into the returned message
// instead, the same "never block Start" contract the sidecar's own {"devices": [], "error": ...} shape gives (see
// docs/prds/teleprompter-engines-and-input-devices.prd.md, Architecture Notes).
func (s *Service) Devices(ctx context.Context) ([]Device, string, error) {
	s.mu.RLock()
	python, backend, sidecars := s.config.Python, s.config.Backend, s.sidecars
	s.mu.RUnlock()
	if python == "" || sidecars == nil {
		return nil, "", errors.New("configure the teleprompter executable before continuing")
	}
	args := []string{"--list-devices"}
	if backend != "" {
		args = append([]string{backend}, args...)
	}
	code, out, stderr, err := sidecars.Run(ctx, python, args...)
	if err != nil {
		return nil, err.Error(), nil
	}
	if code != 0 {
		return nil, failureMessage(code, stderr, "Could not list input devices"), nil
	}
	var result devicesResult
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &result); err != nil {
		return nil, "the teleprompter sidecar returned an unreadable device list", nil
	}
	message := ""
	if result.Error != nil {
		message = *result.Error
	}
	return result.Devices, message, nil
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
	s.script, s.position, s.stopping, s.stopFile, s.controlFile = nil, nil, false, plan.stopFile, plan.controlFile
	s.cancelAutoStopLocked()
	s.autoStopped = false
	s.mu.Unlock()
	s.notify()

	_ = os.MkdirAll(s.config.SessionDir, 0o755)
	_ = os.Remove(plan.stopFile)
	_ = os.Remove(plan.controlFile)
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
	s.state["phase"] = "running"
	if s.autoStop == nil { // a done position that arrived while starting has already set the auto-stop message
		s.state["message"] = listeningMessage
	}
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

// alwaysLogDrops and logDropsEvery keep the host log readable when a sidecar prints many broken lines: the first few are
// logged, then one in logDropsEvery.
const (
	alwaysLogDrops = 3
	logDropsEvery  = 100
)

// SetLog gives the service somewhere to say that it dropped a line. It is optional; without it drops are only counted.
func (s *Service) SetLog(report func(kind, message string)) {
	s.mu.Lock()
	s.report = report
	s.mu.Unlock()
}

// Dropped is how many lines this service has dropped because they were JSON but not an event (ADR 0069).
func (s *Service) Dropped() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.dropped
}

// isEvent reports whether raw is a JSON object with a non-empty string `type`, the envelope every event of ADR 0021 has.
func isEvent(raw json.RawMessage) (string, bool) {
	var head struct {
		Type any `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return "", false
	}
	kind, ok := head.Type.(string)
	return kind, ok && kind != ""
}

// drop counts a line that was JSON but not an event and logs it, by count only: a line can hold the narrator's words.
func (s *Service) drop() {
	s.mu.Lock()
	s.dropped++
	count, report := s.dropped, s.report
	s.mu.Unlock()
	if report != nil && (count <= alwaysLogDrops || count%logDropsEvery == 0) {
		report("sidecar_line_dropped", fmt.Sprintf("teleprompter sidecar line %d was JSON but not an event (no string type); it was not relayed", count))
	}
}

// onLine handles one stdout line. Anything that is not a JSON value is stray output (a library print) and is dropped
// silently. A JSON value that is not an event envelope (an object with a string `type`) is dropped, counted and logged.
// The rest is relayed unchanged: the UI checks the rest of each event against its schema (ADR 0022, ADR 0069).
func (s *Service) onLine(line string) {
	if !json.Valid([]byte(line)) {
		return
	}
	raw := json.RawMessage(line)
	kind, ok := isEvent(raw)
	if !ok {
		s.drop()
		return
	}
	switch kind {
	case "script":
		s.mu.Lock()
		s.script = raw
		s.mu.Unlock()
	case positionEventType:
		s.mu.Lock()
		s.position = raw
		changed := s.trackAutoStopLocked(positionStatus(raw) == positionDoneStatus)
		s.mu.Unlock()
		if changed {
			defer s.notify()
		}
	}
	if s.emit != nil {
		s.emit(raw)
	}
}

// failureMessage picks the sidecar's last non-blank stderr line (a Python traceback ends with the useful part), or
// falls back to a generic message naming the exit code when stderr said nothing useful.
func failureMessage(code int, stderr, fallback string) string {
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if line := strings.TrimSpace(lines[index]); line != "" {
			if len(line) > 300 {
				line = line[:300]
			}
			return line
		}
	}
	return fmt.Sprintf("%s (exit code %d).", fallback, code)
}

func (s *Service) watch(child *process.StreamChild, cancel context.CancelFunc, finished chan struct{}) {
	<-child.Done()
	cancel()
	code, _ := child.ExitCode()
	s.mu.Lock()
	stopFile, controlFile := s.stopFile, s.controlFile
	s.cancelAutoStopLocked()
	if s.stopping || code == 0 {
		s.state["phase"], s.state["message"] = "stopped", stoppedMessage
		if s.autoStopped {
			s.state["message"] = autoStoppedMessage
		}
	} else {
		s.state["phase"], s.state["message"] = "error", failureMessage(code, child.StderrTail(), "The teleprompter stopped unexpectedly")
	}
	s.child, s.stopping = nil, false
	s.mu.Unlock()
	close(finished)
	_ = os.Remove(stopFile)
	_ = os.Remove(controlFile)
	s.notify()
}

// Stop asks the sidecar to finish (it flushes what it heard, then exits) by
// creating its stop file, and kills it if it has not exited after the grace
// period. It returns immediately; the phase reaches "stopped" when it is done.
func (s *Service) Stop() {
	s.stop("Stopping…", false)
}

// stop is Stop with the message to show while stopping and whether the session is ending itself at Done (the
// auto-stop), which only changes the final message: the cooperative stop and grace kill are the same (ADR 0022).
func (s *Service) stop(message string, auto bool) {
	s.mu.Lock()
	child := s.child
	if child == nil || s.stopping {
		s.mu.Unlock()
		return
	}
	s.cancelAutoStopLocked()
	s.stopping, s.autoStopped = true, auto
	s.state["phase"], s.state["message"] = "stopping", message
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

// Seek asks a running session's tracker to jump straight to script word
// `word` (the same index space as a position event's `read`/`committed`):
// one line appended to the session's control file, the sidecar's own
// ControlChannel tails it (control_channel.py), same sentinel-file pattern
// as Stop's stop file - no server, no port. It errors if no session is
// running; the caller (TeleprompterSeek) reports that back to the UI.
func (s *Service) Seek(word int) error {
	s.mu.RLock()
	child, controlFile := s.child, s.controlFile
	s.mu.RUnlock()
	if child == nil {
		return errors.New("no teleprompter session is running")
	}
	line, err := json.Marshal(map[string]any{"cmd": "seek", "word": word})
	if err != nil {
		return err
	}
	file, err := os.OpenFile(controlFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err = file.Write(append(line, '\n')); err != nil {
		_ = file.Close() // the write already failed; report that error
		return err
	}
	return file.Close()
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
