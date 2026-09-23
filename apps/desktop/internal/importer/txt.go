package importer

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
	xunicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// txtWithProgress builds a Draft from a plain-text manuscript. It shares
// richBuilder (whitespace and spans), isNarrativeMarker, isChapterNumber,
// headingParts/splitGluedHeading, classifyPreHeading and isNonChapterHeading
// with the DOCX and Markdown importers (txt-and-epub-import PRD, Phase 1).
func txtWithProgress(path string, progress Progress) (Draft, error) {
	progress.report(5, "Reading text file %s", filepath.Base(path))
	raw, err := os.ReadFile(path)
	if err != nil {
		return Draft{}, &Error{"Could not read this text file: " + err.Error()}
	}
	notices := []string{}
	text, decodeNotice := decodeTxt(raw)
	if decodeNotice != "" {
		notices = append(notices, decodeNotice)
	}
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")

	if stripped, strippedNotice := stripGutenbergBoilerplate(text); strippedNotice != "" {
		text = stripped
		notices = append(notices, strippedNotice)
	}

	progress.report(25, "Parsing %d KB", len(raw)/1024)

	blocks, wrapped, wrapNotices := prepareTxtBlocks(text)
	notices = append(notices, wrapNotices...)

	chapter, subtitle, section := "Front Matter", "", ""
	paragraphs := []Paragraph{}
	titles := []string{}
	headingLevels := map[string]int{}
	preIndexes := []int{}

	appendParagraph := func(block string) {
		// A word-bounded _italic_ span routinely crosses a hard-wrapped line
		// boundary in real Gutenberg-shaped text (T5), so the lines are
		// joined into one logical string - with the wrap decision's own
		// separator - before appendTxtItalics ever runs, rather than
		// per physical line, which would never see a span's closing
		// underscore on a later line.
		lines := strings.Split(block, "\n")
		trimmed := make([]string, len(lines))
		for index, line := range lines {
			trimmed[index] = strings.TrimSpace(line)
		}
		separator := "\n"
		if wrapped {
			separator = " "
		}
		var builder richBuilder
		appendTxtItalics(&builder, strings.Join(trimmed, separator))
		body, spans := builder.build(false)
		if body == "" {
			return
		}
		var sectionValue, subtitleValue *string
		if section != "" {
			copySection := section
			sectionValue = &copySection
		}
		if subtitle != "" {
			copySubtitle := subtitle
			subtitleValue = &copySubtitle
		}
		paragraphs = append(paragraphs, Paragraph{Chapter: chapter, ChapterSubtitle: subtitleValue, Section: sectionValue, Text: body, Spans: spans, SourceIndex: len(paragraphs)})
		if chapter == "Front Matter" {
			preIndexes = append(preIndexes, len(paragraphs)-1)
		}
	}

	for _, block := range blocks {
		lines := strings.Split(block, "\n")
		kind, headingTitle, headingSubtitle, glued := classifyTxtHeading(lines)
		switch kind {
		case txtNonChapterHeading:
			chapter, subtitle, section = headingTitle, "", ""
			if _, seen := headingLevels[chapter]; !seen {
				headingLevels[chapter] = 1
			}
			continue
		case txtChapterHeading:
			chapter, subtitle = headingTitle, headingSubtitle
			if glued {
				notices = append(notices, fmt.Sprintf("Heading %q had no gap between its number and title; split into %q and %q.", collapse(lines[0]), chapter, subtitle))
			}
			section = ""
			titles = append(titles, chapter)
			if _, seen := headingLevels[chapter]; !seen {
				headingLevels[chapter] = 1
			}
			continue
		}
		appendParagraph(block)
	}

	pre := make([]string, len(preIndexes))
	for index, paragraphIndex := range preIndexes {
		pre[index] = paragraphs[paragraphIndex].Text
	}
	for index, kind := range classifyPreHeading(pre) {
		paragraphs[preIndexes[index]].Chapter = kind
	}

	// T4: a plain-text file with no chapter headings at all is the common
	// case (TXT has no heading markup), not an edge case, and Word/Markdown's
	// "opening" fallback would make it silently un-narratable (zero words,
	// no error) - so it diverges: one "narration" chapter titled from the
	// file name, reported.
	if len(titles) == 0 && len(paragraphs) > 0 {
		name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		for index := range paragraphs {
			paragraphs[index].Chapter = name
		}
		titles = []string{name}
		notices = append(notices, fmt.Sprintf("No chapter headings were found; the whole file was imported as one chapter, %q.", name))
	}

	progress.report(80, "Classifying front matter, chapters and reference sections")
	draft, err := newDraft("txt", filepath.Base(path), paragraphs, titles, headingLevels, nil)
	draft.Notices = notices
	if err == nil {
		progress.report(95, "Found %d chapters in %d sections", len(titles), len(draft.Sections))
	}
	return draft, err
}

