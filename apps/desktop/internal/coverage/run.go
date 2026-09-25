package coverage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// exitCancelled is the sidecar's cancel exit code (ADR 0127).
const exitCancelled = 2

// job is one run: what it was built from and where its files are.
type job struct {
	runID        string
	request      Request
	basis        ChapterBasis
	plan         plan
	projectFile  evidence.LedgerProjectFile
	inputs       projectInputs
	words        wordsCache
	seeded       int
	startedAt    time.Time
	dir          string
	progressPath string
	child        Child
	done         chan struct{}

	// lastError is the message of an ERROR progress line, for the failure text.
	lastError string
}

func (j *job) manifestPath() string { return filepath.Join(j.dir, "manifest.json") }
func (j *job) wordsDir() string     { return filepath.Join(j.dir, "words") }
func (j *job) resultsPath() string  { return filepath.Join(j.dir, "coverage.txt") }

func (j *job) initialState() State {
	started := j.startedAt
	return State{RunID: j.runID, ChapterID: j.basis.ChapterID, Phase: PhaseRunning, Stage: "START", Message: "Starting the recording check...", StartedAt: &started, Background: j.request.Background}
}

// watch follows a run's progress file until the sidecar exits, then finishes
// the run.
func (s *Service) watch(running *job) {
	defer close(running.done)
	ticker := time.NewTicker(s.pollInterval)
	defer ticker.Stop()
	for {
		s.readProgress(running)
		if running.child.HasExited() {
			s.readProgress(running)
			s.finish(running)
			return
		}
		<-ticker.C
	}
}

