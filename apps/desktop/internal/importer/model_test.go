package importer

import (
	"os"
	"path/filepath"
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
