package coverage

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// storedResultVersion is the version of a stored coverage result.
const storedResultVersion = 1

// recordIDPattern is what a ledger record id looks like (evidence.newLedgerID:
// 32 hex digits, or "ledger-<nanoseconds>"): the stored result's file name, so
// it is checked before it becomes part of a path.
var recordIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// Dir is where coverage keeps its own data under a project: the stored results
// and, while a run is going, its working folder. manuscript.resetDerived clears
// it with the ledger and cache, since results name chapter and paragraph ids a
// re-import resets.
func Dir(project string) string {
	return filepath.Join(project, "narration-utils", "analysis", "coverage")
}

func resultsDir(project string) string { return filepath.Join(Dir(project), "results") }

func runsDir(project string) string { return filepath.Join(Dir(project), "runs") }

// StoredResult is a complete run's report and the labels that go with it,
// stored beside its ledger record (the record holds counts only). The labels
// the record's parameter hash leaves out on purpose - model and language (Q13)
// - are here, so the evidence can name them.
type StoredResult struct {
	SchemaVersion    int             `json:"schemaVersion"`
	RecordID         string          `json:"recordId"`
	DocumentID       string          `json:"documentId"`
	ChapterID        string          `json:"chapterId"`
	ManuscriptHash   string          `json:"manuscriptHash"`
	Model            string          `json:"model"`
	Language         string          `json:"language,omitempty"`
	HotwordsHash     string          `json:"hotwordsHash,omitempty"`
	EquivalencesHash string          `json:"equivalencesHash,omitempty"`
	Alignment        AlignmentParams `json:"alignment"`
	Report           Report          `json:"report"`
}

// resultStore keeps one StoredResult per complete ledger record.
type resultStore struct {
	dir      string
	reporter *persist.Reporter
}

func (s resultStore) path(recordID string) (string, error) {
	if !recordIDPattern.MatchString(recordID) {
		return "", fmt.Errorf("%q is not a ledger record id", recordID)
	}
	return filepath.Join(s.dir, recordID+".json"), nil
}

func (s resultStore) write(result StoredResult) error {
	path, err := s.path(result.RecordID)
	if err != nil {
		return err
	}
	result.SchemaVersion = storedResultVersion
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := writeAtomically(path, encoded); err != nil {
		return fmt.Errorf("could not store the coverage result: %w", err)
	}
	return nil
}

// read returns the stored result for a record, or false when it is missing,
// unreadable, or of another version: derived data a new run replaces.
func (s resultStore) read(recordID string) (StoredResult, bool) {
	path, err := s.path(recordID)
	if err != nil {
		return StoredResult{}, false
	}
	var result StoredResult
	outcome := s.reporter.ReadJSON(path, "coverage result", persist.Disposable, func(raw []byte) error {
		var decoded StoredResult
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return err
		}
		if decoded.SchemaVersion != storedResultVersion || decoded.RecordID != recordID {
			return fmt.Errorf("coverage result %s is version %d", recordID, decoded.SchemaVersion)
		}
		result = decoded
		return nil
	})
	return result, outcome == persist.Loaded
}

// ChapterResult is what the result reader answers for a chapter: whether the
// newest complete coverage run is still current for the saved project, the
// manuscript and the alignment parameters, and its stored report.
type ChapterResult struct {
	// State is current, stale or never (evidence.EvaluatorState).
	State evidence.EvaluatorState `json:"state"`
	// Reasons are the evaluator's reasons (item_trimmed, params_changed, ...)
	// plus this package's own (manuscript_changed, result_missing), and for a
	// chapter that cannot be evaluated at all, one refusal Reason.
	Reasons []string `json:"reasons"`
	// Basis is "saved project, file modified <time>" (Q8), when there is one.
	Basis *evidence.EvaluationBasis `json:"basis,omitempty"`
	// Record is the ledger record compared against, when there is one.
	Record *evidence.LedgerRecord `json:"record,omitempty"`
	// Result is that record's stored report and labels, when readable.
	Result *StoredResult `json:"result,omitempty"`
}

// Current reports whether the result can be read as a measurement of the
// chapter as it is now (the only case that may fill recordedFraction or feed
// the recording signal).
func (r ChapterResult) Current() bool {
	return r.State == evidence.StateCurrent && r.Result != nil
}
