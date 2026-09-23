package importer

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func textPointer(value string) *string { return &value }

// twoChapterDraft is a Word-shaped draft: "The Girl Who" / "Fell Through the Ice" is a wrapped title the heuristic split (F1),
// "Chapter Two" / "The Storm" is a real subtitle.
func twoChapterDraft(t *testing.T) Draft {
	t.Helper()
	paragraphs := []Paragraph{
		{Chapter: "The Girl Who", ChapterSubtitle: textPointer("Fell Through the Ice"), Text: "The ice was thin.", SourceIndex: 0},
		{Chapter: "The Girl Who", ChapterSubtitle: textPointer("Fell Through the Ice"), Text: "She fell.", SourceIndex: 1},
		{Chapter: "Chapter Two", ChapterSubtitle: textPointer("The Storm"), Text: "It rained.", SourceIndex: 2},
	}
	draft, err := newDraft("docx", "book.docx", paragraphs, []string{"The Girl Who", "Chapter Two"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func TestNewDraftSaysWhereASubtitleGoesWhenItIsTurnedOff(t *testing.T) {
	draft := twoChapterDraft(t)
	if got := draft.Sections[0].SubtitleOff; got != SubtitleOffJoinsTitle {
		t.Fatalf("a heading's second line turned off goes to %q, want %q", got, SubtitleOffJoinsTitle)
	}
	txt, err := newDraft("txt", "book.txt", []Paragraph{
		{Chapter: "Chapter One", ChapterSubtitle: textPointer("“Water finds its level.”"), SubtitleReturnsToBody: true, Text: "It rained.", SourceIndex: 0},
		{Chapter: "Chapter Two", Text: "No subtitle here.", SourceIndex: 1},
	}, []string{"Chapter One", "Chapter Two"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := txt.Sections[0].SubtitleOff; got != SubtitleOffReturnsToBody {
		t.Fatalf("a plain-text line under a heading turned off goes to %q, want %q", got, SubtitleOffReturnsToBody)
	}
	if got := txt.Sections[1].SubtitleOff; got != "" {
		t.Fatalf("a section with no subtitle has nothing to turn off, got %q", got)
	}
}

func TestApplySubtitleOverridesWithNoChoicesLeavesTheDraftAsItWas(t *testing.T) {
	draft := twoChapterDraft(t)
	for _, overrides := range []map[string]bool{nil, {}, {"section-0002": true}} {
		got, err := ApplySubtitleOverrides(draft, overrides)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, draft) {
			t.Fatalf("overrides %v changed the draft:\n%#v\nwant\n%#v", overrides, got, draft)
		}
	}
}

func TestApplySubtitleOverridesJoinsAWrappedTitleBackTogether(t *testing.T) {
	draft := twoChapterDraft(t)
	got, err := ApplySubtitleOverrides(draft, map[string]bool{"section-0001": false})
	if err != nil {
		t.Fatal(err)
	}
	want := "The Girl Who Fell Through the Ice"
	if section := got.Sections[0]; section.Title != want || section.Subtitle != "" || section.SubtitleOff != "" || section.ParagraphCount != 2 {
		t.Fatalf("section = %+v, want %q with no subtitle and its 2 paragraphs", section, want)
	}
	for _, paragraph := range got.Paragraphs[:2] {
		if paragraph.Chapter != want || paragraph.ChapterSubtitle != nil {
			t.Fatalf("paragraph %q is under %q / %v, want %q with no subtitle", paragraph.Text, paragraph.Chapter, paragraph.ChapterSubtitle, want)
		}
	}
	if got.ChapterTitles[0] != want || got.ChapterTitles[1] != "Chapter Two" {
		t.Fatalf("chapter titles = %q", got.ChapterTitles)
	}
	if got.Sections[1].Subtitle != "The Storm" || *got.Paragraphs[2].ChapterSubtitle != "The Storm" {
		t.Fatal("a section that was not turned off keeps its subtitle")
	}
	if draft.Sections[0].Title != "The Girl Who" || draft.Paragraphs[0].Chapter != "The Girl Who" || *draft.Paragraphs[0].ChapterSubtitle != "Fell Through the Ice" {
		t.Fatal("the draft the override was applied to must not change: the narrator can still change their mind before the commit")
	}
}

func TestApplySubtitleOverridesReturnsAPlainTextLineToTheBody(t *testing.T) {
	section := "Aside"
	draft, err := newDraft("txt", "book.txt", []Paragraph{
		{Chapter: "Front Matter", Text: "By Jane Author", SourceIndex: 0},
		{Chapter: "Chapter One", ChapterSubtitle: textPointer("“Water finds its level.”"), SubtitleReturnsToBody: true, Section: &section, Text: "It rained.", SourceIndex: 1},
		{Chapter: "Chapter One", ChapterSubtitle: textPointer("“Water finds its level.”"), Text: "It stopped.", SourceIndex: 2},
	}, []string{"Chapter One"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	id := sectionNamed(t, draft, "Chapter One").ID
	got, err := ApplySubtitleOverrides(draft, map[string]bool{id: false})
	if err != nil {
		t.Fatal(err)
	}
	texts := make([]string, len(got.Paragraphs))
	for index, paragraph := range got.Paragraphs {
		texts[index] = paragraph.Text
		if paragraph.ChapterSubtitle != nil {
			t.Fatalf("paragraph %q still has the subtitle %q", paragraph.Text, *paragraph.ChapterSubtitle)
		}
	}
	if want := []string{"By Jane Author", "“Water finds its level.”", "It rained.", "It stopped."}; !reflect.DeepEqual(texts, want) {
		t.Fatalf("paragraphs = %q, want %q", texts, want)
	}
	returned := got.Paragraphs[1]
	if returned.Chapter != "Chapter One" || returned.Section != nil || returned.SourceIndex != 1 {
		t.Fatalf("the returned line = %+v, want it first in Chapter One, in no subsection, at its heading's source index", returned)
	}
	if chapter := sectionNamed(t, got, "Chapter One"); chapter.Subtitle != "" || chapter.ParagraphCount != 3 {
		t.Fatalf("section = %+v, want no subtitle and 3 paragraphs", chapter)
	}
	if len(draft.Paragraphs) != 3 {
		t.Fatal("the draft the override was applied to must not change")
	}
}

// A repeated plain-text heading is one section, but each of its headings had its own line under it: turned off, every one of those
// lines returns to the text where its heading was, so none is lost (review finding on this phase).
func TestApplySubtitleOverridesReturnsTheLineOfEveryRepeatedHeading(t *testing.T) {
	draft, err := buildDraftFromText(t, "Chapter One\nA letter arrives.\n\nBody one.\n\nChapter One\nA letter departs.\n\nBody two.\n")
	if err != nil {
		t.Fatal(err)
	}
	id := sectionNamed(t, draft, "Chapter One").ID
	got, err := ApplySubtitleOverrides(draft, map[string]bool{id: false})
	if err != nil {
		t.Fatal(err)
	}
	texts := []string{}
	for _, paragraph := range got.Paragraphs {
		if paragraph.Chapter == "Chapter One" {
			texts = append(texts, paragraph.Text)
		}
	}
	if want := []string{"A letter arrives.", "Body one.", "A letter departs.", "Body two."}; !reflect.DeepEqual(texts, want) {
		t.Fatalf("Chapter One paragraphs = %q, want %q", texts, want)
	}
	if section := sectionNamed(t, got, "Chapter One"); section.ParagraphCount != 4 {
		t.Fatalf("section paragraph count = %d, want 4", section.ParagraphCount)
	}
}

// buildDraftFromText imports a plain-text manuscript written to a temporary file.
func buildDraftFromText(t *testing.T, text string) (Draft, error) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.txt")
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	return BuildDraft(path, 1)
}

func TestApplySubtitleOverridesRefusesASectionThePreviewDidNotHave(t *testing.T) {
	_, err := ApplySubtitleOverrides(twoChapterDraft(t), map[string]bool{"section-9999": false})
	if err == nil || !strings.Contains(err.Error(), "subtitle") {
		t.Fatalf("err = %v, want a refusal that names the subtitle choice", err)
	}
}

func TestApplySubtitleOverridesIgnoresOffOnASectionWithNoSubtitle(t *testing.T) {
	draft, err := newDraft("docx", "book.docx", []Paragraph{{Chapter: "Chapter One", Text: "Text.", SourceIndex: 0}}, []string{"Chapter One"}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ApplySubtitleOverrides(draft, map[string]bool{"section-0001": false})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, draft) {
		t.Fatal("turning off a subtitle a section does not have must change nothing")
	}
}
