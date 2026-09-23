package findings

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// denyListing removes the current user's permission to list dir's own
// contents (icacls "(RD)") without touching whether dir itself is visible as
// an entry of its parent, so it reproduces a real, portable
// permission-denied os.ReadDir failure on Windows (this repo only runs
// locally on Windows; CI is the same). It restores the permission via
// t.Cleanup so the temp directory can still be removed afterwards.
func denyListing(t *testing.T, dir string) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("permission-denied simulation uses icacls, which is Windows-only")
	}
	user := os.Getenv("USERNAME")
	if user == "" {
		t.Skip("USERNAME is not set; cannot target an icacls deny rule")
	}
	if out, err := exec.Command("icacls", dir, "/deny", user+":(RD)").CombinedOutput(); err != nil {
		t.Skipf("icacls deny unavailable in this environment: %v: %s", err, out)
	}
	t.Cleanup(func() {
		_, _ = exec.Command("icacls", dir, "/remove:d", user).CombinedOutput()
	})
}

// denyRead removes the current user's permission to read path's own data
// ("(RD)" on a file means read data, not list-directory), so a later
// os.ReadFile on it fails with a real, portable permission error rather than
// fs.ErrNotExist. It restores the permission via t.Cleanup.
func denyRead(t *testing.T, path string) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("permission-denied simulation uses icacls, which is Windows-only")
	}
	user := os.Getenv("USERNAME")
	if user == "" {
		t.Skip("USERNAME is not set; cannot target an icacls deny rule")
	}
	if out, err := exec.Command("icacls", path, "/deny", user+":(RD)").CombinedOutput(); err != nil {
		t.Skipf("icacls deny unavailable in this environment: %v: %s", err, out)
	}
	t.Cleanup(func() {
		_, _ = exec.Command("icacls", path, "/remove:d", user).CombinedOutput()
	})
}

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

func TestListOnAFreshProjectReturnsEmptyWithoutError(t *testing.T) {
	// Nothing has ever been saved, so the findings directory does not exist
	// yet. scopeFiles must treat that as an empty store, not an error.
	store := NewStore(t.TempDir())
	findings, err := store.List(Query{})
	if err != nil {
		t.Fatalf("List on a project with no findings directory must not error: %v", err)
	}
	if len(findings) != 0 {
		t.Fatalf("expected no findings, got %+v", findings)
	}
}

func TestListAndRecordDecisionFailWhenTheFindingsDirCannotBeListed(t *testing.T) {
	project := t.TempDir()
	dir := filepath.Join(project, "narration-utils", "findings")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	denyListing(t, dir)

	store := NewStore(project)
	if _, err := store.List(Query{}); err == nil {
		t.Fatal("List must surface a real (non-missing) error reading the findings directory, not swallow it")
	}
	// RecordDecision still appends the narrator's call to history (writing
	// review.json does not require listing dir), but then fails trying to
	// locate the finding to apply the decision immediately.
	if _, _, err := store.RecordDecision("f1", "v1", StatusAccepted, "", "2026-09-19T10:00:00Z"); err == nil {
		t.Fatal("RecordDecision must surface the same directory-listing failure from locate")
	}
}

func TestScopeFilesFailsWhenAnAnalyzerSubdirectoryCannotBeListed(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}

	analyzerDir := filepath.Join(project, "narration-utils", "findings", "transcript_compare")
	denyListing(t, analyzerDir)

	if _, err := store.List(Query{}); err == nil {
		t.Fatal("List must fail when an analyzer subdirectory exists but cannot be listed")
	}
}

func TestSaveAnalyzerFindingsFailsWhenThePreviousScopeFileCannotBeRead(t *testing.T) {
	project := t.TempDir()
	scopeDir := filepath.Join(project, "narration-utils", "findings", "transcript_compare")
	if err := os.MkdirAll(filepath.Join(scopeDir, "c-0001.json"), 0o755); err != nil {
		t.Fatal(err)
	}

	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err == nil {
		t.Fatal("expected an error: the scope file path is a directory, so it cannot be read")
	}
}

func TestSaveAnalyzerFindingsFailsWhenTheReviewHistoryCannotBeRead(t *testing.T) {
	project := t.TempDir()
	reviewPath := filepath.Join(project, "narration-utils", "findings", "review.json")
	if err := os.MkdirAll(reviewPath, 0o755); err != nil {
		t.Fatal(err)
	}

	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err == nil {
		t.Fatal("expected an error: review.json is a directory, so the review history cannot be read")
	}
}

