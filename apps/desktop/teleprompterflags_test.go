package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/liveflags"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
)

const flagsManuscript = `{"schemaVersion":1,"documentId":"alice-1","importedAt":"2026-09-01T09:30:00Z","importer":{"format":"docx"},` +
	`"source":{"fileName":"Alice.docx"},` +
	`"chapters":[{"id":"ch-1","title":"Down the Rabbit-Hole","index":0,"wordCount":30,"contentKind":"narration"}],` +
	`"paragraphs":[` +
	`{"id":"p-1","chapterId":"ch-1","chapterTitle":"Down the Rabbit-Hole","index":0,"text":"Alice was beginning to get very tired of sitting by her sister on the bank."},` +
	`{"id":"p-2","chapterId":"ch-1","chapterTitle":"Down the Rabbit-Hole","index":1,"text":"Once or twice she had peeped into the book her sister was reading."}]}`

// newTestHostForFlags is a project with an imported manuscript and a findings store, the two services the save needs.
func newTestHostForFlags(t *testing.T) (*Host, string) {
	t.Helper()
	project := t.TempDir()
	path := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(flagsManuscript), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &Host{manuscript: manuscript.New(project), findings: findings.NewStore(project)}
	host.config.projectFolder = project
	return host, project
}

var sessionFlags = []liveflags.Flag{
	{Kind: "misread", ParagraphID: "p-1", WordStart: 2, WordEnd: 3, ScriptStart: 5, ScriptEnd: 6, Heard: "begging"},
	{Kind: "skipped", ParagraphID: "p-1", WordStart: 5, WordEnd: 7, ScriptStart: 8, ScriptEnd: 10},
	{Kind: "restart", ParagraphID: "p-2", WordStart: 3, WordEnd: 8, ScriptStart: 20, ScriptEnd: 25, Heard: "she had peeped into the"},
}

var flagsNow = time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)

func TestTeleprompterSaveFlagsWritesSuspectedUnreviewedFindings(t *testing.T) {
	host, project := newTestHostForFlags(t)
	saved, err := host.teleprompterSaveFlags("ch-1", sessionFlags, flagsNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved) != len(sessionFlags) {
		t.Fatalf("saved %d findings for %d flags; the result is one finding per flag, in order", len(saved), len(sessionFlags))
	}
	if saved[0].Category != findings.CategoryTranscriptDiscrepancy || saved[2].Category != findings.CategoryPickup {
		t.Fatalf("categories = %s, %s", saved[0].Category, saved[2].Category)
	}
	for _, f := range saved {
		if f.Review.Status != findings.StatusUnreviewed || f.Confidence != nil {
			t.Fatalf("%s: status %s confidence %v; a live flag is unreviewed and unscored", f.ID, f.Review.Status, f.Confidence)
		}
	}
	file := filepath.Join(project, "narration-utils", "findings", "teleprompter", "ch-1.json")
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("findings file not written: %v", err)
	}
	var stored []findings.Finding
	if err := json.Unmarshal(raw, &stored); err != nil || len(stored) != 3 {
		t.Fatalf("stored %d findings (%v)", len(stored), err)
	}
}

func TestTeleprompterSaveFlagsTwiceDoesNotPileUpDuplicates(t *testing.T) {
	host, _ := newTestHostForFlags(t)
	for range 2 {
		if _, err := host.teleprompterSaveFlags("ch-1", sessionFlags, flagsNow); err != nil {
			t.Fatal(err)
		}
	}
	// A later session over only the second paragraph keeps the first paragraph's flags as they were.
	if _, err := host.teleprompterSaveFlags("ch-1", sessionFlags[2:], flagsNow); err != nil {
		t.Fatal(err)
	}
	all, err := host.findings.List(findings.Query{Analyzer: liveflags.AnalyzerName})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("store holds %d live-flag findings after re-running the session, want 3", len(all))
	}
}

