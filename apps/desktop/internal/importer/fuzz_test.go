package importer

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
)

// The fuzz targets in this file (ADR 0014, ADR 0013) check what must hold for any input:
// the parsers never panic on a file a person chose, and the text and formatting spans they
// produce are well formed. `go test` runs the seed corpus below plus any checked-in
// testdata/fuzz entries, so the gate is deterministic; fuzzing itself is manual:
//
//	go -C apps/desktop test ./internal/importer -run='^$' -fuzz=FuzzAppendInline -fuzztime=60s
//
// A crash is written to testdata/fuzz/<Target>/ and stays there as a regression test.

// checkRichText fails the test when text or spans break the rules the reader relies on.
func checkRichText(t *testing.T, text string, spans []Span) {
	t.Helper()
	if !utf8.ValidString(text) {
		t.Fatalf("text is not valid UTF-8: %q", text)
	}
	if strings.TrimFunc(text, unicode.IsSpace) != text {
		t.Errorf("text has leading or trailing whitespace: %q", text)
	}
	for _, bad := range []string{"  ", " \n", "\n ", "\n\n", "\t", "\r"} {
		if strings.Contains(text, bad) {
			t.Errorf("text contains %q: %q", bad, text)
		}
	}
	// Offsets are UTF-16 code units and must fall on a character boundary, never inside a surrogate pair.
	boundary := map[int]bool{0: true}
	length := 0
	for _, r := range text {
		length += len(utf16.Encode([]rune{r}))
		boundary[length] = true
	}
	lastEnd := map[string]int{}
	for _, span := range spans {
		if span.Start < 0 || span.Start >= span.End || span.End > length {
			t.Errorf("span %+v is outside the text (%d UTF-16 units): %q", span, length, text)
			continue
		}
		if !boundary[span.Start] || !boundary[span.End] {
			t.Errorf("span %+v splits a surrogate pair in %q", span, text)
		}
		if span.Start < lastEnd[span.Style] {
			t.Errorf("span %+v overlaps or precedes the previous %s span in %q", span, span.Style, text)
		}
		lastEnd[span.Style] = span.End
		if span.Style != "bold" && span.Style != "italic" && span.Style != "underline" {
			t.Errorf("unknown span style %q", span.Style)
		}
	}
}

func checkDraft(t *testing.T, draft Draft) {
	t.Helper()
	for _, paragraph := range draft.Paragraphs {
		checkRichText(t, paragraph.Text, paragraph.Spans)
	}
}

// oracleStyles is written out here rather than read from styleOrder, so a wrong label in the code under test
// cannot make the oracle agree with it.
var oracleStyles = []struct {
	flag Style
	name string
}{{styleBold, "bold"}, {styleItalic, "italic"}, {styleUnderline, "underline"}}

// checkRichTextKeepsInput is the oracle for the builder: the visible characters come out in the order they went in,
// each is inside a span of a style exactly when it went in with that style, and a span starts and ends on a visible one.
func checkRichTextKeepsInput(t *testing.T, built string, spans []Span, want []cell) {
	t.Helper()
	runeAtUnit := map[int]rune{}
	var got []rune
	var startUnit []int // UTF-16 offset of each visible character
	unit := 0
	for _, r := range built {
		for width := 0; width < utf16Len(r); width++ {
			runeAtUnit[unit+width] = r
		}
		if !unicode.IsSpace(r) {
			got = append(got, r)
			startUnit = append(startUnit, unit)
		}
		unit += utf16Len(r)
	}
	if len(got) != len(want) {
		t.Fatalf("%d visible characters came out of %d that went in: %q", len(got), len(want), built)
	}
	inSpan := func(style string, at int) bool {
		for _, span := range spans {
			if span.Style == style && span.Start <= at && at < span.End {
				return true
			}
		}
		return false
	}
	for visible, r := range got {
		if r != want[visible].r {
			t.Fatalf("visible character %d is %q, want %q, in %q", visible, r, want[visible].r, built)
		}
		for _, entry := range oracleStyles {
			if has := inSpan(entry.name, startUnit[visible]); has != (want[visible].style&entry.flag != 0) {
				t.Fatalf("character %q at %d: in a %s span = %v, but it went in with style %d; spans %+v in %q", r, startUnit[visible], entry.name, has, want[visible].style, spans, built)
			}
		}
	}
	for _, span := range spans {
		if unicode.IsSpace(runeAtUnit[span.Start]) || unicode.IsSpace(runeAtUnit[span.End-1]) {
			t.Errorf("span %+v starts or ends on whitespace in %q", span, built)
		}
	}
}

