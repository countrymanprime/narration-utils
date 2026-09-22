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
const defaultDocxStyles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
	`<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>` +
	`<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>` +
	`<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/></w:style>` +
	`<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>` +
	`<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>` +
	`<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style></w:styles>`

func docxFixture(t *testing.T, body string) string {
	t.Helper()
	return docxFixtureWithStyles(t, defaultDocxStyles, body)
}

// docxFixtureWithStyles is docxFixture with a caller-chosen word/styles.xml, for tests that need styles the default set does not
// define (a "TOC Heading" style with its real outlineLvl 9, for example).
func docxFixtureWithStyles(t *testing.T, stylesXML, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.docx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	entries := map[string]string{
		"word/styles.xml":   stylesXML,
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

// wordParagraphWithOutline is wordParagraph with an explicit <w:outlineLvl>, the way Word marks "TOC Heading" as outlineLvl 9 (kept
// out of the navigation pane) even though it renders as a section heading.
func wordParagraphWithOutline(style, outline string, runs ...string) string {
	return "<w:p><w:pPr><w:pStyle w:val=\"" + style + "\"/><w:outlineLvl w:val=\"" + outline + "\"/></w:pPr>" + strings.Join(runs, "") + "</w:p>"
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

func TestDocxSoftBreakSubtitleReachesTheSectionForTheReview(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("CHAPTER ONE"), softBreak, wordRun("Bad Ideas Look Great in Neon"))+
		wordParagraph("", wordRun("The first line."))+
		wordParagraph("Heading1", wordRun("CHAPTER TWO"))+
		wordParagraph("", wordRun("Another line.")))
	if got := sectionNamed(t, draft, "CHAPTER ONE").Subtitle; got != "Bad Ideas Look Great in Neon" {
		t.Fatalf("CHAPTER ONE subtitle = %q", got)
	}
	if got := sectionNamed(t, draft, "CHAPTER TWO").Subtitle; got != "" {
		t.Fatalf("CHAPTER TWO has no subtitle, got %q", got)
	}
}

func candidateNames(draft Draft) []string {
	names := make([]string, len(draft.CharacterCandidates))
	for index, candidate := range draft.CharacterCandidates {
		names[index] = candidate.Name
	}
	return names
}

func hasCandidate(draft Draft, name string) bool {
	for _, got := range candidateNames(draft) {
		if got == name {
			return true
		}
	}
	return false
}

// TestDocxTOCHeadingStyleIsRecognizedDespiteItsOutlineLvl9 covers PRD import-structure-toc-and-characters Phase 1 (S1/S6/S8):
// Word's built-in "TOC Heading" style carries outlineLvl 9, which documentRecords otherwise reads as "not an outline heading", so the
// paragraph fell through to plain body text and its entries leaked into whatever chapter preceded it.
func TestDocxTOCHeadingStyleIsRecognizedDespiteItsOutlineLvl9(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Chapter One"))+wordParagraph("", wordRun("Chapter one text."))+
		wordParagraphWithOutline("TOCHeading", "9", wordRun("Contents"))+
		wordParagraph("", wordRun("Chapter One .... 1"))+
		wordParagraph("Heading1", wordRun("Chapter Two"))+wordParagraph("", wordRun("Chapter two text.")))
	contents := sectionNamed(t, draft, "Contents")
	if contents.ContentKind != "reference" {
		t.Fatalf("Contents content kind = %q, want reference", contents.ContentKind)
	}
	if contents.ParagraphCount != 1 {
		t.Fatalf("Contents paragraph count = %d, want 1 (the TOC entry, not absorbed into Chapter One)", contents.ParagraphCount)
	}
	if got := sectionNamed(t, draft, "Chapter One").ParagraphCount; got != 1 {
		t.Fatalf("Chapter One paragraph count = %d, want 1", got)
	}
	if len(draft.ChapterTitles) != 2 {
		t.Fatalf("expected Contents excluded from chapter titles, got %#v", draft.ChapterTitles)
	}
}

// TestDocxTOCBeforeFirstChapterWithNoTitleIsNotSweptIntoFrontMatter covers S1: a TOC before the first chapter heading, with no Title
// paragraph ahead of it, used to have both its own heading and its entries fall into the pre-heading Cover/Front-Matter heuristic.
func TestDocxTOCBeforeFirstChapterWithNoTitleIsNotSweptIntoFrontMatter(t *testing.T) {
	draft := importDocx(t, wordParagraphWithOutline("TOCHeading", "9", wordRun("Contents"))+
		wordParagraph("", wordRun("Chapter One .... 1"))+
		wordParagraph("Heading1", wordRun("Chapter One"))+wordParagraph("", wordRun("Chapter one text.")))
	contents := sectionNamed(t, draft, "Contents")
	if contents.ParagraphCount != 1 {
		t.Fatalf("Contents paragraph count = %d, want 1", contents.ParagraphCount)
	}
	for _, section := range draft.Sections {
		if (section.Title == "Front Matter" || section.Title == "Cover") && section.ParagraphCount != 0 {
			t.Fatalf("expected the TOC entry not to land in %q, got %d paragraphs", section.Title, section.ParagraphCount)
		}
	}
}

