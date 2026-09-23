// Store persistence follows the layout in docs/architecture/findings-contract.md
// and the review-dashboard PRD's Q5: one regenerated JSON file per analyzer
// and scope (for example a chapter), plus a single append-only decision
// history shared by every analyzer. Only the Go host writes here; Lua and the
// Python sidecars never touch this folder. Every write is
// temp-file-then-rename, mirroring transcript.Service.SaveHints.
package findings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// Dir is the sidecar folder holding every analyzer's findings and the review
// history, relative to the project folder. resetDerived clears it whenever
// the manuscript it is anchored to is replaced or cleared.
const Dir = "narration-utils/findings"

const reviewFileName = "review.json"

// scopeNamePattern keeps analyzer and scope names safe path components: no
// separators, no "..", nothing that could escape Dir.
var scopeNamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// Decision is one entry in the append-only review history: a narrator's call
// on a finding, made against a specific EvidenceVersion. The history is
// never edited or pruned; RecordDecision only appends. The latest entry for
// an id is that finding's current decision.
type Decision struct {
	FindingID       string `json:"finding_id"`
	EvidenceVersion string `json:"evidence_version,omitempty"`
	Status          Status `json:"status"`
	Note            string `json:"note,omitempty"`
	Timestamp       string `json:"timestamp"`
}

type reviewHistory struct {
	SchemaVersion int        `json:"schema_version"`
	Decisions     []Decision `json:"decisions"`
}

// Query filters and sorts a List call. A zero Query matches every finding
// except ones absent from the latest run. Filtering and sorting run in Go,
// not the UI (review-dashboard PRD Q9), so the same code serves every
// analyzer and stays fast on a large book.
type Query struct {
	Analyzer      string
	Category      Category
	Severity      Severity
	Status        Status
	ChapterID     string
	MinConfidence *float64
	// IncludeNotInLatestRun, when true, also returns findings the latest
	// run did not reproduce (still marked NotInLatestRun).
	IncludeNotInLatestRun bool
}

// Store persists analyzer findings and narrator decisions for one project.
type Store struct {
	mu       sync.Mutex
	project  string
	reporter atomic.Pointer[persist.Reporter]
}

// NewStore returns a Store rooted at project, the folder holding the .rpp
// and the narration-utils sidecar.
func NewStore(project string) *Store { return &Store{project: project} }

// SetPersist says where to report a findings file that cannot be read. A nil
// reporter (the default) still refuses to overwrite what it cannot see; it
// just has nowhere to log or notify.
func (s *Store) SetPersist(reporter *persist.Reporter) { s.reporter.Store(reporter) }

func (s *Store) report() *persist.Reporter { return s.reporter.Load() }

func (s *Store) dir() string { return filepath.Join(s.project, filepath.FromSlash(Dir)) }

func (s *Store) reviewPath() string { return filepath.Join(s.dir(), reviewFileName) }

func (s *Store) scopePath(analyzer, scope string) (string, error) {
	if !scopeNamePattern.MatchString(analyzer) {
		return "", fmt.Errorf("analyzer name %q is not a valid folder name", analyzer)
	}
	if !scopeNamePattern.MatchString(scope) {
		return "", fmt.Errorf("scope %q is not a valid file name", scope)
	}
	return filepath.Join(s.dir(), analyzer, scope+".json"), nil
}

// SaveAnalyzerFindings replaces analyzer's findings for scope (for example a
// chapter id) with fresh, merging in the narrator's decision history and
// carrying forward findings the latest run did not reproduce, marked
// NotInLatestRun rather than deleted. A finding whose id and EvidenceVersion
// match an earlier decision keeps that decision; a changed EvidenceVersion
// returns it to unreviewed but keeps the earlier note. It returns the merged
// set as written. Callers validate each fresh Finding themselves; this only
// merges and persists.
func (s *Store) SaveAnalyzerFindings(analyzer, scope string, fresh []Finding) ([]Finding, error) {
	return s.mergeScope(analyzer, scope, fresh, true)
}

// MergeAnalyzerFindings adds fresh to analyzer's findings for scope without
// treating the run as a full one: a stored finding the run did not reproduce
// is kept exactly as it was (never marked NotInLatestRun), because an analyzer
// whose runs each cover only part of a scope says nothing about the rest. A
// live read-aloud session is one (ADR 0117): the narrator reads some of a
// chapter, so a later session that did not flag a word is no evidence the
// earlier flag went away. Otherwise it merges exactly as SaveAnalyzerFindings
// does: the same id is one finding (the last copy in fresh wins), and a
// decision is kept only while id and EvidenceVersion both match. It returns
// the scope's merged set as written.
func (s *Store) MergeAnalyzerFindings(analyzer, scope string, fresh []Finding) ([]Finding, error) {
	return s.mergeScope(analyzer, scope, fresh, false)
}