// checkNoInventedReplacement fails when well-formed input came out with a U+FFFD replacement character
// it did not contain: a sign that a parser cut a multi-byte character in half.
func checkNoInventedReplacement(t *testing.T, input, output string) {
	t.Helper()
	if utf8.ValidString(input) && !strings.ContainsRune(input, utf8.RuneError) && strings.ContainsRune(output, utf8.RuneError) {
		t.Errorf("input %q produced a replacement character: %q", input, output)
	}
}

func FuzzRichBuilder(f *testing.F) {
	f.Add("Hello  world", []byte{0, 1}, false)
	f.Add("a\tb\nc", []byte{7}, true)
	f.Add("emoji \U0001F600 and \U0001F468\u200d\U0001F469 done", []byte{1, 0, 2}, false)
	f.Add("  \n\t  ", []byte{}, true)
	f.Add("\xff\xfe broken \xc3", []byte{4}, false)
	f.Fuzz(func(t *testing.T, text string, styles []byte, tabIsBreak bool) {
		builder := &richBuilder{}
		var want []cell // the visible characters that went in, with their styles
		index := 0
		for _, r := range text {
			style := Style(0)
			if len(styles) > 0 {
				style = Style(styles[index%len(styles)]) & (styleBold | styleItalic | styleUnderline)
			}
			switch r {
			case '\n':
				builder.lineBreak()
			case '\t':
				builder.tab()
			default:
				builder.text(string(r), style)
				if !unicode.IsSpace(r) {
					want = append(want, cell{r: r, style: style})
				}
			}
			index++
		}
		built, spans := builder.build(tabIsBreak)
		checkRichText(t, built, spans)
		checkRichTextKeepsInput(t, built, spans, want)
	})
}

func FuzzAppendInline(f *testing.F) {
	for _, seed := range []string{
		"plain text",
		"*italic* and **bold** and ***both***",
		"<u>underlined</u> and <br> a break",
		`escaped \* star and \_ underscore`,
		"unmatched *marker and <u>tag",
		// The lower-case form of these has a different byte length (U+0130 gets shorter, U+023A longer): a search
		// in a lower-cased copy returns offsets that are wrong for the original, which cut the text and panicked.
		"<u>İ</u>",
		"<u>Ⱥ</u>",
		"**\U0001F600 bold emoji** _and \U0001F468\u200d\U0001F469 italic_",
		"snake_case_word and 2*3*4",
	} {
		f.Add(seed, uint8(0))
	}
	f.Add("*a*", uint8(styleBold))
	f.Fuzz(func(t *testing.T, line string, style uint8) {
		builder := &richBuilder{}
		appendInline(builder, line, Style(style)&(styleBold|styleItalic|styleUnderline))
		built, spans := builder.build(false)
		checkRichText(t, built, spans)
		checkNoInventedReplacement(t, line, built)
	})
}

func FuzzHeadings(f *testing.F) {
	for _, seed := range []string{
		"CHAPTER ONEBad Ideas",
		"Chapter 12The Beginning",
		"PART IIIStorm",
		"chapter",
		"Book twenty-oneThe End",
		"Chapter \n Two",
		"",
		"\U0001F600 Chapter 1 İ",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, value string) {
		isRoman(value)
		isChapterNumber(value)
		head, subtitle, split := splitGluedHeading(value)
		if split && (head == "" || subtitle == "") {
			t.Errorf("splitGluedHeading(%q) reported a split with an empty half: %q, %q", value, head, subtitle)
		}
		if !split && (head != value || subtitle != "") {
			t.Errorf("splitGluedHeading(%q) changed a heading it did not split: %q, %q", value, head, subtitle)
		}
		headingParts(value)
	})
}