// decodeTxt implements T1's order: a BOM (UTF-8, UTF-16 LE/BE) decides the
// encoding outright; otherwise valid UTF-8 is trusted as is; otherwise the
// bytes are decoded as Windows-1252 and the guess is reported, never
// silently.
func decodeTxt(raw []byte) (string, string) {
	switch {
	case bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF}):
		return string(raw[3:]), ""
	case bytes.HasPrefix(raw, []byte{0xFF, 0xFE}):
		return decodeUTF16(raw[2:], xunicode.LittleEndian), ""
	case bytes.HasPrefix(raw, []byte{0xFE, 0xFF}):
		return decodeUTF16(raw[2:], xunicode.BigEndian), ""
	case utf8.Valid(raw):
		return string(raw), ""
	default:
		decoded, _, err := transform.Bytes(charmap.Windows1252.NewDecoder(), raw)
		if err != nil {
			return string(raw), "This file could not be read as UTF-8 or Windows-1252; some characters may be wrong."
		}
		return string(decoded), "This file was not valid UTF-8; it was decoded as Windows-1252."
	}
}

func decodeUTF16(raw []byte, endian xunicode.Endianness) string {
	decoder := xunicode.UTF16(endian, xunicode.IgnoreBOM).NewDecoder()
	out, _, err := transform.Bytes(decoder, raw)
	if err != nil {
		return string(raw)
	}
	return string(out)
}

var (
	gutenbergStart = regexp.MustCompile(`(?i)\*\*\*\s*START OF[^\n*]*\*\*\*[ \t]*\n?`)
	gutenbergEnd   = regexp.MustCompile(`(?i)\*\*\*\s*END OF[^\n*]*\*\*\*`)
)

// stripGutenbergBoilerplate implements T5's Gutenberg half: text outside
// "*** START OF ... ***" and "*** END OF ... ***" (Project Gutenberg's own
// markers) is legal boilerplate, not manuscript, and is dropped when both
// markers are present and in order.
func stripGutenbergBoilerplate(text string) (string, string) {
	startLoc := gutenbergStart.FindStringIndex(text)
	endLoc := gutenbergEnd.FindStringIndex(text)
	if startLoc == nil || endLoc == nil || endLoc[0] < startLoc[1] {
		return text, ""
	}
	return text[startLoc[1]:endLoc[0]], "Removed Project Gutenberg header and footer text outside the START/END markers."
}

// splitBlocks groups lines into blocks separated by one or more blank lines.
func splitBlocks(text string) []string {
	var blocks []string
	var current []string
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			if len(current) > 0 {
				blocks = append(blocks, strings.Join(current, "\n"))
				current = nil
			}
			continue
		}
		current = append(current, line)
	}
	if len(current) > 0 {
		blocks = append(blocks, strings.Join(current, "\n"))
	}
	return blocks
}

// wrapLineFloor and wrapLineCeiling bound a "short, wrapped" candidate line
// (T2b): a real hard wrap at 60-80 columns leaves most non-final lines in
// this band; a much shorter or much longer line is more likely verse, an
// address or an already-unwrapped paragraph. Documented as an implementation
// judgement call in the accompanying ADR, the same way ADR-0089 documents its
// own threshold.
const (
	wrapLineFloor        = 45
	wrapLineCeiling      = 100
	wrapMajorityFraction = 0.7
	noBlankLineAverage   = 55.0
)

// prepareTxtBlocks implements T2's hard-wrap detection: most files split
// cleanly into blocks on blank lines, and the file-wide shape of those blocks
// (T2b) decides whether a block's internal line breaks are wrapping (joined
// with a space) or structural (kept, as in verse or an address). A file with
// no blank lines at all and long lines is not one giant paragraph: T2's own
// final clause turns each line into its own paragraph instead.
func prepareTxtBlocks(text string) (blocks []string, wrapped bool, notices []string) {
	blocks = splitBlocks(text)
	if len(blocks) <= 1 {
		if len(blocks) == 1 {
			lines := strings.Split(blocks[0], "\n")
			if len(lines) > 1 && averageLineLength(lines) > noBlankLineAverage {
				return lines, false, []string{"This file had no blank lines separating paragraphs; each line was imported as its own paragraph."}
			}
		}
		return blocks, false, nil
	}
	var lengths []int
	for _, block := range blocks {
		lines := strings.Split(block, "\n")
		for index := 0; index < len(lines)-1; index++ {
			lengths = append(lengths, len([]rune(strings.TrimRight(lines[index], " \t"))))
		}
	}
	if len(lengths) < 4 {
		return blocks, false, nil
	}
	short := 0
	for _, length := range lengths {
		if length >= wrapLineFloor && length <= wrapLineCeiling {
			short++
		}
	}
	wrapped = float64(short)/float64(len(lengths)) >= wrapMajorityFraction
	if wrapped {
		notices = []string{"This file looks hard-wrapped; lines within a paragraph were joined with a space."}
	}
	return blocks, wrapped, notices
}

