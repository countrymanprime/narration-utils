package recording

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// The recorder's phases on the wire.
const (
	PhaseIdle      = "idle"
	PhaseMetering  = "metering"
	PhaseRecording = "recording"
	PhaseStopping  = "stopping"
)

// Config is what one project's recorder needs.
type Config struct {
	// Project is the project folder; the takes live in its Recordings folder. "" is no project: nothing records.
	Project string
	// Grace is how long a stopped run may take to end before it is killed (default 10 s: a take flushes its file).
	Grace time.Duration
	// Now is the clock (default time.Now).
	Now func() time.Time
}

// LastTake is how the most recent take ended, for the Booth to say so once.
type LastTake struct {
	Name      string  `json:"name"`
	Seconds   float64 `json:"seconds"`
	Dropouts  int     `json:"dropouts"`
	Clipped   int64   `json:"clipped"`
	LatencyMs float64 `json:"latencyMs"`
	// Error says why it ended by itself, or why its file kept its partial name; nil for a clean take.
	Error *string `json:"error"`
	// Unfinished marks a take left under its partial name.
	Unfinished bool `json:"unfinished"`
}

// State is the recorder's snapshot, the "recording:state" payload's recorder half (the host adds the engine choice).
type State struct {
	Phase  string `json:"phase"`
	Device string `json:"device"`
	// Folder is the project's Recordings folder, "" without a project.
	Folder string `json:"folder"`
	// Take is the name of the take being recorded, nil otherwise.
	Take *string `json:"take"`
	// StartedAt is when it started, Unix milliseconds, nil otherwise.
	StartedAt *int64 `json:"startedAt"`
	// Message is the last problem, in a sentence ("" for none); cleared by the next start.
	Message string    `json:"message"`
	Last    *LastTake `json:"last"`
	Takes   []Take    `json:"takes"`
}

type runKind int

const (
	meterRun runKind = iota
	takeRun
)

type active struct {
	run      Run
	kind     runKind
	device   string
	number   int
	partial  string
	started  time.Time
	stopping bool
	result   *Result
	watched  chan struct{} // closed once watch has recorded the end
}

// Service is one project's recorder. At most one run (a meter or a take) is active.
type Service struct {
	mu        sync.Mutex
	config    Config
	engine    Engine
	emitState func(State)
	emitLevel func(Level)
	// +checklocks:mu
	current *active
	message string
	device  string
	last    *LastTake
}

