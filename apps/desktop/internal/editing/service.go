// This file is Phase 5 of docs/prds/editing-readiness-analysis.prd.md: the
// narrator-triggered scan. It resolves a chapter to its confirmed track and
// items (D5), decodes only what the cache does not already answer
// (Architecture Notes: "cache lookup per item, decode only misses in one
// pass writing the three ledger records"), composes empty space over the
// result (Phase 3), persists silence_cleanup findings, and reports real
// progress with a cancel button (ADR 0015). Unlike the recording coverage
// service (apps/desktop/internal/coverage), there is no sidecar: every
// decode is this package's own Decode (decode.go), so the job is a plain Go
// goroutine over context cancellation rather than a supervised child
// process.
package editing

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// AnalyzerVersion is this package's own analyzer version, stamped on every
// ledger record it writes and compared by CurrentItemRecord and, in Phase 6,
// the validated-detector gate for clicks and breaths. It has no exported
// "validated" registry (Phase 4, the click/breath corpus validation, is out
// of scope for this pass): the empty-space class alone reaches met/not_met;
// clicks and breaths always read unknown regardless of this string's value,
// by Phase 6's own design, not because this version happens to be absent
// from some list.
const AnalyzerVersion = "editing-v1"

// Reason is a typed refusal this service can answer before it even starts a
// scan: the chapter cannot be resolved to exactly one confirmed track and
// its items, or a run is already busy. It mirrors
// apps/desktop/internal/coverage's own Reason/unknown/ReasonOf pattern.
type Reason string

const (
	ReasonUnmapped           Reason = "unmapped"
	ReasonMultipleTracks     Reason = "multiple_tracks"
	ReasonMappedTrackMissing Reason = "mapped_track_missing"
	ReasonNoProject          Reason = "no_project"
	ReasonNoProjectFile      Reason = "no_project_file"
	ReasonProjectUnreadable  Reason = "project_unreadable"
	ReasonBusy               Reason = "busy"
)

type refusalError struct {
	reason  Reason
	message string
}

func (e *refusalError) Error() string { return e.message }

func unknown(reason Reason, message string) error {
	return &refusalError{reason: reason, message: message}
}

func unknownf(reason Reason, format string, args ...any) error {
	return unknown(reason, fmt.Sprintf(format, args...))
}

// ReasonOf reports err's Reason, when it is one this package raised.
func ReasonOf(err error) (Reason, bool) {
	var refusal *refusalError
	if errors.As(err, &refusal) {
		return refusal.reason, true
	}
	return "", false
}

// Phase is where the service's one job is (mirrors coverage.Phase).
type Phase string

const (
	PhaseIdle      Phase = "idle"
	PhaseRunning   Phase = "running"
	PhaseComplete  Phase = "complete"
	PhaseCancelled Phase = "cancelled"
	PhaseFailed    Phase = "failed"
)