func averageLineLength(lines []string) float64 {
	total, count := 0, 0
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		total += len([]rune(trimmed))
		count++
	}
	if count == 0 {
		return 0
	}
	return float64(total) / float64(count)
}

type txtHeadingKind int

const (
	txtNotHeading txtHeadingKind = iota
	txtChapterHeading
	txtNonChapterHeading
)

// classifyTxtHeading implements T3's conservative rule: a block of one line,
// or two lines where the second is a subtitle, matching isNarrativeMarker or
// a bare numeral/roman numeral/number word. A multi-line block (a "Contents"
// list, an ordinary paragraph) is never read as a heading, and an ALL-CAPS
// line alone is not a heading unless it also matches one of those rules.
func classifyTxtHeading(lines []string) (kind txtHeadingKind, title, subtitle string, glued bool) {
	if len(lines) == 0 || len(lines) > 2 {
		return txtNotHeading, "", "", false
	}
	first := collapse(lines[0])
	if first == "" {
		return txtNotHeading, "", "", false
	}
	if isNonChapterHeading(first) && len(lines) == 1 {
		return txtNonChapterHeading, first, "", false
	}
	if len(lines) == 2 {
		second := collapse(lines[1])
		if second == "" || !isTxtChapterMarker(first) {
			return txtNotHeading, "", "", false
		}
		return txtChapterHeading, first, second, false
	}
	// A glued heading ("CHAPTER ONEBad Ideas") starts with "chapter "/"part "/"book " too, so the split is tried first: an
	// isNarrativeMarker check on the raw line would always match the glued number-plus-keyword prefix and never reach
	// splitGluedHeading.
	if splitTitle, splitSubtitle, isGlued := splitGluedHeading(first); isGlued && isTxtChapterMarker(splitTitle) {
		return txtChapterHeading, splitTitle, splitSubtitle, true
	}
	if isTxtChapterMarker(first) {
		return txtChapterHeading, first, "", false
	}
	return txtNotHeading, "", "", false
}

// isTxtChapterMarker reports whether a bare line (no "Chapter"/"Part"/"Book"
// keyword required) is itself a chapter marker: a narrative-marker phrase, or
// a standalone numeral, roman numeral or number word (T3), trailing "." or
// ":" ignored ("CHAPTER I." in a Gutenberg-shaped file).
func isTxtChapterMarker(line string) bool {
	if isNarrativeMarker(line) {
		return true
	}
	token := strings.TrimRight(strings.TrimSpace(line), ".:")
	if token == "" {
		return false
	}
	if isChapterNumber(token) {
		return true
	}
	_, err := strconv.Atoi(token)
	return err == nil
}

// appendTxtItalics implements T5's underscore half: a word-bounded _italic_
// run becomes an italic span; an intraword underscore (snake_case_name) or a
// lone one stays literal, mirroring the Markdown importer's own
// underscore-emphasis rule (markdown_inline.go) without the rest of
// CommonMark that plain text does not use (*, **, <br>, backslash escapes).
func appendTxtItalics(b *richBuilder, line string) {
	runes := []rune(line)
	for index := 0; index < len(runes); {
		if runes[index] == '_' {
			opens := index+1 < len(runes) && !isTxtSpace(runes[index+1]) && (index == 0 || !isWordRune(runes[index-1]))
			if opens {
				if end := findTxtItalicCloser(runes, index+1); end >= 0 {
					b.text(string(runes[index+1:end]), styleItalic)
					index = end + 1
					continue
				}
			}
		}
		b.text(string(runes[index]), 0)
		index++
	}
}

func findTxtItalicCloser(runes []rune, from int) int {
	for j := from; j < len(runes); j++ {
		if runes[j] == '_' && j > from && !isTxtSpace(runes[j-1]) && (j+1 >= len(runes) || !isWordRune(runes[j+1])) {
			return j
		}
	}
	return -1
}

func isTxtSpace(r rune) bool { return r == ' ' || r == '\t' }
