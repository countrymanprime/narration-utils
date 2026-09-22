package importer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/text/encoding/charmap"
	xunicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

func importTxt(t *testing.T, name, content string) Draft {
	t.Helper()
	if name == "" {
		name = "book.txt"
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	draft, err := txtWithProgress(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func importTxtBytes(t *testing.T, raw []byte) Draft {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.txt")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	draft, err := txtWithProgress(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func TestTxtUTF8BOMIsStripped(t *testing.T) {
	draft := importTxt(t, "", "\xef\xbb\xbfCHAPTER ONE\n\nBody text.\n")
	if draft.Paragraphs[0].Chapter != "CHAPTER ONE" {
		t.Fatalf("chapter = %q", draft.Paragraphs[0].Chapter)
	}
}

func TestTxtUTF16LEAndBEDecode(t *testing.T) {
	source := "CHAPTER ONE\n\nBody text.\n"
	le, _, err := transform.Bytes(xunicode.UTF16(xunicode.LittleEndian, xunicode.UseBOM).NewEncoder(), []byte(source))
	if err != nil {
		t.Fatal(err)
	}
	be, _, err := transform.Bytes(xunicode.UTF16(xunicode.BigEndian, xunicode.UseBOM).NewEncoder(), []byte(source))
	if err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string][]byte{"LE": le, "BE": be} {
		draft := importTxtBytes(t, raw)
		if draft.Paragraphs[0].Chapter != "CHAPTER ONE" {
			t.Fatalf("%s: chapter = %q", name, draft.Paragraphs[0].Chapter)
		}
	}
}

func TestTxtWindows1252FallbackIsReportedAsANotice(t *testing.T) {
	// "café" with the Latin-1/Windows-1252 byte for é (0xE9), which is not valid UTF-8 on its own.
	raw, _, err := transform.Bytes(charmap.Windows1252.NewEncoder(), []byte("CHAPTER ONE\n\nA café scene.\n"))
	if err != nil {
		t.Fatal(err)
	}
	draft := importTxtBytes(t, raw)
	if got := draft.Paragraphs[0].Text; got != "A café scene." {
		t.Fatalf("text = %q", got)
	}
	if len(draft.Notices) != 1 || !strings.Contains(draft.Notices[0], "Windows-1252") {
		t.Fatalf("expected a Windows-1252 notice, got %#v", draft.Notices)
	}
}

func TestTxtValidUTF8NeedsNoNotice(t *testing.T) {
	draft := importTxt(t, "", "CHAPTER ONE\n\nCurly “quotes” and an em dash—here.\n")
	if len(draft.Notices) != 0 {
		t.Fatalf("expected no notices, got %#v", draft.Notices)
	}
}

func TestTxtCRLFAndCRLineEndingsNormalize(t *testing.T) {
	crlf := importTxt(t, "a.txt", "CHAPTER ONE\r\n\r\nBody text.\r\n")
	cr := importTxt(t, "b.txt", "CHAPTER ONE\r\rBody text, CR-only line endings.\r")
	if crlf.Paragraphs[0].Text != "Body text." {
		t.Fatalf("CRLF text = %q", crlf.Paragraphs[0].Text)
	}
	if len(cr.Paragraphs) == 0 || cr.Paragraphs[0].Text != "Body text, CR-only line endings." {
		t.Fatalf("CR-only text = %#v", cr.Paragraphs)
	}
}

func TestTxtBlankLinesSplitBlocks(t *testing.T) {
	draft := importTxt(t, "", "CHAPTER ONE\n\nFirst paragraph.\n\nSecond paragraph.\n")
	if len(draft.Paragraphs) != 2 {
		t.Fatalf("expected 2 paragraphs, got %#v", draft.Paragraphs)
	}
}

func TestTxtTwoLineHeadingHasSubtitle(t *testing.T) {
	draft := importTxt(t, "", "CHAPTER I.\nDown the Rabbit-Hole\n\nBody text.\n")
	if draft.Paragraphs[0].Chapter != "CHAPTER I." || subtitleOf(draft.Paragraphs[0]) != "Down the Rabbit-Hole" {
		t.Fatalf("got chapter %q subtitle %q", draft.Paragraphs[0].Chapter, subtitleOf(draft.Paragraphs[0]))
	}
}

func TestTxtBareRomanNumeralIsAHeading(t *testing.T) {
	draft := importTxt(t, "", "I\n\nBody text.\n")
	if len(draft.ChapterTitles) != 1 || draft.ChapterTitles[0] != "I" {
		t.Fatalf("titles = %#v", draft.ChapterTitles)
	}
}

func TestTxtBareNumberWordIsAHeading(t *testing.T) {
	draft := importTxt(t, "", "One\n\nBody text.\n")
	if len(draft.ChapterTitles) != 1 || draft.ChapterTitles[0] != "One" {
		t.Fatalf("titles = %#v", draft.ChapterTitles)
	}
}

func TestTxtAllCapsAloneIsNotAHeading(t *testing.T) {
	draft := importTxt(t, "", "CHAPTER ONE\n\nSOME LOUD LINE\n\nBody text.\n")
	if len(draft.ChapterTitles) != 1 || draft.ChapterTitles[0] != "CHAPTER ONE" {
		t.Fatalf("an ALL-CAPS line alone must not become its own chapter, got %#v", draft.ChapterTitles)
	}
	found := false
	for _, paragraph := range draft.Paragraphs {
		if paragraph.Text == "SOME LOUD LINE" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected the ALL-CAPS line as an ordinary paragraph, got %#v", draft.Paragraphs)
	}
}

func TestTxtContentsBlockIsReferenceNotChapterList(t *testing.T) {
	content := "Contents\n\n" +
		"CHAPTER I.    Down the Rabbit-Hole\n" +
		"CHAPTER II.   The Pool of Tears\n" +
		"CHAPTER III.  A Caucus-Race and a Long Tale\n\n" +
		"CHAPTER ONE\n\nStory text.\n"
	draft := importTxt(t, "", content)
	if hasCandidate(draft, "CHAPTER I.") {
		t.Fatalf("the contents list must not become a character candidate")
	}
	section := sectionNamed(t, draft, "Contents")
	if section.ContentKind != "reference" {
		t.Fatalf("Contents content kind = %q, want reference", section.ContentKind)
	}
	if got := sectionNamed(t, draft, "CHAPTER ONE").ContentKind; got != "narration" {
		t.Fatalf("CHAPTER ONE content kind = %q, want narration", got)
	}
}

func TestTxtChapterlessImportBecomesOneNarrationChapterWithNotice(t *testing.T) {
	draft := importTxt(t, "short-story.txt", "Once upon a time there was a story with no chapter markings at all.\n\nIt just kept going.\n")
	if len(draft.ChapterTitles) != 1 || draft.ChapterTitles[0] != "short-story" {
		t.Fatalf("titles = %#v", draft.ChapterTitles)
	}
	section := sectionNamed(t, draft, "short-story")
	if section.ContentKind != "narration" {
		t.Fatalf("content kind = %q, want narration (not opening, unlike Word/Markdown - T4)", section.ContentKind)
	}
	if len(draft.Notices) != 1 || !strings.Contains(draft.Notices[0], "No chapter headings") {
		t.Fatalf("expected a chapterless notice, got %#v", draft.Notices)
	}
}

func TestTxtHardWrapDetectionJoinsWrappedLinesWithASpace(t *testing.T) {
	content := "CHAPTER ONE\n\n" +
		"This is a line of roughly seventy characters wrapped by an editor\n" +
		"and continuing here across a second physical line of the file so\n" +
		"that there is more than one line contributing to the wrap decision\n" +
		"and a fourth line here to be safely over the sample-size threshold\n" +
		"and a fifth to make the pattern clear across the whole paragraph.\n"
	draft := importTxt(t, "", content)
	want := "This is a line of roughly seventy characters wrapped by an editor and continuing here across a second physical line of the file so that there is more than one line contributing to the wrap decision and a fourth line here to be safely over the sample-size threshold and a fifth to make the pattern clear across the whole paragraph."
	if draft.Paragraphs[0].Text != want {
		t.Fatalf("got %q", draft.Paragraphs[0].Text)
	}
	found := false
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "hard-wrapped") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a hard-wrap notice, got %#v", draft.Notices)
	}
}