func TestTeleprompterSaveFlagsRecordsADismissOnceAndKeepsIt(t *testing.T) {
	host, project := newTestHostForFlags(t)
	dismissed := append([]liveflags.Flag(nil), sessionFlags...)
	dismissed[0].Dismissed = true
	saved, err := host.teleprompterSaveFlags("ch-1", dismissed, flagsNow)
	if err != nil {
		t.Fatal(err)
	}
	if saved[0].Review.Status != findings.StatusDismissed || saved[1].Review.Status != findings.StatusUnreviewed {
		t.Fatalf("statuses = %s, %s", saved[0].Review.Status, saved[1].Review.Status)
	}
	// Saving the same dismissal again (the dialog saves on every end and close) does not append another decision, and a
	// later session that raises the same flag with the same heard text finds it already dismissed.
	if _, err := host.teleprompterSaveFlags("ch-1", dismissed, flagsNow); err != nil {
		t.Fatal(err)
	}
	again, err := host.teleprompterSaveFlags("ch-1", sessionFlags, flagsNow)
	if err != nil {
		t.Fatal(err)
	}
	if again[0].Review.Status != findings.StatusDismissed {
		t.Fatalf("a dismissed flag raised again came back %s", again[0].Review.Status)
	}
	raw, err := os.ReadFile(filepath.Join(project, "narration-utils", "findings", "review.json"))
	if err != nil {
		t.Fatal(err)
	}
	if count := strings.Count(string(raw), `"finding_id"`); count != 1 {
		t.Fatalf("review history holds %d decisions, want 1", count)
	}
}

func TestTeleprompterSaveFlagsRejectsWhatTheManuscriptDoesNotHave(t *testing.T) {
	host, project := newTestHostForFlags(t)
	bad := []liveflags.Flag{sessionFlags[0], {Kind: "misread", ParagraphID: "p-404", WordStart: 0, WordEnd: 1}}
	if _, err := host.teleprompterSaveFlags("ch-1", bad, flagsNow); err == nil || !strings.Contains(err.Error(), "p-404") {
		t.Fatalf("err = %v, want the unknown paragraph named", err)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "findings")); !os.IsNotExist(err) {
		t.Fatal("a rejected save wrote something")
	}
	if _, err := host.teleprompterSaveFlags("ch-9", sessionFlags, flagsNow); err == nil {
		t.Fatal("a chapter with no paragraphs was accepted")
	}
}

func TestTeleprompterSaveFlagsWithNothingToSaveWritesNothing(t *testing.T) {
	host, project := newTestHostForFlags(t)
	saved, err := host.teleprompterSaveFlags("ch-1", nil, flagsNow)
	if err != nil || len(saved) != 0 {
		t.Fatalf("saved %v, err %v", saved, err)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "findings")); !os.IsNotExist(err) {
		t.Fatal("an empty save wrote a findings folder")
	}
}

// The findings TeleprompterSaveFlags answers (Phase 7, ADR 0117): one flag of every kind, the misread dismissed in the
// dialog, so the result pins both categories, a zero-width extra and a dismissed decision. The temp project folder is
// replaced with a fixed one so the file is stable.
func TestContractTeleprompterSaveFlags(t *testing.T) {
	host, _ := newTestHostForFlags(t)
	flags := append([]liveflags.Flag(nil), sessionFlags...)
	flags[0].Dismissed = true
	flags = append(flags, liveflags.Flag{Kind: "extra", ParagraphID: "p-2", WordStart: 8, WordEnd: 9, ScriptStart: 25, ScriptEnd: 25, Heard: "old"})
	saved, err := host.teleprompterSaveFlags("ch-1", flags, flagsNow)
	if err != nil {
		t.Fatal(err)
	}
	for index := range saved {
		saved[index].Project.Path = "C:/Projects/Alice"
	}
	contractfile.Check(t, "teleprompter-save-flags", saved)
}

func TestTeleprompterSaveFlagsNeedsAnOpenProject(t *testing.T) {
	host := &Host{}
	if _, err := host.teleprompterSaveFlags("ch-1", sessionFlags, flagsNow); err == nil || !strings.Contains(err.Error(), "no project is open") {
		t.Fatalf("err = %v", err)
	}
}