// docxBytes builds a minimal .docx in memory, so seeds do not depend on a binary fixture.
func docxBytes(body string) []byte {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	// A slice, not a map: the seed bytes must be the same on every run.
	for _, entry := range []struct{ name, content string }{
		{"word/styles.xml", `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`},
		{"word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body + `</w:body></w:document>`},
	} {
		writer, _ := archive.Create(entry.name)
		_, _ = writer.Write([]byte(entry.content))
	}
	_ = archive.Close()
	return buffer.Bytes()
}

func FuzzDocx(f *testing.F) {
	valid := docxBytes(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>` +
		`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>` + "\U0001F600" + `</w:t></w:r></w:p>`)
	f.Add(valid)
	f.Add(valid[:len(valid)/2])
	f.Add(valid[:30])
	f.Add([]byte("PK\x03\x04 not really a zip"))
	f.Add([]byte{})
	f.Add(docxBytes(`<w:p><w:r><w:t>unterminated`))
	f.Fuzz(func(t *testing.T, data []byte) {
		path := filepath.Join(t.TempDir(), "fuzz.docx")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		draft, err := docxWithProgress(path, nil)
		if err == nil {
			checkDraft(t, draft)
		}
	})
}

func FuzzMarkdownFile(f *testing.F) {
	for _, seed := range []string{
		"# Chapter One\n\nHello *world*.\n",
		"# Chapter One  \nA hard break  \nnext\\\nline\n\n## Two\n<u>text</u>",
		"Title\n=====\n\nbody",
		"\xef\xbb\xbf# BOM heading\r\n\r\ntext\r\n",
		"# \U0001F600\n\n**İ** <u>İ</u>",
		"",
	} {
		f.Add(seed, uint8(0)) // 0 is the H1 heading level; the level is (input % 6) + 1
	}
	f.Add("# Book\n\n## Chapter One\n\nSome text  \nwith a hard break.\n\n## Chapter Two\n\n<u>Ⱥ</u> more.", uint8(1))
	f.Fuzz(func(t *testing.T, content string, level uint8) {
		path := filepath.Join(t.TempDir(), "fuzz.md")
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		draft, err := markdownWithProgress(path, int(level%6)+1, nil)
		if err == nil {
			checkDraft(t, draft)
			for _, paragraph := range draft.Paragraphs {
				checkNoInventedReplacement(t, content, paragraph.Text)
			}
		}
	})
}

func FuzzTxtFile(f *testing.F) {
	for _, seed := range []string{
		"Chapter One\n\nHello world.\n",
		"\xef\xbb\xbfChapter One\r\n\r\nBOM and CRLF.\r\n",
		"*** START OF THE PROJECT GUTENBERG EBOOK 1 ***\n\nI\n\n_Hello_ world.\n\n*** END OF THE PROJECT GUTENBERG EBOOK 1 ***",
		"just one paragraph, no chapter markup at all",
		"",
		"\xff\xfe\x00\x00broken utf-16",
		"Contents\n\nOne\nTwo\nThree\n\nI\n\nBody text.\n",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, content string) {
		path := filepath.Join(t.TempDir(), "fuzz.txt")
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		draft, err := txtWithProgress(path, nil)
		if err == nil {
			checkDraft(t, draft)
		}
	})
}

// epubBytes builds a minimal, well-formed EPUB (a mimetype, container.xml, an
// OPF with one spine document) in memory, so seeds do not depend on a binary
// fixture; a slice, not a map, keeps entry order (and so the seed bytes)
// stable across runs.
func epubBytes(bodyHTML string) []byte {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for _, entry := range []struct{ name, content string }{
		{"mimetype", "application/epub+zip"},
		{"META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>` +
			`<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
			`<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`},
		{"OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>` +
			`<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
			`<dc:title>Book</dc:title></metadata><manifest>` +
			`<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>` +
			`</manifest><spine><itemref idref="c1"/></spine></package>`},
		{"OEBPS/chapter1.xhtml", `<?xml version="1.0" encoding="UTF-8"?>` +
			`<html xmlns="http://www.w3.org/1999/xhtml"><body>` + bodyHTML + `</body></html>`},
	} {
		writer, _ := archive.Create(entry.name)
		_, _ = writer.Write([]byte(entry.content))
	}
	_ = archive.Close()
	return buffer.Bytes()
}

func FuzzEpubFile(f *testing.F) {
	valid := epubBytes(`<h1>Chapter One</h1><p>Hello <i>world</i>.</p>`)
	f.Add(valid)
	f.Add(valid[:len(valid)/2])
	f.Add(valid[:20])
	f.Add([]byte("PK\x03\x04 not really a zip"))
	f.Add([]byte{})
	f.Add(epubBytes(`<p>unterminated`))
	f.Fuzz(func(t *testing.T, data []byte) {
		path := filepath.Join(t.TempDir(), "fuzz.epub")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		draft, err := epubWithProgress(path, nil)
		if err == nil {
			checkDraft(t, draft)
		}
	})
}

// TestUnderlineTagKeepsCharactersWhoseLowerCaseHasAnotherByteLength pins the bug the fuzz seeds found: the
// closing tag was searched in a lower-cased copy, so its offset was wrong for the original text. U+0130 gets
// shorter (the underlined text was cut mid-character and a stray ">" was left behind) and U+023A gets longer
// (the slice ran past the end of the string and panicked).
func TestUnderlineTagKeepsCharactersWhoseLowerCaseHasAnotherByteLength(t *testing.T) {
	for _, name := range []string{"İ", "Ⱥ"} {
		builder := &richBuilder{}
		appendInline(builder, "<u>"+name+"stan</u> <U>"+name+"</U> end", 0)
		text, spans := builder.build(false)
		if want := name + "stan " + name + " end"; text != want {
			t.Fatalf("text = %q, want %q", text, want)
		}
		// The space between two underlined words is underlined too (a collapsed space keeps the style both sides share).
		if want := (Span{Start: 0, End: 7, Style: "underline"}); len(spans) != 1 || spans[0] != want {
			t.Fatalf("spans = %+v, want [%+v]", spans, want)
		}
	}
}
