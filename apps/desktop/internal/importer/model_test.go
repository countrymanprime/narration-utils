package importer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewDraftGivesContentsItsOwnGroupInsteadOfLeakingIntoPriorSection(t *testing.T) {
	paragraphs := []Paragraph{
		{Chapter: "Chapter One", Text: "Chapter one text.", SourceIndex: 0},
		{Chapter: "Contents", Text: "Chapter One .... 1", SourceIndex: 1},
		{Chapter: "Chapter Two", Text: "Chapter two text.", SourceIndex: 2},
	}
	draft, err := newDraft("docx", "test.docx", paragraphs, []string{"Chapter One", "Chapter Two"})
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]string{}
	counts := map[string]int{}
	for _, section := range draft.Sections {
		kinds[section.Title] = section.ContentKind
		counts[section.Title] = section.ParagraphCount
	}
	if kinds["Contents"] != "reference" {
		t.Fatalf("expected Contents section to be classified as reference, got %q", kinds["Contents"])
	}
	if counts["Chapter One"] != 1 {
		t.Fatalf("expected Chapter One to keep only its own paragraph, got %d", counts["Chapter One"])
	}
	if kinds["Chapter One"] != "narration" {
		t.Fatalf("expected Chapter One to stay narration, got %q", kinds["Chapter One"])
	}
}

func TestNewDraftClassifiesFrontMatterAsOpening(t *testing.T) {
	paragraphs := []Paragraph{
		{Chapter: "Front Matter", Text: "By Jane Author", SourceIndex: 0},
		{Chapter: "Chapter One", Text: "Chapter one text.", SourceIndex: 1},
	}
	draft, err := newDraft("docx", "test.docx", paragraphs, []string{"Chapter One"})
	if err != nil {
		t.Fatal(err)
	}
	for _, section := range draft.Sections {
		if section.Title == "Front Matter" && section.ContentKind != "opening" {
			t.Fatalf("expected Front Matter to be classified as opening, got %q", section.ContentKind)
		}
	}
}

func TestMarkdownContentsHeadingGetsItsOwnGroup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "book.md")
	content := "# Chapter One\nChapter one text.\n\n# Contents\nChapter One .... 1\n\n# Chapter Two\nChapter two text.\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	draft, err := markdown(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, paragraph := range draft.Paragraphs {
		if paragraph.Chapter == "Chapter One" && paragraph.Text != "Chapter one text." {
			t.Fatalf("Chapter One accumulated an unexpected paragraph: %q", paragraph.Text)
		}
	}
	var sawContents bool
	for _, section := range draft.Sections {
		if section.Title == "Contents" {
			sawContents = true
			if section.ContentKind != "reference" {
				t.Fatalf("expected Contents to be reference, got %q", section.ContentKind)
			}
		}
	}
	if !sawContents {
		t.Fatal("expected a Contents section in the draft")
	}
	if len(draft.ChapterTitles) != 2 {
		t.Fatalf("expected Contents to be excluded from chapter titles, got %#v", draft.ChapterTitles)
	}
}

func sectionNamed(t *testing.T, draft Draft, title string) DraftSection {
	t.Helper()
	for _, section := range draft.Sections {
		if section.Title == title {
			return section
		}
	}
	t.Fatalf("no section %q in %#v", title, draft.Sections)
	return DraftSection{}
}

func subtitled(chapter, subtitle, text string, index int) Paragraph {
	return Paragraph{Chapter: chapter, ChapterSubtitle: &subtitle, Text: text, SourceIndex: index}
}

func TestNewDraftSectionSubtitleIsTheFirstParagraphsSubtitleAsTheCommitReadsIt(t *testing.T) {
	paragraphs := []Paragraph{
		subtitled("Chapter One", "Down the Rabbit-Hole", "First.", 0),
		{Chapter: "Chapter Two", Text: "No subtitle here.", SourceIndex: 1},
		// A title that repeats merges into the first section, and the first subtitle wins, as it does when the chapter is written.
		subtitled("Chapter One", "A Later Subtitle", "Second.", 2),
		// The first paragraph has none and a later one does: the chapter is written from the first paragraph, so it has none.
		{Chapter: "Chapter Three", Text: "Plain.", SourceIndex: 3},
		subtitled("Chapter Three", "The Pool of Tears", "Later.", 4),
	}
	draft, err := newDraft("docx", "test.docx", paragraphs, []string{"Chapter One", "Chapter Two", "Chapter Three", "Chapter Four"})
	if err != nil {
		t.Fatal(err)
	}
	for title, want := range map[string]string{
		"Chapter One":   "Down the Rabbit-Hole",
		"Chapter Two":   "",
		"Chapter Three": "",
		// A heading with no paragraphs under it has nothing to take a subtitle from.
		"Chapter Four": "",
	} {
		if got := sectionNamed(t, draft, title).Subtitle; got != want {
			t.Errorf("section %q subtitle = %q, want %q", title, got, want)
		}
	}
}

func TestNewDraftSectionWithoutSubtitleSendsNoSubtitleField(t *testing.T) {
	draft, err := newDraft("docx", "test.docx", []Paragraph{{Chapter: "Chapter One", Text: "Text.", SourceIndex: 0}}, []string{"Chapter One"})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(draft.Sections[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "subtitle") {
		t.Fatalf("a section without a subtitle must not carry the field, got %s", encoded)
	}
}
