// This file tells a run recorder how each comparison ended
// (proofing-readiness-signals.prd.md Phase 2, Q5): the proofing signals write an
// analysis evidence ledger record per finished run, so a clean run keeps its
// chapter and chapter 2's result survives chapter 3's comparison. This package
// only reports what it already knows; it does not depend on the ledger. It also
// makes a clean, complete run count as a full run in the findings store, so the
// findings an earlier run raised are marked not_in_latest_run instead of
// staying current forever.
package transcript

import (
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Run outcomes a recorder is told. A cancelled run is not reported.
const (
	RunComplete = "complete"
	RunFailed   = "failed"
)

// CompletedRun is how one comparison ended. ChapterTitle is the chapter the
// run matched: the rows' one chapter title, else compare.py's summary ("MATCH:
// '<title>' (score ...)"), else the narrator's chosen chapter; empty when none
// is known (a failed run before the sidecar matched a chapter).
type CompletedRun struct {
	RunID        string
	Outcome      string
	ManifestPath string
	ChapterTitle string
	Model        string
	TrackGUID    string
	FindingCount int
	StartedAt    time.Time
	CompletedAt  time.Time
}

// SetRunRecorder opts this service into reporting every finished run (complete
// or failed) to record. Called once at service construction, like SetFindings;
// never called means nothing is reported. record runs after the service's lock
// is released and must not call back into the service.
func (s *Service) SetRunRecorder(record func(CompletedRun)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runRecorder = record
}

// runPhases are the phases during which a run is under way, so an error then
// ends a run (an error while exporting markers does not).
var runPhases = map[string]bool{"preparing": true, "running": true, "need_chapter": true, "inspecting": true}

// completedRunLocked builds the report of the run in s.state.
// +checklocksread:s.mu
func (s *Service) completedRunLocked(outcome string) CompletedRun {
	runID, _ := s.state["runId"].(string)
	options, _ := s.state["options"].(map[string]string)
	rows, _ := s.state["rows"].([]map[string]any)
	summary, _ := s.state["summary"].(string)
	manifest, _ := s.state["manifest"].(string)
	if manifest == "" && s.config.SessionDir != "" && runID != "" {
		manifest = filepath.Join(s.config.SessionDir, "manifest_"+runID+".txt")
	}
	started, _ := s.state["startedAt"].(time.Time)
	run := CompletedRun{
		RunID: runID, Outcome: outcome, ManifestPath: manifest, Model: option(options, "model", "small"),
		FindingCount: len(rows), StartedAt: started, CompletedAt: time.Now().UTC(),
		ChapterTitle: runChapterTitle(rows, summary, options), TrackGUID: singleValue(rows, rowTrackGUID),
	}
	return run
}

// recordRun reports the run to the recorder, if there is one. Call it without
// holding s.mu.
func (s *Service) recordRun(run CompletedRun) {
	s.mu.RLock()
	record := s.runRecorder
	s.mu.RUnlock()
	if record != nil {
		record(run)
	}
}

// matchSummary is compare.py's summary line for a matched chapter.
var matchSummary = regexp.MustCompile(`^MATCH: '(.*)' \(score [-0-9.]+\)`)

// runChapterTitle is the chapter a run compared against: the one chapter title
// its rows carry, else the title in compare.py's MATCH summary, else the
// narrator's chosen chapter.
func runChapterTitle(rows []map[string]any, summary string, options map[string]string) string {
	if title := singleValue(rows, "chapter"); title != "" {
		return title
	}
	if match := matchSummary.FindStringSubmatch(strings.TrimSpace(summary)); match != nil {
		return match[1]
	}
	return strings.TrimSpace(option(options, "chapterTitle", ""))
}

// singleValue is the one non-empty string rows carry under key, or "" when
// they carry none or more than one.
func singleValue(rows []map[string]any, key string) string {
	value := ""
	for _, row := range rows {
		text := textOf(row, key)
		switch {
		case text == "" || text == value:
		case value == "":
			value = text
		default:
			return ""
		}
	}
	return value
}
