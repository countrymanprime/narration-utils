package coverage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// defaultPollInterval is how often a run's progress file and exit are checked.
const defaultPollInterval = 250 * time.Millisecond

// Config is what the host gives the service when a project is attached.
type Config struct {
	// Project is the project folder. Every path a run hands the sidecar is
	// built from it and from the saved project file (threat-model row 4e).
	Project string
	// Python and Backend start the Transcript Compare sidecar, as for
	// transcript.Service (Backend is the script, empty for a frozen sidecar).
	Python  string
	Backend string
	// ProjectFile resolves the saved .rpp the narrator chose for the project
	// (the Tracks page's selection). It must be directly inside Project.
	ProjectFile func() (string, error)
	// LoadManuscript returns the canonical manuscript (manuscript.Service.Load).
	LoadManuscript func() (map[string]any, error)
	// Reporter logs a stored file that cannot be read (ADR 0069); may be nil.
	Reporter *persist.Reporter
}

// Child is a started sidecar: *process.Child satisfies it.
type Child interface {
	HasExited() bool
	ExitCode() (int, bool)
}

// Launcher starts the sidecar. Cancel is the sidecar's own .cancel file, never
// a kill, so it can leave its words files consistent.
type Launcher func(ctx context.Context, program string, args ...string) (Child, error)

// SupervisorLauncher launches through the host's process supervisor, which
// owns the Windows job object that kills the sidecar with the app.
func SupervisorLauncher(supervisor *process.Supervisor) Launcher {
	return func(ctx context.Context, program string, args ...string) (Child, error) {
		child, err := supervisor.Start(ctx, program, args...)
		if err != nil {
			return nil, err
		}
		return child, nil
	}
}

// Phase is where the service's one job is.
type Phase string

const (
	PhaseIdle      Phase = "idle"
	PhaseRunning   Phase = "running"
	PhaseComplete  Phase = "complete"
	PhaseCancelled Phase = "cancelled"
	PhaseFailed    Phase = "failed"
)

