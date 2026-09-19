package importer

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// docxFixture writes a minimal .docx whose word/document.xml body is the
// given WordprocessingML. Building the archive in-test keeps hostile
// formatting (soft breaks, tabs, split runs) reviewable next to its assertion
// instead of hiding it inside a binary fixture.
func docxFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.docx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	entries := map[string]string{
		"word/styles.xml": `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
			`<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
			`<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>` +
			`<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style></w:styles>`,
		"word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body + `</w:body></w:document>`,
	}
	for name, content := range entries {
		writer, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func wordRun(text string, props ...string) string {
	properties := ""
	if len(props) > 0 {
		properties = "<w:rPr>" + strings.Join(props, "") + "</w:rPr>"
	}
	return "<w:r>" + properties + `<w:t xml:space="preserve">` + text + "</w:t></w:r>"
}

func wordParagraph(style string, runs ...string) string {
	properties := ""
	if style != "" {
		properties = `<w:pPr><w:pStyle w:val="` + style + `"/></w:pPr>`
	}
	return "<w:p>" + properties + strings.Join(runs, "") + "</w:p>"
}

const softBreak = "<w:r><w:br/></w:r>"

func importDocx(t *testing.T, body string) Draft {
	t.Helper()
	draft, err := BuildDraft(docxFixture(t, body), 1)
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func subtitleOf(paragraph Paragraph) string {
	if paragraph.ChapterSubtitle == nil {
		return ""
	}
	return *paragraph.ChapterSubtitle
}

func TestDocxHeadingSoftBreakSplitsTitleAndSubtitle(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("CHAPTER ONE"), softBreak, wordRun("Bad Ideas Look Great in Neon"))+
		wordParagraph("", wordRun("The first line.")))
	paragraph := draft.Paragraphs[0]
	if paragraph.Chapter != "CHAPTER ONE" || subtitleOf(paragraph) != "Bad Ideas Look Great in Neon" {
		t.Fatalf("got chapter %q subtitle %q", paragraph.Chapter, subtitleOf(paragraph))
	}
}

func TestDocxHeadingTabSplitsTitleAndSubtitle(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter 1"), "<w:r><w:tab/></w:r>", wordRun("The Start"))+
		wordParagraph("", wordRun("Body.")))
	paragraph := draft.Paragraphs[0]
	if paragraph.Chapter != "Chapter 1" || subtitleOf(paragraph) != "The Start" {
		t.Fatalf("got chapter %q subtitle %q", paragraph.Chapter, subtitleOf(paragraph))
	}
}

func TestDocxGluedHeadingRunsAreSplitAndReported(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("CHAPTER ONE", "<w:b/>"), wordRun("Bad Ideas Look Great in Neon"))+
		wordParagraph("", wordRun("Body.")))
	paragraph := draft.Paragraphs[0]
	if paragraph.Chapter != "CHAPTER ONE" || subtitleOf(paragraph) != "Bad Ideas Look Great in Neon" {
		t.Fatalf("got chapter %q subtitle %q", paragraph.Chapter, subtitleOf(paragraph))
	}
	if len(draft.Notices) != 1 || !strings.Contains(draft.Notices[0], "CHAPTER ONE") {
		t.Fatalf("expected one notice describing the split, got %#v", draft.Notices)
	}
}

func TestDocxPlainHeadingIsNotSplit(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter Oneness"))+wordParagraph("", wordRun("Body.")))
	if draft.Paragraphs[0].Chapter != "Chapter Oneness" || subtitleOf(draft.Paragraphs[0]) != "" {
		t.Fatalf("unexpected split: %#v", draft.Paragraphs[0])
	}
	if len(draft.Notices) != 0 {
		t.Fatalf("unexpected notices: %#v", draft.Notices)
	}
}

func TestDocxBodySoftBreaksBecomeNewlines(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter One"))+
		wordParagraph("", wordRun("Roses are red,"), softBreak, wordRun("  violets are blue."), "<w:r><w:cr/></w:r>", wordRun("Sugar is sweet.")))
	if got, want := draft.Paragraphs[0].Text, "Roses are red,\nviolets are blue.\nSugar is sweet."; got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDocxBodyTabsBecomeSingleSpaces(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter One"))+
		wordParagraph("", wordRun("One"), "<w:r><w:tab/></w:r>", wordRun("  two")))
	if got, want := draft.Paragraphs[0].Text, "One two"; got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDocxInlineFormattingBecomesUTF16Spans(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter One"))+
		wordParagraph("", wordRun("She said "), wordRun("never", "<w:i/>"), wordRun(" 🙂 and "), wordRun("meant it", "<w:b/>", "<w:u w:val=\"single\"/>"), wordRun(".")))
	paragraph := draft.Paragraphs[0]
	if paragraph.Text != "She said never 🙂 and meant it." {
		t.Fatalf("text = %q", paragraph.Text)
	}
	want := []Span{{Start: 9, End: 14, Style: "italic"}, {Start: 22, End: 30, Style: "bold"}, {Start: 22, End: 30, Style: "underline"}}
	if len(paragraph.Spans) != len(want) {
		t.Fatalf("spans = %#v want %#v", paragraph.Spans, want)
	}
	for index := range want {
		if paragraph.Spans[index] != want[index] {
			t.Fatalf("span %d = %#v want %#v", index, paragraph.Spans[index], want[index])
		}
	}
}

func TestDocxExplicitlyDisabledFormattingProducesNoSpans(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter One"))+
		wordParagraph("", wordRun("Plain", `<w:b w:val="0"/>`, `<w:i w:val="false"/>`, `<w:u w:val="none"/>`)))
	if len(draft.Paragraphs[0].Spans) != 0 {
		t.Fatalf("unexpected spans: %#v", draft.Paragraphs[0].Spans)
	}
}

func TestSplitGluedHeading(t *testing.T) {
	cases := []struct {
		input, title, subtitle string
		glued                  bool
	}{
		{"CHAPTER ONEBad Ideas Look Great in Neon", "CHAPTER ONE", "Bad Ideas Look Great in Neon", true},
		{"Chapter 12The Long Night", "Chapter 12", "The Long Night", true},
		{"Chapter IIThe Pool of Tears", "Chapter II", "The Pool of Tears", true},
		{"Part Twenty-OneAfter", "Part Twenty-One", "After", true},
		{"CHAPTER ONE", "CHAPTER ONE", "", false},
		{"Chapter One", "Chapter One", "", false},
		{"Chapter Oneness", "Chapter Oneness", "", false},
		{"Chapter 1: The Start", "Chapter 1: The Start", "", false},
		{"Prologue", "Prologue", "", false},
		{"Chapter Tension", "Chapter Tension", "", false},
	}
	for _, tc := range cases {
		title, subtitle, glued := splitGluedHeading(tc.input)
		if title != tc.title || subtitle != tc.subtitle || glued != tc.glued {
			t.Errorf("splitGluedHeading(%q) = %q, %q, %v; want %q, %q, %v", tc.input, title, subtitle, glued, tc.title, tc.subtitle, tc.glued)
		}
	}
}

func TestDocxCharacterStylesMapToFormatting(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter One"))+
		wordParagraph("", wordRun("Very", `<w:rStyle w:val="Emphasis"/>`), wordRun(" loud", `<w:rStyle w:val="Strong"/>`)))
	spans := draft.Paragraphs[0].Spans
	if len(spans) != 2 || spans[0].Style != "italic" || spans[1].Style != "bold" {
		t.Fatalf("spans = %#v", spans)
	}
}