func TestTxtShortLinesStayAsLineBreaksVerse(t *testing.T) {
	content := "CHAPTER ONE\n\n" +
		"Roses are red\n" +
		"Violets are blue\n" +
		"Sugar is sweet\n" +
		"And so are you\n"
	draft := importTxt(t, "", content)
	want := "Roses are red\nViolets are blue\nSugar is sweet\nAnd so are you"
	if draft.Paragraphs[0].Text != want {
		t.Fatalf("got %q", draft.Paragraphs[0].Text)
	}
}

func TestTxtNoBlankLinesAndLongLinesBecomeOneParagraphPerLine(t *testing.T) {
	content := "This is the first long line of the file with no blank lines anywhere in it at all.\n" +
		"This is the second long line of the file, just as long as the first one was.\n" +
		"This is the third long line of the file, again just as long as the others were.\n"
	draft := importTxt(t, "", content)
	if len(draft.Paragraphs) != 3 {
		t.Fatalf("expected 3 separate paragraphs, got %#v", draft.Paragraphs)
	}
}

func TestTxtGutenbergBoilerplateIsStrippedAndReported(t *testing.T) {
	content := "Some legalese before the start marker.\n\n" +
		"*** START OF THE PROJECT GUTENBERG EBOOK 11 ***\n\n" +
		"CHAPTER ONE\n\n" +
		"Real story text.\n\n" +
		"*** END OF THE PROJECT GUTENBERG EBOOK 11 ***\n\n" +
		"More legalese after the end marker.\n"
	draft := importTxt(t, "", content)
	for _, paragraph := range draft.Paragraphs {
		if strings.Contains(paragraph.Text, "legalese") {
			t.Fatalf("Gutenberg boilerplate leaked into the manuscript: %q", paragraph.Text)
		}
	}
	found := false
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "Gutenberg") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a Gutenberg-boilerplate notice, got %#v", draft.Notices)
	}
}