// readProgress applies the progress file's last line. Percent never moves
// backwards (a CANCELLED line reports 0), and a malformed line is ignored and
// logged, never read as 0 (ADR 0015, ADR 0069).
func (s *Service) readProgress(running *job) {
	raw, err := os.ReadFile(running.progressPath)
	if err != nil {
		return
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	stage, percent, message, err := process.ParseProgress(lines[len(lines)-1])
	if err != nil {
		s.config.Reporter.Warn("progress_line_ignored", fmt.Sprintf("Recording coverage progress line ignored: %v", err))
		return
	}
	s.mu.Lock()
	if stage == "ERROR" {
		running.lastError = message
	}
	if s.job != running || s.state.Phase != PhaseRunning {
		s.mu.Unlock()
		return
	}
	changed := s.state.Stage != stage || s.state.Percent < percent || (message != "" && s.state.Message != message && s.state.Message != "Cancelling...")
	s.state.Stage = stage
	if percent > s.state.Percent {
		s.state.Percent = percent
	}
	if message != "" && s.state.Message != "Cancelling..." {
		s.state.Message = message
	}
	state := s.state
	s.mu.Unlock()
	if changed {
		s.notify(state)
	}
}

// finish stores the words the run produced (on every outcome: the sidecar
// writes each words file atomically, so a file that exists is finished), writes
// the ledger record and, for a complete run, the stored result, and removes the
// run's folder.
func (s *Service) finish(running *job) {
	code, _ := running.child.ExitCode()
	stored, harvestErr := running.words.harvest(running.plan.items, running.wordsDir())
	if harvestErr != nil {
		s.config.Reporter.Warn("coverage_cache_write_failed", harvestErr.Error())
	}

	outcome, phase, message := evidence.LedgerFailed, PhaseFailed, ""
	var report Report
	switch code {
	case 0:
		parsed, err := readReport(running.resultsPath(), running.basis.ChapterID)
		if err == nil {
			err = s.inputsUnchanged(running)
		}
		if err != nil {
			message = err.Error()
		} else {
			report, outcome, phase = parsed, evidence.LedgerComplete, PhaseComplete
			message = fmt.Sprintf("Text present: %d of %d words.", parsed.Summary.PresentTokens, parsed.Summary.BodyTokens)
		}
	case exitCancelled:
		outcome, phase, message = evidence.LedgerPartial, PhaseCancelled, "Cancelled. The items already transcribed are kept for the next check."
	default:
		s.mu.Lock()
		message = running.lastError
		s.mu.Unlock()
		if message == "" {
			message = fmt.Sprintf("The recording check stopped with exit code %d.", code)
		}
	}

	record, err := s.ledger.Write(s.record(running, outcome, report, stored))
	if err != nil {
		phase, message = PhaseFailed, err.Error()
	} else if outcome == evidence.LedgerComplete {
		if err := s.results.write(s.storedResult(running, record.ID, report)); err != nil {
			phase, message = PhaseFailed, err.Error()
		}
	}
	if err := os.RemoveAll(running.dir); err != nil {
		s.config.Reporter.Warn("coverage_run_cleanup_failed", fmt.Sprintf("Recording coverage run folder was not removed: %v", err))
	}

	completed := s.now().UTC()
	s.mu.Lock()
	s.state.Phase, s.state.Message, s.state.RecordID, s.state.CompletedAt = phase, message, record.ID, &completed
	if phase == PhaseComplete {
		s.state.Percent = 100
	}
	s.busy = false
	state := s.state
	s.mu.Unlock()
	s.notify(state)
}

// inputsUnchanged checks that the manuscript chapter and the project inputs
// the sidecar read are still the ones the run was planned (and will be
// recorded) against. The sidecar reads them itself a moment after the host
// does, so an edit in between would store a report under a basis it was not
// measured against: that run is failed instead, never recorded as complete.
func (s *Service) inputsUnchanged(running *job) error {
	basis, err := s.chapter(running.basis.ChapterID)
	if err != nil || basis != running.basis {
		return fmt.Errorf("the manuscript changed during the recording check; check again")
	}
	if readProjectInputs(s.config.Project) != running.inputs {
		return fmt.Errorf("the word equivalences or vocabulary hints changed during the recording check; check again")
	}
	return nil
}

// record is the run's ledger record (D7): scope, the fingerprint the saved
// project had when the run started, the parameter hash with model and language
// left out (Q13), and counts only.
func (s *Service) record(running *job, outcome evidence.LedgerOutcome, report Report, stored int) evidence.LedgerRecord {
	counts := map[string]int{
		"itemsListed":      len(running.plan.items),
		"itemsSeeded":      running.seeded,
		"wordsStored":      stored,
		"overlappingItems": running.plan.overlapping,
		"mutedUnlisted":    running.plan.mutedLeft,
	}
	if outcome == evidence.LedgerComplete {
		summary := report.Summary
		counts["bodyTokens"] = summary.BodyTokens
		counts["presentTokens"] = summary.PresentTokens
		counts["missingTokens"] = summary.MissingTokens
		counts["extraTokens"] = summary.ExtraTokens
		counts["longestMissingRun"] = summary.LongestMissingRun
		counts["itemsAnalyzed"] = summary.Items.Analyzed
		counts["itemsMuted"] = summary.Items.Muted
		counts["itemsTranscribed"] = summary.Items.Transcribed
		counts["itemsReused"] = summary.Items.Reused
		counts["regions"] = len(report.Regions)
	}
	return evidence.LedgerRecord{
		AnalyzerID:      AnalyzerID,
		AnalyzerVersion: AnalyzerVersion,
		ParamHash:       paramHash(running.request.Alignment, running.inputs),
		Scope: evidence.LedgerScope{
			DocumentID: running.basis.DocumentID, ChapterID: running.basis.ChapterID,
			TrackGUID: running.plan.trackGUID, ItemGUIDs: running.plan.itemGUIDs(),
		},
		Fingerprint: running.plan.fingerprint,
		ProjectFile: running.projectFile,
		StartedAt:   running.startedAt,
		CompletedAt: s.now().UTC(),
		Outcome:     outcome,
		Counts:      counts,
	}
}

func (s *Service) storedResult(running *job, recordID string, report Report) StoredResult {
	return StoredResult{
		RecordID:         recordID,
		DocumentID:       running.basis.DocumentID,
		ChapterID:        running.basis.ChapterID,
		ManuscriptHash:   running.basis.Hash,
		Model:            running.request.Transcription.Model,
		Language:         running.request.Transcription.Language,
		HotwordsHash:     running.inputs.HotwordsHash,
		EquivalencesHash: running.inputs.EquivalencesHash,
		Alignment:        running.request.Alignment,
		Report:           report,
	}
}
