package importer

import (
	"os"
	"path/filepath"
	"testing"
)

func importMarkdown(t *testing.T, content string) Draft {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.md")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	draft, err := markdown(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func TestMarkdownByteOrderMarkIsStripped(t *testing.T) {
	draft := importMarkdown(t, "\xef\xbb\xbf# Chapter One\nBody.\n")
	if draft.Paragraphs[0].Chapter != "Chapter One" {
		t.Fatalf("chapter = %q", draft.Paragraphs[0].Chapter)
	}
}

func TestMarkdownWrappedLinesJoinWithASpace(t *testing.T) {
	draft := importMarkdown(t, "# Chapter One\nfirst line\nsecond line\n")
	if got := draft.Paragraphs[0].Text; got != "first line second line" {
		t.Fatalf("got %q", got)
	}
}

func TestMarkdownHardBreaksBecomeNewlines(t *testing.T) {
	draft := importMarkdown(t, "# Chapter One\nRoses are red,  \nviolets are blue,\\\nsugar is sweet.\nAnd so are you.\n")
	if got, want := draft.Paragraphs[0].Text, "Roses are red,\nviolets are blue,\nsugar is sweet. And so are you."; got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestMarkdownBrTagBecomesNewline(t *testing.T) {
	draft := importMarkdown(t, "# Chapter One\nOne<br>Two<br/>Three\n")
	if got, want := draft.Paragraphs[0].Text, "One\nTwo\nThree"; got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestMarkdownEmphasisBecomesSpansAndDropsMarkers(t *testing.T) {
	draft := importMarkdown(t, "# Chapter One\nShe said *never*, **really**, <u>ever</u>, and ***truly***.\n")
	paragraph := draft.Paragraphs[0]
	if want := "She said never, really, ever, and truly."; paragraph.Text != want {
		t.Fatalf("text = %q want %q", paragraph.Text, want)
	}
	want := []Span{
		{Start: 9, End: 14, Style: "italic"},
		{Start: 16, End: 22, Style: "bold"},
		{Start: 24, End: 28, Style: "underline"},
		{Start: 34, End: 39, Style: "bold"},
		{Start: 34, End: 39, Style: "italic"},
	}
	if len(paragraph.Spans) != len(want) {
		t.Fatalf("spans = %#v", paragraph.Spans)
	}
	for index := range want {
		if paragraph.Spans[index] != want[index] {
			t.Fatalf("span %d = %#v want %#v", index, paragraph.Spans[index], want[index])
		}
	}
}

func TestMarkdownIntrawordUnderscoresAndLoneAsterisksStayLiteral(t *testing.T) {
	draft := importMarkdown(t, "# Chapter One\nsnake_case_name and 2 * 3 * 4 and a * b\n")
	paragraph := draft.Paragraphs[0]
	if want := "snake_case_name and 2 * 3 * 4 and a * b"; paragraph.Text != want || len(paragraph.Spans) != 0 {
		t.Fatalf("got %q spans %#v", paragraph.Text, paragraph.Spans)
	}
}

func TestMarkdownEscapedMarkersStayLiteral(t *testing.T) {
	draft := importMarkdown(t, "# Chapter One\nnot \\*emphasis\\* here\n")
	paragraph := draft.Paragraphs[0]
	if want := "not *emphasis* here"; paragraph.Text != want || len(paragraph.Spans) != 0 {
		t.Fatalf("got %q spans %#v", paragraph.Text, paragraph.Spans)
	}
}

func TestMarkdownHeadingBrSplitsSubtitleAndStripsMarkers(t *testing.T) {
	draft := importMarkdown(t, "# **CHAPTER ONE**<br>Bad Ideas Look Great in Neon\nBody.\n")
	paragraph := draft.Paragraphs[0]
	if paragraph.Chapter != "CHAPTER ONE" || subtitleOf(paragraph) != "Bad Ideas Look Great in Neon" {
		t.Fatalf("got chapter %q subtitle %q", paragraph.Chapter, subtitleOf(paragraph))
	}
}

func TestMarkdownHeadingSubtitleReachesTheSectionForTheReview(t *testing.T) {
	draft := importMarkdown(t, "# **CHAPTER ONE**<br>Bad Ideas Look Great in Neon\nBody.\n\n# CHAPTER TWO\nMore.\n")
	if got := sectionNamed(t, draft, "CHAPTER ONE").Subtitle; got != "Bad Ideas Look Great in Neon" {
		t.Fatalf("CHAPTER ONE subtitle = %q", got)
	}
	if got := sectionNamed(t, draft, "CHAPTER TWO").Subtitle; got != "" {
		t.Fatalf("CHAPTER TWO has no subtitle, got %q", got)
	}
}