// New is a recorder for config over engine. emitState gets every change and emitLevel every level report; either may be
// nil. A nil engine makes a recorder that lists no takes' devices and refuses to start.
func New(config Config, engine Engine, emitState func(State), emitLevel func(Level)) *Service {
	if config.Grace <= 0 {
		config.Grace = 10 * time.Second
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &Service{config: config, engine: engine, emitState: emitState, emitLevel: emitLevel}
}

// Engine is the engine it records through (nil when there is none).
func (s *Service) Engine() Engine { return s.engine }

// Folder is the project's Recordings folder, "" without a project.
func (s *Service) Folder() string {
	if s.config.Project == "" {
		return ""
	}
	return filepath.Join(s.config.Project, FolderName)
}

// Snapshot is the recorder's state now, with the folder's takes read fresh.
func (s *Service) Snapshot() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

// +checklocks:s.mu
func (s *Service) snapshotLocked() State {
	state := State{Phase: PhaseIdle, Device: s.device, Folder: s.Folder(), Message: s.message, Last: s.last, Takes: []Take{}}
	except := ""
	if a := s.current; a != nil {
		state.Device = a.device
		switch {
		case a.kind == meterRun:
			state.Phase = PhaseMetering
		case a.stopping:
			state.Phase = PhaseStopping
		default:
			state.Phase = PhaseRecording
		}
		if a.kind == takeRun {
			name := takeName(a.number)
			started := a.started.UnixMilli()
			state.Take, state.StartedAt, except = &name, &started, a.partial
		}
	}
	if folder := state.Folder; folder != "" {
		if takes, _, err := listTakes(folder, except); err == nil {
			state.Takes = takes
		} else if state.Message == "" {
			state.Message = fmt.Sprintf("Could not read the takes in %s: %v", folder, err)
		}
	}
	return state
}

func (s *Service) publish() {
	if s.emitState == nil {
		return
	}
	s.emitState(s.Snapshot())
}

// Devices lists the engine's input devices; see Engine.Devices.
func (s *Service) Devices(ctx context.Context) ([]Device, string, error) {
	if s.engine == nil {
		return nil, "", errors.New("the built-in recorder is unavailable in this build")
	}
	devices, message, err := s.engine.Devices(ctx)
	if devices == nil {
		devices = []Device{}
	}
	return devices, message, err
}

func (s *Service) ready(device string) (string, error) {
	device = strings.TrimSpace(device)
	switch {
	case s.config.Project == "":
		return "", errors.New("open a project before recording: its takes are saved in the project folder")
	case s.engine == nil:
		return "", errors.New("the built-in recorder is unavailable in this build")
	case device == "":
		return "", errors.New("choose a microphone")
	}
	return device, nil
}

// Meter shows device's level before a take, replacing a meter already running. It is refused while a take records:
// the take reports its own level.
func (s *Service) Meter(device string) error {
	device, err := s.ready(device)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if a := s.current; a != nil && a.kind == takeRun {
		s.mu.Unlock()
		return errors.New("a take is recording; its level shows in the Booth")
	}
	s.mu.Unlock()
	s.stopAndWait()
	run, err := s.engine.Meter(device, Events{Level: s.level})
	if err != nil {
		return err
	}
	return s.adopt(&active{run: run, kind: meterRun, device: device, watched: make(chan struct{})})
}

// StopMeter ends a running meter; it does nothing while a take records or when nothing runs.
func (s *Service) StopMeter() {
	s.mu.Lock()
	a := s.current
	s.mu.Unlock()
	if a != nil && a.kind == meterRun {
		s.stop(a)
	}
}

// Start records a new take of device into the Recordings folder, stopping a meter first. The take is "Take NNN", one
// past the highest number in the folder (a partial counts), so no name is ever reused.
func (s *Service) Start(device string) error {
	device, err := s.ready(device)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if a := s.current; a != nil && a.kind == takeRun {
		s.mu.Unlock()
		return errors.New("a take is already recording")
	}
	s.mu.Unlock()
	s.stopAndWait()

	folder := s.Folder()
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return fmt.Errorf("could not create the Recordings folder: %w", err)
	}
	_, highest, err := listTakes(folder, "")
	if err != nil {
		return fmt.Errorf("could not read the Recordings folder: %w", err)
	}
	number := highest + 1
	partial := partialPath(folder, number)
	if _, err := os.Lstat(finishedPath(folder, number)); err == nil {
		return fmt.Errorf("%s already exists", filepath.Base(finishedPath(folder, number)))
	}
	a := &active{kind: takeRun, device: device, number: number, partial: partial, watched: make(chan struct{})}
	run, err := s.engine.Record(device, partial, Events{Level: s.level, Recorded: func(result Result) {
		s.mu.Lock()
		a.result = &result
		s.mu.Unlock()
	}})
	if err != nil {
		return err
	}
	a.run, a.started = run, s.config.Now()
	return s.adopt(a)
}

// adopt makes a the active run and watches it; a run that lost a race with another start is killed.
func (s *Service) adopt(a *active) error {
	s.mu.Lock()
	if s.current != nil {
		s.mu.Unlock()
		a.run.Kill()
		<-a.run.Done()
		return errors.New("the microphone is already in use")
	}
	s.current, s.device, s.message = a, a.device, ""
	s.mu.Unlock()
	go s.watch(a)
	s.publish()
	return nil
}

// Stop asks the running take (or meter) to end and returns at once; the take's end arrives as a state change.
func (s *Service) Stop() {
	s.mu.Lock()
	a := s.current
	s.mu.Unlock()
	if a != nil {
		s.stop(a)
	}
}