func TestSaveAnalyzerFindingsFailsWhenTheAnalyzerNameCollidesWithAFile(t *testing.T) {
	project := t.TempDir()
	dir := filepath.Join(project, "narration-utils", "findings")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// A plain file sits where the analyzer's own folder needs to go, so
	// writeJSONFile's os.MkdirAll cannot create it.
	if err := os.WriteFile(filepath.Join(dir, "transcript_compare"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err == nil {
		t.Fatal("expected an error: the analyzer folder cannot be created because a file already has that name")
	}
}

func TestRecordDecisionFailsWhenTheReviewHistoryFileCannotBeOverwritten(t *testing.T) {
	project := t.TempDir()
	reviewPath := filepath.Join(project, "narration-utils", "findings", "review.json")
	if err := os.MkdirAll(reviewPath, 0o755); err != nil {
		t.Fatal(err)
	}

	store := NewStore(project)
	if _, _, err := store.RecordDecision("f1", "v1", StatusAccepted, "", "2026-09-19T10:00:00Z"); err == nil {
		t.Fatal("expected an error: review.json is a directory, so CanOverwrite must refuse to replace it")
	}
}

func TestRecordDecisionFailsWhenWritingTheUpdatedScopeFileFails(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}

	scopePath := filepath.Join(project, "narration-utils", "findings", "transcript_compare", "c-0001.json")
	// writeJSONFile writes to path+".tmp" before renaming it into place; make
	// that temporary path a directory so the write itself fails.
	if err := os.MkdirAll(scopePath+".tmp", 0o755); err != nil {
		t.Fatal(err)
	}

	if _, _, err := store.RecordDecision("f1", "v1", StatusAccepted, "", "2026-09-19T10:00:00Z"); err == nil {
		t.Fatal("expected an error: the .tmp write target is a directory")
	}
}

func TestWriteJSONFileFailsWhenTheValueCannotBeMarshalled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	// A channel has no JSON representation; encoding/json refuses it.
	if err := writeJSONFile(path, make(chan int)); err == nil {
		t.Fatal("expected an error for a value json.Marshal cannot encode")
	}
	if _, err := os.Stat(path); err == nil {
		t.Fatal("a failed marshal must not leave a file behind")
	}
}

func TestWriteJSONFileFailsWhenTheFinalPathIsAnExistingDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "target")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(path, []Finding{testFinding("f1", "c-0001", "v1")}); err == nil {
		t.Fatal("expected an error: renaming the temp file over an existing directory must fail")
	}
	// The directory at path must survive untouched: a failed activation must
	// not have destroyed what was there before.
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		t.Fatalf("expected the pre-existing directory at %s to survive a failed rename, got %v, %v", path, info, err)
	}
}

func TestMatchesFiltersByAnalyzerCategoryAndSeverity(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)

	needle := testFinding("f2", "c-0001", "v1")
	needle.Analyzer = "guide"
	needle.Category = CategoryPronunciation
	needle.Severity = SeverityError

	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{
		testFinding("f1", "c-0001", "v1"), // Analyzer transcript_compare, CategoryTranscriptDiscrepancy, SeverityWarning
		needle,
	}); err != nil {
		t.Fatal(err)
	}

	byAnalyzer, err := store.List(Query{Analyzer: "guide"})
	if err != nil {
		t.Fatal(err)
	}
	if len(byAnalyzer) != 1 || byAnalyzer[0].ID != "f2" {
		t.Fatalf("Analyzer filter = %+v", byAnalyzer)
	}

	byCategory, err := store.List(Query{Category: CategoryPronunciation})
	if err != nil {
		t.Fatal(err)
	}
	if len(byCategory) != 1 || byCategory[0].ID != "f2" {
		t.Fatalf("Category filter = %+v", byCategory)
	}

	bySeverity, err := store.List(Query{Severity: SeverityError})
	if err != nil {
		t.Fatal(err)
	}
	if len(bySeverity) != 1 || bySeverity[0].ID != "f2" {
		t.Fatalf("Severity filter = %+v", bySeverity)
	}
}

func TestListFailsWhenAScopeFileCannotBeRead(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}

	scopePath := filepath.Join(project, "narration-utils", "findings", "transcript_compare", "c-0001.json")
	denyRead(t, scopePath)

	if _, err := store.List(Query{}); err == nil {
		t.Fatal("List must surface a real read failure on a scope file scopeFiles already found, not swallow it")
	}
}

func TestGetFailsWhenAScopeFileCannotBeRead(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}

	scopePath := filepath.Join(project, "narration-utils", "findings", "transcript_compare", "c-0001.json")
	denyRead(t, scopePath)

	if _, _, err := store.Get("f1"); err == nil {
		t.Fatal("Get must surface locate's read failure on a scope file, not swallow it")
	}
}

func TestListSortsByChapterThenIDAndTreatsAMissingManuscriptAsAnEmptyChapter(t *testing.T) {
	project := t.TempDir()
	store := NewStore(project)

	noManuscript := testFinding("f-none", "unused", "v1")
	noManuscript.Manuscript = nil

	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{
		testFinding("f-b", "c-0002", "v1"),
		testFinding("f-a", "c-0001", "v1"),
		noManuscript,
	}); err != nil {
		t.Fatal(err)
	}

	all, err := store.List(Query{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("expected 3 findings, got %+v", all)
	}
	got := []string{all[0].ID, all[1].ID, all[2].ID}
	want := []string{"f-none", "f-a", "f-b"} // "" (no manuscript) < c-0001 < c-0002
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("List() order = %v, want %v (chapter id, then finding id)", got, want)
		}
	}
}
