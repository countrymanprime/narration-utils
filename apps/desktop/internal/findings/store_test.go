package findings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func testFinding(id, chapter string, evidenceVersion string) Finding {
	return Finding{
		SchemaVersion:    SchemaVersion,
		ID:               id,
		Analyzer:         "transcript_compare",
		Category:         CategoryTranscriptDiscrepancy,
		Severity:         SeverityWarning,
		Confidence:       floatPtr(0.8),
		ConfidenceReason: "asr alignment score",
		EvidenceVersion:  evidenceVersion,
		Manuscript:       &Manuscript{ChapterID: chapter},
		Review:           ReviewState{Status: StatusUnreviewed},
	}
}

func TestSaveAnalyzerFindingsWritesUnderTheDocumentedLayout(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)

	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(project, "narration-utils", "findings", "transcript_compare", "c-0001.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected a scope file at %s: %v", path, err)
	}
}

func TestSaveAnalyzerFindingsRejectsUnsafeAnalyzerOrScopeNames(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, err := store.SaveAnalyzerFindings("../escape", "c-0001", nil); err == nil {
		t.Fatal("expected an error for a path-traversal analyzer name")
	}
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "../../escape", nil); err == nil {
		t.Fatal("expected an error for a path-traversal scope name")
	}
}

func TestMergeKeepsTheDecisionWhenEvidenceVersionIsUnchanged(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)

	first, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")})
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || first[0].Review.Status != StatusUnreviewed {
		t.Fatalf("first save = %+v", first)
	}

	if _, _, err := store.RecordDecision("f1", "v1", StatusDismissed, "known room noise", "2026-09-19T10:00:00Z"); err != nil {
		t.Fatal(err)
	}

	// Re-run the analyzer with the same id and evidence_version: the decision
	// must survive, and no new id is produced.
	second, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")})
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 {
		t.Fatalf("re-run must not create new ids, got %d findings: %+v", len(second), second)
	}
	if second[0].Review.Status != StatusDismissed || second[0].Review.Note != "known room noise" {
		t.Fatalf("decision lost across re-run: %+v", second[0].Review)
	}
}

func TestMergeResetsToUnreviewedAndKeepsTheNoteWhenEvidenceVersionChanges(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)

	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.RecordDecision("f1", "v1", StatusAccepted, "re-recorded, sounds right", "2026-09-19T10:00:00Z"); err != nil {
		t.Fatal(err)
	}

	// The narrator re-recorded the line: the adapter now reports a new
	// evidence_version for the same manuscript-anchored id.
	changed, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v2")})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 1 {
		t.Fatalf("changed evidence must not create a new id, got %+v", changed)
	}
	if changed[0].Review.Status != StatusUnreviewed {
		t.Fatalf("Review.Status = %q, want unreviewed after evidence changed", changed[0].Review.Status)
	}
	if changed[0].Review.Note != "re-recorded, sounds right" {
		t.Fatalf("Review.Note = %q, want the earlier note kept", changed[0].Review.Note)
	}
}

func TestMergeFlagsAbsentFindingsAsNotInLatestRunAndNeverDeletesThem(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)

	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{
		testFinding("f1", "c-0001", "v1"),
		testFinding("f2", "c-0001", "v1"),
	}); err != nil {
		t.Fatal(err)
	}

	// f2 is fixed and no longer reproduced by the next run.
	merged, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")})
	if err != nil {
		t.Fatal(err)
	}
	if len(merged) != 2 {
		t.Fatalf("expected f2 to be carried forward, not deleted; got %+v", merged)
	}
	var f2 *Finding
	for i := range merged {
		if merged[i].ID == "f2" {
			f2 = &merged[i]
		}
	}
	if f2 == nil {
		t.Fatal("f2 was deleted")
	}
	if !f2.NotInLatestRun {
		t.Fatalf("f2.NotInLatestRun = false, want true")
	}

	// List excludes it by default, includes it on request.
	visible, err := store.List(Query{})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range visible {
		if f.ID == "f2" {
			t.Fatal("List() with a zero Query must exclude findings not in the latest run by default")
		}
	}
	all, err := store.List(Query{IncludeNotInLatestRun: true})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range all {
		found = found || f.ID == "f2"
	}
	if !found {
		t.Fatal("List() with IncludeNotInLatestRun must still return f2")
	}
}

func TestRecordDecisionReportsWhetherTheFindingExists(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}

	decided, found, err := store.RecordDecision("f1", "v1", StatusAccepted, "", "2026-09-19T10:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("found = false for a finding that exists")
	}
	if decided.Review.Status != StatusAccepted {
		t.Fatalf("RecordDecision did not return the updated finding: %+v", decided)
	}

	updated, found, err := store.Get("f1")
	if err != nil {
		t.Fatal(err)
	}
	if !found || updated.Review.Status != StatusAccepted {
		t.Fatalf("Get(f1) after RecordDecision = %+v, %v", updated, found)
	}

	_, foundUnknown, err := store.RecordDecision("does-not-exist", "v1", StatusAccepted, "", "2026-09-19T10:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if foundUnknown {
		t.Fatal("found = true for an id the store has never seen")
	}
}

