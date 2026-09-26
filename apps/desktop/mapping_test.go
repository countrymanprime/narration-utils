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

// Credits are never chapters (ADR 0150), but credits-in-chapter-table PRD Phase 3 lets the narrator confirm a track
// link for the opening or closing credits the same way as a chapter: chapterTitle recognizes "credits-opening" and
// "credits-closing" with the fixed row labels creditsScriptTitles already gives them, so the existing
// ChapterTrackMapConfirm binding accepts them without a new binding or a manuscript.json entry.
func TestChapterTrackMapConfirmAcceptsACreditsID(t *testing.T) {
	host, _ := newTestHostForMapping(t)

	raw, err := host.ChapterTrackMapConfirm("track-guid-credits", "credits-opening")
	if err != nil {
		t.Fatalf("confirming the opening credits' track link: %v", err)
	}
	confirmed := decodeBinding(t, raw)
	if confirmed["chapterId"] != "credits-opening" || confirmed["chapterTitle"] != "Opening credits" {
		t.Fatalf("ChapterTrackMapConfirm(credits-opening) = %#v", confirmed)
	}
}

func TestChapterTrackMapConfirmRejectsAnUnknownCreditsKind(t *testing.T) {
	host, _ := newTestHostForMapping(t)
	if _, err := host.ChapterTrackMapConfirm("track-guid-a", "credits-chapter_announcement"); err == nil {
		t.Fatal("expected an error: only opening and closing have a fixed row label")
	}
}

func TestCreditsRowTitle(t *testing.T) {
	for chapterID, want := range map[string]string{
		"credits-opening": "Opening credits",
		"credits-closing": "Closing credits",
	} {
		if title, ok := creditsRowTitle(chapterID); !ok || title != want {
			t.Fatalf("creditsRowTitle(%q) = %q, %v, want %q, true", chapterID, title, ok, want)
		}
	}
	for _, chapterID := range []string{"credits-chapter_announcement", "credits-", "credits", "c-0001", ""} {
		if _, ok := creditsRowTitle(chapterID); ok {
			t.Fatalf("creditsRowTitle(%q) should not resolve", chapterID)
		}
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
