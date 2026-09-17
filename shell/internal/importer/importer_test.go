package importer

import (
	"path/filepath"
	"testing"
)

func fixture(name string) string {
	return filepath.Join("..", "..", "..", "shared", "test-fixtures", name)
}

func TestMarkdownFixtureRetainsTitleAndNarrativeChapters(t *testing.T) {
	draft, err := BuildDraft(fixture("alice.md"), 1)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Format != "markdown" || len(draft.ChapterTitles) != 4 {
		t.Fatalf("unexpected draft: %#v", draft)
	}
	if draft.ChapterTitles[1] != "Chapter I: Down the Rabbit-Hole" {
		t.Fatalf("unexpected title: %q", draft.ChapterTitles[1])
	}
}

func TestDocxFixtureRetainsTitleAndNarrativeChapters(t *testing.T) {
	draft, err := BuildDraft(fixture("alice.docx"), 1)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Format != "docx" || len(draft.ChapterTitles) != 4 {
		t.Fatalf("unexpected draft: %#v", draft)
	}
	if draft.ChapterTitles[3] != "Chapter III: A Caucus-Race and a Long Tale" {
		t.Fatalf("unexpected title: %q", draft.ChapterTitles[3])
	}
}

func TestPDFFixtureIsRejectedUntilChapterBoundariesAreReliable(t *testing.T) {
	_, err := BuildDraft(fixture("alice.pdf"), 1)
	if err == nil {
		t.Fatal("the known-unreliable PDF fixture must not be imported")
	}
}

func TestMarkdownHeadingLevelIsValidated(t *testing.T) {
	_, err := BuildDraft(fixture("alice.md"), 7)
	if err == nil {
		t.Fatal("expected invalid heading level to fail")
	}
}