func (s *Service) stop(a *active) {
	s.mu.Lock()
	if a.stopping {
		s.mu.Unlock()
		return
	}
	a.stopping = true
	grace := s.config.Grace
	s.mu.Unlock()
	a.run.Stop()
	if a.kind == takeRun {
		s.publish()
	}
	go func() {
		select {
		case <-a.run.Done():
		case <-time.After(grace):
			a.run.Kill()
		}
	}()
}

// stopAndWait stops the active run and waits until it has released the device and been recorded as gone.
func (s *Service) stopAndWait() {
	s.mu.Lock()
	a := s.current
	s.mu.Unlock()
	if a == nil {
		return
	}
	s.stop(a)
	<-a.watched
}

// Close stops the active run, a take included, and waits for it (the app is quitting or the project changing).
func (s *Service) Close(ctx context.Context) error {
	s.mu.Lock()
	a := s.current
	s.mu.Unlock()
	if a == nil {
		return nil
	}
	s.stop(a)
	select {
	case <-a.watched:
		return nil
	case <-ctx.Done():
		a.run.Kill()
		<-a.watched
		return ctx.Err()
	}
}

// Busy reports whether a take is recording or finishing (a meter is not work a project switch would lose).
func (s *Service) Busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.current != nil && s.current.kind == takeRun
}

func (s *Service) level(level Level) {
	if s.emitLevel != nil {
		s.emitLevel(level)
	}
}

func (s *Service) watch(a *active) {
	<-a.run.Done()
	failure := a.run.Failure()
	s.mu.Lock()
	result, stopping := a.result, a.stopping
	s.mu.Unlock()
	var last *LastTake
	message := ""
	if a.kind == meterRun {
		if !stopping && failure != "" {
			message = failure
		}
	} else {
		last, message = s.settle(a, result, failure)
	}
	s.mu.Lock()
	if s.current == a {
		s.current = nil
	}
	if message != "" {
		s.message = message
	}
	if last != nil {
		s.last = last
	}
	s.mu.Unlock()
	close(a.watched)
	s.publish()
}

// settle gives a finished take its name and says how it went. A partial holding no audio (a device that never opened,
// or 0 frames) is removed: it is a header and nothing else. Anything with audio is kept, under its partial name when
// it could not be finished.
func (s *Service) settle(a *active, result *Result, failure string) (*LastTake, string) {
	name := takeName(a.number)
	if format, err := readWavFormat(a.partial); (result != nil && result.Frames == 0) || (result == nil && (err != nil || format.dataBytes == 0)) {
		_ = os.Remove(a.partial)
		if failure == "" && result != nil && result.Error != nil {
			failure = *result.Error
		}
		if failure == "" {
			failure = "Nothing was recorded."
		}
		return nil, failure
	}
	if result == nil {
		if failure == "" {
			failure = "The recorder ended without finishing the take."
		}
		text := failure + " The audio before it is kept as " + filepath.Base(a.partial) + "."
		return &LastTake{Name: name, Error: &text, Unfinished: true}, text
	}
	last := &LastTake{Name: name, Seconds: result.Seconds, Dropouts: result.Dropouts(), Clipped: result.Clipped, LatencyMs: result.LatencyMs, Error: result.Error}
	if err := finish(a.partial, finishedPath(filepath.Dir(a.partial), a.number)); err != nil {
		text := err.Error()
		last.Error, last.Unfinished = &text, true
		return last, text
	}
	if result.Error != nil {
		return last, *result.Error
	}
	return last, ""
}

// TakePath answers the take file at path when it is one of this project's listed takes (finished or unfinished, not the
// one recording now), as the service's own copy of the path, so the media route plays only a take this list vouches for.
func (s *Service) TakePath(path string) (string, bool) {
	state := s.Snapshot()
	clean := filepath.Clean(path)
	for _, take := range state.Takes {
		if strings.EqualFold(filepath.Clean(take.Path), clean) {
			return take.Path, true
		}
	}
	return "", false
}