// State is the service's job as the UI will see it (Phase 5 binds it).
type State struct {
	RunID     string  `json:"runId,omitempty"`
	ChapterID string  `json:"chapterId,omitempty"`
	Phase     Phase   `json:"phase"`
	Percent   float64 `json:"percent"`
	Stage     string  `json:"stage,omitempty"`
	Message   string  `json:"message"`
	// RecordID is the ledger record the finished run wrote.
	RecordID    string     `json:"recordId,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

// Request is one coverage run.
type Request struct {
	ChapterID     string
	Transcription Transcription
	Alignment     AlignmentParams
}

// Service runs one coverage analysis at a time and reads results back.
type Service struct {
	config       Config
	launch       Launcher
	changed      func(State)
	now          func() time.Time
	pollInterval time.Duration

	ledger  *evidence.LedgerStore
	cache   *evidence.CacheStore
	mapping *evidence.MappingStore
	results resultStore

	mu sync.Mutex
	// +checklocks:mu
	busy bool
	// +checklocks:mu
	state State
	// +checklocks:mu
	job *job
}

// New builds the service for one project. changed, when not nil, hears every
// state change (Phase 5 turns it into an event).
func New(config Config, launch Launcher, changed func(State)) *Service {
	ledger := evidence.NewLedgerStore(config.Project)
	ledger.Reporter = config.Reporter
	cache := evidence.NewCacheStore(config.Project)
	cache.Reporter = config.Reporter
	mapping := evidence.NewMappingStore(config.Project)
	mapping.Reporter = config.Reporter
	return &Service{
		config: config, launch: launch, changed: changed, now: time.Now, pollInterval: defaultPollInterval,
		ledger: ledger, cache: cache, mapping: mapping,
		results: resultStore{dir: resultsDir(config.Project), reporter: config.Reporter},
		state:   State{Phase: PhaseIdle, Message: "Save the REAPER project, then check a chapter's recording."},
	}
}

// State returns the current job's state.
func (s *Service) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

// Busy reports whether a run is being prepared or is running, so the host
// does not switch projects under it.
func (s *Service) Busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busy
}

// Wait blocks until the run in progress, if any, has finished and written its
// ledger record.
func (s *Service) Wait() {
	s.mu.Lock()
	current := s.job
	s.mu.Unlock()
	if current != nil {
		<-current.done
	}
}

// Start prepares a run from the saved project and starts the sidecar. It
// returns an UnknownError, having run and written nothing, when the chapter
// cannot be measured as the saved project stands (unmapped, a missing source,
// ...), and a plain error when something could not be written or launched.
func (s *Service) Start(request Request) (State, error) {
	s.mu.Lock()
	if s.busy {
		s.mu.Unlock()
		return State{}, unknown(ReasonBusy, "a recording check is already running")
	}
	s.busy = true
	s.mu.Unlock()

	running, err := s.prepareAndLaunch(request)
	if err != nil {
		s.mu.Lock()
		s.busy = false
		s.mu.Unlock()
		return State{}, err
	}
	s.mu.Lock()
	s.job, s.state = running, running.initialState()
	state := s.state
	s.mu.Unlock()
	s.notify(state)
	go s.watch(running)
	return state, nil
}

// Cancel asks the running sidecar to stop through its .cancel file. The items
// it finished stay cached and the run records a partial outcome.
func (s *Service) Cancel() {
	s.mu.Lock()
	current := s.job
	if current == nil || s.state.Phase != PhaseRunning {
		s.mu.Unlock()
		return
	}
	s.state.Message = "Cancelling..."
	state := s.state
	s.mu.Unlock()
	// The error is dropped on purpose: it fails only when the run has just
	// finished and removed its folder, and then there is nothing to cancel.
	_ = os.WriteFile(current.progressPath+".cancel", []byte("cancel"), 0o600)
	s.notify(state)
}

func (s *Service) notify(state State) {
	if s.changed != nil {
		s.changed(state)
	}
}

// savedProject resolves, checks and parses the saved .rpp: the only basis a
// coverage run or result has (D6). The file must be directly inside the
// project folder, as tracks.Discover finds it.
func (s *Service) savedProject() (tracks.Project, evidence.LedgerProjectFile, error) {
	if s.config.ProjectFile == nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknown(ReasonNoProjectFile, "no REAPER project file is chosen for this project")
	}
	path, err := s.config.ProjectFile()
	if err != nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknownf(ReasonNoProjectFile, "choose the saved REAPER project file on the Tracks page first (%v)", err)
	}
	relative, err := filepath.Rel(s.config.Project, path)
	if err != nil || relative != filepath.Base(relative) || relative == "." || relative == ".." || !strings.EqualFold(filepath.Ext(relative), ".rpp") {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknown(ReasonNoProjectFile, "the chosen REAPER project file is not in the project folder")
	}
	info, err := os.Stat(path)
	if err != nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknownf(ReasonProjectUnreadable, "could not read %s: %v", filepath.Base(path), err)
	}
	project, err := tracks.Parse(path)
	if err != nil {
		return tracks.Project{}, evidence.LedgerProjectFile{}, unknownf(ReasonProjectUnreadable, "could not read %s: %v", filepath.Base(path), err)
	}
	return project, projectFileFact(path, info.ModTime()), nil
}

func (s *Service) chapter(chapterID string) (ChapterBasis, error) {
	if s.config.LoadManuscript == nil {
		return ChapterBasis{}, unknown(ReasonNoManuscript, "import a manuscript before checking a recording")
	}
	data, err := s.config.LoadManuscript()
	if err != nil {
		return ChapterBasis{}, unknown(ReasonNoManuscript, err.Error())
	}
	return chapterBasis(data, chapterID)
}

func (s *Service) prepareAndLaunch(request Request) (*job, error) {
	if s.config.Project == "" {
		return nil, unknown(ReasonNoProject, "open a project before checking a recording")
	}
	if err := request.Alignment.validate(); err != nil {
		return nil, err
	}
	if request.Transcription.Model == "" {
		return nil, unknown(ReasonInvalidParams, "a Whisper model is needed to check a recording")
	}
	if s.config.Python == "" {
		return nil, unknown(ReasonSidecarMissing, "configure the Transcript Compare executable before checking a recording")
	}
	basis, err := s.chapter(request.ChapterID)
	if err != nil {
		return nil, err
	}
	project, projectFile, err := s.savedProject()
	if err != nil {
		return nil, err
	}
	trackGUID, err := confirmedTrack(s.mapping, basis.DocumentID, basis.ChapterID)
	if err != nil {
		return nil, err
	}
	planned, err := buildPlan(project, trackGUID, memoIdentify(s.config.Project))
	if err != nil {
		return nil, err
	}
	inputs := readProjectInputs(s.config.Project)
	started := s.now().UTC()
	running := &job{
		runID: strconv.FormatInt(started.UnixNano(), 10), request: request, basis: basis, plan: planned,
		projectFile: projectFile, inputs: inputs, startedAt: started, done: make(chan struct{}),
		words: wordsCache{store: s.cache, paramHash: wordsParamHash(request.Transcription, inputs)},
	}
	running.dir = filepath.Join(runsDir(s.config.Project), running.runID)
	running.progressPath = filepath.Join(running.dir, "progress.txt")
	if err := running.writeInputs(); err != nil {
		_ = os.RemoveAll(running.dir)
		return nil, err
	}
	child, err := s.launch(context.Background(), s.config.Python, s.sidecarArgs(running)...)
	if err != nil {
		_ = os.RemoveAll(running.dir)
		return nil, fmt.Errorf("could not start the recording check: %w", err)
	}
	running.child = child
	return running, nil
}

// sidecarArgs builds the sidecar's arguments. Every path is under the run's
// folder or is the project's own manuscript; the audio paths are in the
// manifest and come from the saved project (threat-model row 4e).
func (s *Service) sidecarArgs(running *job) []string {
	args := []string{
		"--coverage",
		"--manifest", running.manifestPath(),
		"--manuscript", filepath.Join(s.config.Project, "narration-utils", "manuscript", "manuscript.json"),
		"--chapter-id", running.basis.ChapterID,
		"--words-dir", running.wordsDir(),
		"--out", running.resultsPath(),
		"--progress", running.progressPath,
		"--model", running.request.Transcription.Model,
		"--max-misread-run", strconv.Itoa(running.request.Alignment.MaxMisreadRun),
		"--min-anchor-run", strconv.Itoa(running.request.Alignment.MinAnchorRun),
	}
	if dir := running.request.Transcription.ModelDir; dir != "" {
		args = append(args, "--model-dir", dir)
	}
	if language := running.request.Transcription.Language; language != "" {
		args = append(args, "--language", language)
	}
	if s.config.Backend != "" {
		args = append([]string{s.config.Backend}, args...)
	}
	return args
}

// writeInputs creates the run's folder, writes the manifest and seeds the
// words directory from the cache.
func (j *job) writeInputs() error {
	if err := os.MkdirAll(j.wordsDir(), 0o755); err != nil {
		return fmt.Errorf("could not prepare the recording check: %w", err)
	}
	encoded, err := json.MarshalIndent(j.plan.manifest(), "", "  ")
	if err != nil {
		return err
	}
	if err := writeAtomically(j.manifestPath(), encoded); err != nil {
		return fmt.Errorf("could not write the coverage manifest: %w", err)
	}
	seeded, err := j.words.seed(j.plan.items, j.wordsDir())
	if err != nil {
		return fmt.Errorf("could not prepare the cached words: %w", err)
	}
	j.seeded = seeded
	return nil
}