func TestRecordDecisionRejectsAnUnknownStatus(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, _, err := store.RecordDecision("f1", "v1", "maybe", "", ""); err == nil {
		t.Fatal("expected an error for an unrecognised status")
	}
}

func TestGetFindsAFindingAcrossAnalyzersAndScopes(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveAnalyzerFindings("guide", "c-0002", []Finding{testFinding("f2", "c-0002", "v1")}); err != nil {
		t.Fatal(err)
	}

	f, found, err := store.Get("f2")
	if err != nil {
		t.Fatal(err)
	}
	if !found || f.ID != "f2" {
		t.Fatalf("Get(f2) = %+v, %v", f, found)
	}

	_, found, err = store.Get("nope")
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatal("Get() found an id that was never saved")
	}
}

func TestListFiltersByQuery(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{
		testFinding("f1", "c-0001", "v1"),
		testFinding("f2", "c-0002", "v1"),
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.RecordDecision("f2", "v1", StatusAccepted, "", "2026-09-19T10:00:00Z"); err != nil {
		t.Fatal(err)
	}

	byChapter, err := store.List(Query{ChapterID: "c-0002"})
	if err != nil {
		t.Fatal(err)
	}
	if len(byChapter) != 1 || byChapter[0].ID != "f2" {
		t.Fatalf("ChapterID filter = %+v", byChapter)
	}

	byStatus, err := store.List(Query{Status: StatusAccepted})
	if err != nil {
		t.Fatal(err)
	}
	if len(byStatus) != 1 || byStatus[0].ID != "f2" {
		t.Fatalf("Status filter = %+v", byStatus)
	}

	high, err := store.List(Query{MinConfidence: floatPtr(0.9)})
	if err != nil {
		t.Fatal(err)
	}
	if len(high) != 0 {
		t.Fatalf("MinConfidence filter = %+v, want none (both findings are 0.8)", high)
	}
}

func TestCorruptScopeFileIsHealedNotSwallowed(t *testing.T) {
	project := t.TempDir()
	scopeDir := filepath.Join(project, "narration-utils", "findings", "transcript_compare")
	if err := os.MkdirAll(scopeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(scopeDir, "c-0001.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	var logged []string
	store := NewStore(project)
	store.SetPersist(&persist.Reporter{Log: func(kind, message string) { logged = append(logged, kind+": "+message) }})

	merged, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")})
	if err != nil {
		t.Fatalf("a corrupt disposable scope file must heal, not fail the save: %v", err)
	}
	if len(merged) != 1 || merged[0].ID != "f1" {
		t.Fatalf("merged = %+v", merged)
	}
	if len(logged) == 0 {
		t.Fatal("a corrupt file must be logged, not silently replaced")
	}
}

func TestCorruptReviewHistoryIsQuarantinedNotSwallowed(t *testing.T) {
	project := t.TempDir()
	findingsDir := filepath.Join(project, "narration-utils", "findings")
	if err := os.MkdirAll(findingsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	reviewPath := filepath.Join(findingsDir, "review.json")
	if err := os.WriteFile(reviewPath, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	var notified []string
	store := NewStore(project)
	store.SetPersist(&persist.Reporter{Notify: func(text string) { notified = append(notified, text) }})

	if _, _, err := store.RecordDecision("f1", "v1", StatusAccepted, "", "2026-09-19T10:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if len(notified) == 0 {
		t.Fatal("a corrupt narrator-authored review history must notify, not silently replace")
	}
	if _, err := os.Stat(reviewPath + ".tmp"); err == nil {
		t.Fatal("leftover .tmp file")
	}
	quarantined, _ := filepath.Glob(reviewPath + ".corrupt-*")
	if len(quarantined) != 1 {
		t.Fatalf("expected exactly one quarantined copy, found %v", quarantined)
	}
	quarantinedContent, err := os.ReadFile(quarantined[0])
	if err != nil {
		t.Fatal(err)
	}
	if string(quarantinedContent) != "{not json" {
		t.Fatal("quarantined copy does not hold the original bytes")
	}
}

func TestConcurrentListDuringSaveNeverSeesATornWrite(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 40)
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func(n int) {
			defer wg.Done()
			id := "f" + string(rune('a'+n%26))
			if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding(id, "c-0001", "v1")}); err != nil {
				errs <- err
			}
		}(i)
		go func() {
			defer wg.Done()
			if _, err := store.List(Query{}); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent read/write returned an error: %v", err)
	}
}

func TestReviewHistoryIsAppendOnlyAcrossMultipleDecisions(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.RecordDecision("f1", "v1", StatusDeferred, "listen later", "2026-09-19T10:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.RecordDecision("f1", "v1", StatusAccepted, "sounds fine", "2026-09-19T11:00:00Z"); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(project, "narration-utils", "findings", "review.json"))
	if err != nil {
		t.Fatal(err)
	}
	var history reviewHistory
	if err := json.Unmarshal(raw, &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Decisions) != 2 {
		t.Fatalf("expected both decisions kept (append-only), got %+v", history.Decisions)
	}

	f, found, err := store.Get("f1")
	if err != nil || !found {
		t.Fatalf("Get(f1) = %v, %v, %v", f, found, err)
	}
	if f.Review.Status != StatusAccepted || f.Review.Note != "sounds fine" {
		t.Fatalf("expected the latest decision to win: %+v", f.Review)
	}
}