// State is the running job as the UI will see it (Phase 5's bindings expose
// this; Phase 7's panel reads it).
type State struct {
	RunID       string     `json:"runId,omitempty"`
	ChapterID   string     `json:"chapterId,omitempty"`
	Phase       Phase      `json:"phase"`
	Percent     float64    `json:"percent"`
	Message     string     `json:"message"`
	ItemsTotal  int        `json:"itemsTotal"`
	ItemsDone   int        `json:"itemsDone"`
	CacheHits   int        `json:"cacheHits"`
	Decoded     int        `json:"decoded"`
	Failed      int        `json:"failed"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

// Request is one editing check run.
type Request struct {
	DocumentID   string
	ChapterID    string
	ChapterTitle string
}

// Config is what the host gives the service when a project is attached.
// Unlike coverage.Config, there is no sidecar launcher: Policy and
// ScanOptions are read fresh at scan-end and per item respectively, so a
// setting change picked up between scans needs no other plumbing.
type Config struct {
	Project     string
	ProjectFile func() (string, error)
	Policy      func() Policy
	ScanOptions func() ScanOptions
	Reporter    *persist.Reporter
}

// Service runs one editing check at a time over one project.
type Service struct {
	config   Config
	ledger   *evidence.LedgerStore
	cache    *evidence.CacheStore
	mapping  *evidence.MappingStore
	findings *findings.Store
	changed  func(State)
	now      func() time.Time

	mu sync.Mutex
	// +checklocks:mu
	busy bool
	// +checklocks:mu
	state State
	// +checklocks:mu
	cancel context.CancelFunc
	// +checklocks:mu
	done chan struct{}
}

// New builds the service for one project. changed, when not nil, hears
// every state change.
func New(config Config, changed func(State)) *Service {
	ledger := evidence.NewLedgerStore(config.Project)
	ledger.Reporter = config.Reporter
	cache := evidence.NewCacheStore(config.Project)
	cache.Reporter = config.Reporter
	mapping := evidence.NewMappingStore(config.Project)
	mapping.Reporter = config.Reporter
	store := findings.NewStore(config.Project)
	store.SetPersist(config.Reporter)
	return &Service{
		config: config, ledger: ledger, cache: cache, mapping: mapping, findings: store,
		changed: changed, now: func() time.Time { return time.Now().UTC() },
		state: State{Phase: PhaseIdle, Message: "Save the REAPER project, then check a chapter's editing."},
	}
}

// State returns the current job's state.
func (s *Service) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

// Busy reports whether a run is in progress.
func (s *Service) Busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busy
}

// Wait blocks until the run in progress, if any, has finished.
func (s *Service) Wait() {
	s.mu.Lock()
	done := s.done
	s.mu.Unlock()
	if done != nil {
		<-done
	}
}

// Cancel asks the running scan to stop after its current item. The items it
// already finished stay cached and ledgered; the run's own state becomes
// PhaseCancelled and the item it did not reach stay whatever they were
// before (never analyzed, or a previous, possibly stale, record).
func (s *Service) Cancel() {
	s.mu.Lock()
	cancel := s.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// Start resolves request's chapter to its confirmed track and items and, if
// that succeeds, starts scanning in the background. It refuses (an error
// ReasonOf can read) rather than starting anything when the chapter is
// unmapped, multiply mapped, or its mapped track is missing from the saved
// project - Phase 5's own scope: "an unconfirmed mapping refuses to start
// and reports why."
func (s *Service) Start(ctx context.Context, request Request) (State, error) {
	s.mu.Lock()
	if s.busy {
		s.mu.Unlock()
		return State{}, unknown(ReasonBusy, "an editing check is already running")
	}
	s.busy = true
	s.mu.Unlock()

	track, project, projectFile, err := s.resolveChapter(request)
	if err != nil {
		s.mu.Lock()
		s.busy = false
		s.mu.Unlock()
		return State{}, err
	}

	runCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	started := s.now()
	state := State{
		RunID: fmt.Sprintf("%d", started.UnixNano()), ChapterID: request.ChapterID, Phase: PhaseRunning,
		ItemsTotal: len(track.Items), StartedAt: &started, Message: "Checking...",
	}
	s.mu.Lock()
	s.cancel, s.done, s.state = cancel, done, state
	s.mu.Unlock()
	s.notify(state)

	go func() {
		defer close(done)
		defer cancel()
		s.run(runCtx, request, track, project, projectFile)
		s.mu.Lock()
		s.busy = false
		s.mu.Unlock()
	}()
	return state, nil
}

// resolveChapter resolves request's chapter to its confirmed track (D5) and
// the saved project it lives in.
func (s *Service) resolveChapter(request Request) (tracks.Track, tracks.Project, evidence.LedgerProjectFile, error) {
	if s.config.Project == "" {
		return tracks.Track{}, tracks.Project{}, evidence.LedgerProjectFile{}, unknown(ReasonNoProject, "open a project before checking editing")
	}
	project, projectFile, err := s.savedProject()
	if err != nil {
		return tracks.Track{}, tracks.Project{}, evidence.LedgerProjectFile{}, err
	}
	trackGUID, err := s.confirmedTrackGUID(request.DocumentID, request.ChapterID)
	if err != nil {
		return tracks.Track{}, tracks.Project{}, evidence.LedgerProjectFile{}, err
	}
	for _, track := range project.Tracks {
		if track.GUID == trackGUID {
			return track, project, projectFile, nil
		}
	}
	return tracks.Track{}, tracks.Project{}, evidence.LedgerProjectFile{}, unknown(ReasonMappedTrackMissing, "the track this chapter is linked to is no longer in the saved project")
}

// confirmedTrackGUID is D5's own rule: exactly one confirmed track for the
// chapter, or the mapping is unknown to this analyzer (ReasonUnmapped for
// zero, ReasonMultipleTracks for more than one).
func (s *Service) confirmedTrackGUID(documentID, chapterID string) (string, error) {
	links, err := s.mapping.List(documentID)
	if err != nil {
		return "", err
	}
	match, count := "", 0
	for _, link := range links {
		if link.ChapterID == chapterID {
			match, count = link.TrackGUID, count+1
		}
	}
	switch count {
	case 0:
		return "", unknown(ReasonUnmapped, "link this chapter to the REAPER track it is edited on")
	case 1:
		return match, nil
	default:
		return "", unknown(ReasonMultipleTracks, "this chapter is linked to more than one REAPER track")
	}
}

func (s *Service) savedProject() (tracks.Project, evidence.LedgerProjectFile, error) {
	if s.config.ProjectFile == nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknown(ReasonNoProjectFile, "no REAPER project file is chosen for this project")
	}
	path, err := s.config.ProjectFile()
	if err != nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknownf(ReasonNoProjectFile, "choose the saved REAPER project file first (%v)", err)
	}
	project, err := tracks.Parse(path)
	if err != nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknownf(ReasonProjectUnreadable, "could not read the saved project: %v", err)
	}
	modTime, statErr := projectModTime(path)
	if statErr != nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknownf(ReasonProjectUnreadable, "could not read the saved project: %v", statErr)
	}
	return project, evidence.LedgerProjectFile{Path: path, ModTime: modTime}, nil
}

func (s *Service) notify(state State) {
	if s.changed != nil {
		s.changed(state)
	}
}

func (s *Service) setState(mutate func(*State)) State {
	s.mu.Lock()
	mutate(&s.state)
	state := s.state
	s.mu.Unlock()
	s.notify(state)
	return state
}
