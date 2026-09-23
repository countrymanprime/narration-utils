package main

import (
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// newTestHostForMapping builds a Host over a project with a committed
// manuscript (three chapters, per tests/fixtures/alice.md), the same fixture
// TestCommitCreatesProjectOwnedCanonicalManuscript uses in the manuscript
// package's own tests.
func newTestHostForMapping(t *testing.T) (*Host, string) {
	t.Helper()
	project := t.TempDir()
	service := manuscript.New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, false, manuscript.Choices{}); err != nil {
		t.Fatal(err)
	}
	chapters, err := service.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	if len(chapters) != 3 {
		t.Fatalf("fixture chapters = %d, want 3", len(chapters))
	}
	host := &Host{settings: settings.New(t.TempDir(), project), manuscript: service}
	host.config.projectFolder = project
	return host, chapters[0]["id"].(string)
}

func decodeBinding(t *testing.T, raw string) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatalf("could not decode binding payload %q: %v", raw, err)
	}
	return result
}

func TestChapterTrackMapListIsEmptyBeforeAnyConfirmation(t *testing.T) {
	host, _ := newTestHostForMapping(t)
	raw, err := host.ChapterTrackMapList()
	if err != nil {
		t.Fatal(err)
	}
	result := decodeBinding(t, raw)
	mappings, _ := result["mappings"].([]any)
	if len(mappings) != 0 {
		t.Fatalf("mappings = %#v, want none before any confirmation", mappings)
	}
	if result["documentId"] == "" {
		t.Fatal("documentId was not returned")
	}
}

func TestChapterTrackMapConfirmThenListRoundTrips(t *testing.T) {
	host, firstChapterID := newTestHostForMapping(t)

	raw, err := host.ChapterTrackMapConfirm("track-guid-a", firstChapterID)
	if err != nil {
		t.Fatal(err)
	}
	confirmed := decodeBinding(t, raw)
	if confirmed["trackGuid"] != "track-guid-a" || confirmed["chapterId"] != firstChapterID {
		t.Fatalf("ChapterTrackMapConfirm returned %#v", confirmed)
	}
	if confirmed["chapterTitle"] != "Chapter I: Down the Rabbit-Hole" {
		t.Fatalf("chapterTitle = %v, want the real chapter title (Q6/Q9 depend on it)", confirmed["chapterTitle"])
	}
	if confirmed["confirmedAt"] == "" || confirmed["confirmedAt"] == nil {
		t.Fatal("confirmedAt was not stamped")
	}

	listRaw, err := host.ChapterTrackMapList()
	if err != nil {
		t.Fatal(err)
	}
	list := decodeBinding(t, listRaw)
	mappings, _ := list["mappings"].([]any)
	if len(mappings) != 1 {
		t.Fatalf("mappings = %#v, want the one confirmed link", mappings)
	}
}

func TestChapterTrackMapConfirmRejectsAChapterIDNotInTheManuscript(t *testing.T) {
	host, _ := newTestHostForMapping(t)
	if _, err := host.ChapterTrackMapConfirm("track-guid-a", "c-9999"); err == nil {
		t.Fatal("expected an error confirming a chapter id outside the current manuscript")
	}
}

func TestChapterTrackMapClearRemovesTheLinkAndReturnsWhatRemains(t *testing.T) {
	host, firstChapterID := newTestHostForMapping(t)
	chapters, err := host.services().manuscript.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	secondChapterID := chapters[1]["id"].(string)

	if _, err := host.ChapterTrackMapConfirm("track-guid-a", firstChapterID); err != nil {
		t.Fatal(err)
	}
	if _, err := host.ChapterTrackMapConfirm("track-guid-b", secondChapterID); err != nil {
		t.Fatal(err)
	}

	clearedRaw, err := host.ChapterTrackMapClear("track-guid-a")
	if err != nil {
		t.Fatal(err)
	}
	cleared := decodeBinding(t, clearedRaw)
	mappings, _ := cleared["mappings"].([]any)
	if len(mappings) != 1 {
		t.Fatalf("mappings after clear = %#v, want only track-guid-b left", mappings)
	}
	remaining, _ := mappings[0].(map[string]any)
	if remaining["trackGuid"] != "track-guid-b" {
		t.Fatalf("remaining mapping = %#v", remaining)
	}
}

func TestChapterTrackMapListErrorsWithoutAProject(t *testing.T) {
	host := &Host{}
	if _, err := host.ChapterTrackMapList(); err == nil {
		t.Fatal("expected an error with no project open")
	}
}

func TestChapterTrackMapListErrorsWithoutAnImportedManuscript(t *testing.T) {
	project := t.TempDir()
	host := &Host{settings: settings.New(t.TempDir(), project)}
	host.config.projectFolder = project
	if _, err := host.ChapterTrackMapList(); err == nil {
		t.Fatal("expected an error before a manuscript has been imported")
	}
}

// A confirmed link is keyed by documentId (Q6): after a manuscript
// re-import produces a new store (a fresh evidence.NewMappingStore over the
// same project once resetDerived cleared the old file, as
// manuscript.resetDerived now does), the old confirmation must not leak
// through as if it belonged to the new document.
func TestChapterTrackMapDoesNotSurviveInAFreshMappingStoreForAnUnrelatedDocument(t *testing.T) {
	project := t.TempDir()
	store := evidence.NewMappingStore(project)
	if _, err := store.Confirm("doc-old", "track-guid-a", "c-0001", "Chapter One"); err != nil {
		t.Fatal(err)
	}
	list, err := store.List("doc-new")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("List(doc-new) = %#v, want empty", list)
	}
}