// mergeScope writes fresh over scope's stored findings. markAbsent says the
// run was a full one, so a stored finding it did not reproduce is carried
// forward marked NotInLatestRun; otherwise that finding is kept unchanged.
func (s *Store) mergeScope(analyzer, scope string, fresh []Finding, markAbsent bool) ([]Finding, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path, err := s.scopePath(analyzer, scope)
	if err != nil {
		return nil, err
	}
	previous, err := s.readScope(path)
	if err != nil {
		return nil, err
	}
	history, err := s.readHistory()
	if err != nil {
		return nil, err
	}
	latest := latestDecisions(history)

	merged := make([]Finding, 0, len(fresh)+len(previous))
	position := make(map[string]int, len(fresh))
	for _, f := range fresh {
		f = applyDecision(f, latest[f.ID])
		f.NotInLatestRun = false
		if at, repeated := position[f.ID]; repeated {
			merged[at] = f
			continue
		}
		position[f.ID] = len(merged)
		merged = append(merged, f)
	}
	for _, prior := range previous {
		if _, seen := position[prior.ID]; seen {
			continue
		}
		carried := applyDecision(prior, latest[prior.ID])
		if markAbsent {
			carried.NotInLatestRun = true
		}
		merged = append(merged, carried)
	}
	sortByID(merged)

	if err := writeJSONFile(path, merged); err != nil {
		return nil, err
	}
	return merged, nil
}

// applyDecision folds the narrator's latest call into a finding. Unchanged
// evidence keeps the decision; a materially changed EvidenceVersion returns
// the finding to unreviewed but keeps the earlier note (review-dashboard PRD
// Q2 and Q3).
func applyDecision(f Finding, decision *Decision) Finding {
	if decision == nil {
		return f
	}
	if decision.EvidenceVersion == f.EvidenceVersion {
		f.Review = ReviewState{Status: decision.Status, Note: decision.Note, Timestamp: decision.Timestamp}
		return f
	}
	f.Review = ReviewState{Status: StatusUnreviewed, Note: decision.Note}
	return f
}

func latestDecisions(history []Decision) map[string]*Decision {
	latest := make(map[string]*Decision, len(history))
	for i := range history {
		decision := history[i]
		latest[decision.FindingID] = &decision
	}
	return latest
}

// RecordDecision appends the narrator's call to the append-only review
// history and, when a finding with id currently exists in the store,
// applies it immediately so the change is visible without waiting for the
// analyzer to run again. found is false when no stored finding has id yet;
// the decision is still recorded so a later SaveAnalyzerFindings picks it up.
func (s *Store) RecordDecision(id, evidenceVersion string, status Status, note, timestamp string) (finding Finding, found bool, err error) {
	if !validStatus(status) {
		return Finding{}, false, fmt.Errorf("review status %q is not recognised", status)
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	decision := Decision{FindingID: id, EvidenceVersion: evidenceVersion, Status: status, Note: note, Timestamp: timestamp}
	if err := s.appendHistory(decision); err != nil {
		return Finding{}, false, err
	}

	path, findingsInFile, index, err := s.locate(id)
	if err != nil {
		return Finding{}, false, err
	}
	if path == "" {
		return Finding{}, false, nil
	}
	findingsInFile[index] = applyDecision(findingsInFile[index], &decision)
	if err := writeJSONFile(path, findingsInFile); err != nil {
		return Finding{}, false, err
	}
	return findingsInFile[index], true, nil
}

// List returns findings across every analyzer and scope that match query,
// sorted by chapter id then finding id for stable paging.
func (s *Store) List(query Query) ([]Finding, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	all, err := s.readAll()
	if err != nil {
		return nil, err
	}
	result := make([]Finding, 0, len(all))
	for _, f := range all {
		if matches(f, query) {
			result = append(result, f)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		ci, cj := chapterOf(result[i]), chapterOf(result[j])
		if ci != cj {
			return ci < cj
		}
		return result[i].ID < result[j].ID
	})
	return result, nil
}

// Get returns the finding with id, across every analyzer and scope.
func (s *Store) Get(id string) (Finding, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path, findingsInFile, index, err := s.locate(id)
	if err != nil || path == "" {
		return Finding{}, false, err
	}
	return findingsInFile[index], true, nil
}

func matches(f Finding, q Query) bool {
	switch {
	case q.Analyzer != "" && f.Analyzer != q.Analyzer:
		return false
	case q.Category != "" && f.Category != q.Category:
		return false
	case q.Severity != "" && f.Severity != q.Severity:
		return false
	case q.Status != "" && f.Review.Status != q.Status:
		return false
	case q.ChapterID != "" && chapterOf(f) != q.ChapterID:
		return false
	case q.MinConfidence != nil && (f.Confidence == nil || *f.Confidence < *q.MinConfidence):
		return false
	case !q.IncludeNotInLatestRun && f.NotInLatestRun:
		return false
	}
	return true
}

func chapterOf(f Finding) string {
	if f.Manuscript == nil {
		return ""
	}
	return f.Manuscript.ChapterID
}

func sortByID(findings []Finding) {
	sort.Slice(findings, func(i, j int) bool { return findings[i].ID < findings[j].ID })
}

// scopeFiles returns every analyzer/scope JSON path under Dir. A directory
// that does not exist yet (no findings saved for this project) is not an
// error: it means an empty store.
func (s *Store) scopeFiles() ([]string, error) {
	entries, err := os.ReadDir(s.dir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("could not read the findings directory: %w", err)
	}
	var paths []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue // review.json and anything else at the top level is not a scope file
		}
		analyzerDir := filepath.Join(s.dir(), entry.Name())
		files, err := os.ReadDir(analyzerDir)
		if err != nil {
			return nil, fmt.Errorf("could not read findings for %s: %w", entry.Name(), err)
		}
		for _, file := range files {
			if !file.IsDir() && filepath.Ext(file.Name()) == ".json" {
				paths = append(paths, filepath.Join(analyzerDir, file.Name()))
			}
		}
	}
	return paths, nil
}