// TestDocxTOCAfterTitleIsNotAbsorbedIntoTheTitleChapter covers S1: a TOC heading right after a Title-styled paragraph used to leak
// its entries into the "Title" group as narration, because nothing before it ended that group.
func TestDocxTOCAfterTitleIsNotAbsorbedIntoTheTitleChapter(t *testing.T) {
	draft := importDocx(t, wordParagraph("Title", wordRun("My Book"))+
		wordParagraphWithOutline("TOCHeading", "9", wordRun("Contents"))+
		wordParagraph("", wordRun("Chapter One .... 1"))+
		wordParagraph("Heading1", wordRun("Chapter One"))+wordParagraph("", wordRun("Chapter one text.")))
	contents := sectionNamed(t, draft, "Contents")
	if contents.ParagraphCount != 1 {
		t.Fatalf("Contents paragraph count = %d, want 1", contents.ParagraphCount)
	}
	if got := sectionNamed(t, draft, "My Book").ParagraphCount; got != 0 {
		t.Fatalf("Title section %q absorbed %d paragraphs that belong to Contents", "My Book", got)
	}
}

// TestCharacterListActiveEndsAtAnySiblingHeadingNotOnlyANarrativeMarker covers S3: the old rule kept the Characters section "active"
// until a chapter/part/book/prologue/epilogue/afterword heading, so any other heading that followed (an "Appendix", a mistitled
// Contents) was read as one more character candidate.
func TestCharacterListActiveEndsAtAnySiblingHeadingNotOnlyANarrativeMarker(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Characters"))+
		wordParagraph("", wordRun("Wren — a spy."))+
		wordParagraph("Heading1", wordRun("Appendix"))+
		wordParagraph("", wordRun("Appendix text."))+
		wordParagraphWithOutline("TOCHeading", "9", wordRun("Contents"))+
		wordParagraph("", wordRun("Chapter One .... 1")))
	if !hasCandidate(draft, "Wren") {
		t.Fatalf("expected a Wren candidate, got %#v", candidateNames(draft))
	}
	if hasCandidate(draft, "Appendix") || hasCandidate(draft, "Contents") {
		t.Fatalf("Appendix and Contents must not become candidates, got %#v", candidateNames(draft))
	}
	if got := sectionNamed(t, draft, "Appendix").ContentKind; got != "narration" {
		t.Fatalf("Appendix content kind = %q, want narration", got)
	}
}

// TestCharacterSubheadingStaysInScopeButTheNextChapterEndsIt covers S3's "own subheadings" half: a per-character heading nested
// under Characters must still become a candidate, and the chapter that follows the Characters section must not.
func TestCharacterSubheadingStaysInScopeButTheNextChapterEndsIt(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Characters"))+
		wordParagraph("Heading2", wordRun("Wren"))+
		wordParagraph("", wordRun("A spy for the crown."))+
		wordParagraph("Heading1", wordRun("Chapter One"))+
		wordParagraph("", wordRun("Story text.")))
	if !hasCandidate(draft, "Wren") {
		t.Fatalf("expected a Wren candidate from the subheading, got %#v", candidateNames(draft))
	}
	if hasCandidate(draft, "Chapter One") {
		t.Fatalf("Chapter One must not become a candidate, got %#v", candidateNames(draft))
	}
	if got := sectionNamed(t, draft, "Chapter One").ContentKind; got != "narration" {
		t.Fatalf("Chapter One content kind = %q, want narration", got)
	}
}

// TestNestedCastSubheadingDoesNotRebaselineTheCharactersScopeLevel covers a review finding on S3: a subheading that itself matches
// isCharacterHeading (a "Cast" H2 nested under a "Characters" H1) must not move the level the scope compares later headings
// against. If it did, a later, non-character H2 ("Notes") would wrongly end the scope early (since its level would no longer be
// deeper than the rebaselined one), and an H3 nested under that H2 ("Tom") would never be reached as a candidate.
func TestNestedCastSubheadingDoesNotRebaselineTheCharactersScopeLevel(t *testing.T) {
	draft := importDocx(t, wordParagraph("Heading1", wordRun("Characters"))+
		wordParagraph("Heading2", wordRun("Cast"))+
		wordParagraph("", wordRun("Wren — a spy."))+
		wordParagraph("Heading2", wordRun("Notes"))+
		wordParagraph("", wordRun("Some editorial note."))+
		wordParagraph("Heading3", wordRun("Tom"))+
		wordParagraph("", wordRun("A thief."))+
		wordParagraph("Heading1", wordRun("Chapter One"))+
		wordParagraph("", wordRun("Story text.")))
	if !hasCandidate(draft, "Wren") {
		t.Fatalf("expected a Wren candidate from the Cast block, got %#v", candidateNames(draft))
	}
	if got := sectionNamed(t, draft, "Notes").ContentKind; got != "reference" {
		t.Fatalf("Notes content kind = %q, want reference (Cast must not have rebaselined the scope level)", got)
	}
	if !hasCandidate(draft, "Tom") {
		t.Fatalf("expected a Tom candidate nested under Notes, got %#v", candidateNames(draft))
	}
	if hasCandidate(draft, "Chapter One") {
		t.Fatalf("Chapter One must still end the scope and not become a candidate, got %#v", candidateNames(draft))
	}
	if got := sectionNamed(t, draft, "Chapter One").ContentKind; got != "narration" {
		t.Fatalf("Chapter One content kind = %q, want narration", got)
	}
}