func TestTxtUnderscoreItalicsBecomeSpans(t *testing.T) {
	draft := importTxt(t, "", "CHAPTER ONE\n\nThere was nothing so _very_ remarkable in that.\n")
	paragraph := draft.Paragraphs[0]
	if want := "There was nothing so very remarkable in that."; paragraph.Text != want {
		t.Fatalf("text = %q", paragraph.Text)
	}
	if len(paragraph.Spans) != 1 || paragraph.Spans[0].Style != "italic" {
		t.Fatalf("spans = %#v", paragraph.Spans)
	}
}

func TestTxtSnakeCaseAndLoneUnderscoresStayLiteral(t *testing.T) {
	draft := importTxt(t, "", "CHAPTER ONE\n\nA snake_case_name and a lone _ underscore stay literal.\n")
	paragraph := draft.Paragraphs[0]
	if want := "A snake_case_name and a lone _ underscore stay literal."; paragraph.Text != want {
		t.Fatalf("text = %q", paragraph.Text)
	}
	if len(paragraph.Spans) != 0 {
		t.Fatalf("spans = %#v", paragraph.Spans)
	}
}

func TestTxtGluedHeadingIsSplitAndReported(t *testing.T) {
	draft := importTxt(t, "", "CHAPTER ONEBad Ideas Look Great in Neon\n\nBody.\n")
	if draft.Paragraphs[0].Chapter != "CHAPTER ONE" || subtitleOf(draft.Paragraphs[0]) != "Bad Ideas Look Great in Neon" {
		t.Fatalf("got chapter %q subtitle %q", draft.Paragraphs[0].Chapter, subtitleOf(draft.Paragraphs[0]))
	}
	if len(draft.Notices) != 1 || !strings.Contains(draft.Notices[0], "CHAPTER ONE") {
		t.Fatalf("expected one notice describing the split, got %#v", draft.Notices)
	}
}

func TestTxtEmptyFileIsRejected(t *testing.T) {
	_, err := txtWithProgress(fixture("does-not-need-to-exist.txt"), nil)
	if err == nil {
		t.Fatal("expected an error reading a missing file")
	}
	path := filepath.Join(t.TempDir(), "empty.txt")
	if err := os.WriteFile(path, []byte("   \n\n   \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := txtWithProgress(path, nil); err == nil {
		t.Fatal("expected an error for a manuscript with no readable text")
	}
}