func (s *Store) readAll() ([]Finding, error) {
	paths, err := s.scopeFiles()
	if err != nil {
		return nil, err
	}
	var all []Finding
	for _, path := range paths {
		findingsInFile, err := s.readScope(path)
		if err != nil {
			return nil, err
		}
		all = append(all, findingsInFile...)
	}
	return all, nil
}

// locate finds the finding with id across every analyzer and scope file. It
// returns the scope file's full contents and the finding's index in it, so a
// caller can update just that entry and write the whole file back. An empty
// path means id was not found anywhere.
func (s *Store) locate(id string) (path string, findingsInFile []Finding, index int, err error) {
	paths, err := s.scopeFiles()
	if err != nil {
		return "", nil, 0, err
	}
	for _, candidate := range paths {
		inFile, err := s.readScope(candidate)
		if err != nil {
			return "", nil, 0, err
		}
		for i, f := range inFile {
			if f.ID == id {
				return candidate, inFile, i, nil
			}
		}
	}
	return "", nil, 0, nil
}

// readScope reads one analyzer/scope file. It is regenerated analyzer output
// (persist.Disposable): a corrupt file is logged and treated as empty rather
// than blocking the next save, since re-running the analyzer replaces it.
func (s *Store) readScope(path string) ([]Finding, error) {
	var result []Finding
	outcome := s.report().ReadJSON(path, "findings", persist.Disposable, func(bytes []byte) error {
		var decoded []Finding
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		result = decoded
		return nil
	})
	if outcome == persist.Unreadable {
		return nil, fmt.Errorf("could not read findings file %s", filepath.Base(path))
	}
	return result, nil
}

// readHistory reads the review history. It is the narrator's own decisions
// (persist.NarratorData): a corrupt file is kept aside and the narrator is
// told, never silently replaced.
func (s *Store) readHistory() ([]Decision, error) {
	var result reviewHistory
	outcome := s.report().ReadJSON(s.reviewPath(), "findings review history", persist.NarratorData, func(bytes []byte) error {
		var decoded reviewHistory
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		result = decoded
		return nil
	})
	if outcome == persist.Unreadable {
		return nil, fmt.Errorf("could not read the findings review history")
	}
	return result.Decisions, nil
}

func (s *Store) appendHistory(decision Decision) error {
	path := s.reviewPath()
	if err := persist.CanOverwrite(path, "findings review history"); err != nil {
		return err
	}
	existing, err := s.readHistory()
	if err != nil {
		return err
	}
	existing = append(existing, decision)
	return writeJSONFile(path, reviewHistory{SchemaVersion: SchemaVersion, Decisions: existing})
}

func writeJSONFile(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create the findings directory: %w", err)
	}
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, encoded, 0o600); err != nil {
		return fmt.Errorf("could not write findings: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("could not activate findings: %w", err)
	}
	return nil
}
