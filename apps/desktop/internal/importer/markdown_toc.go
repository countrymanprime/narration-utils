package importer

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// A Markdown manuscript's own table of contents (import-structure PRD, Phase 4): a list whose every item is exactly one link
// to a heading of the same file, "- [Chapter One](#chapter-one)". Two or more such items in one list make a table of
// contents; the first such list is the one read. Its entries are matched to the chapter headings as a docx's are (ADR 0089),
// the anchor standing in for Word's bookmark, and the list itself stays in the manuscript as the Contents section's text.

// markdownTOCItem is a list item (a "-", "*" or "+" bullet, or "1." / "1)") that is one link to an in-file anchor.
var markdownTOCItem = regexp.MustCompile(`^(\s*)(?:[-*+]|\d{1,9}[.)])\s+\[([^\]]+)\]\(#([^)\s]+)\)\s*$`)

// markdownTOCMinEntries is the fewest items a list of in-file links needs to be read as a table of contents, so a single
// "see Chapter Two" link is never one.
const markdownTOCMinEntries = 2

// markdownTOCReader collects the first table of contents as the file's lines go by.
type markdownTOCReader struct {
	block   []markdownTOCLine
	entries []tocEntry
	done    bool
}

type markdownTOCLine struct {
	indent int
	entry  tocEntry
}

// line reads one non-heading line: a TOC item extends the open list, a blank line keeps it open (a loose list), and
// anything else closes it.
func (r *markdownTOCReader) line(raw string) {
	if r.done || strings.TrimSpace(raw) == "" {
		return
	}
	matches := markdownTOCItem.FindStringSubmatch(strings.TrimSuffix(raw, "\r"))
	if matches == nil {
		r.close()
		return
	}
	anchor := percentDecoded(matches[3])
	var text richBuilder
	appendInline(&text, matches[2], 0)
	label, _ := text.build(true)
	r.block = append(r.block, markdownTOCLine{indent: indentWidth(matches[1]), entry: tocEntry{text: collapse(label), anchor: anchor}})
}

// close ends the open list; the first with enough items becomes the table of contents, read at its outermost level, so the
// sections nested under a chapter do not count as entries.
func (r *markdownTOCReader) close() {
	block := r.block
	r.block = nil
	if r.done || len(block) < markdownTOCMinEntries {
		return
	}
	outer := block[0].indent
	for _, line := range block {
		outer = min(outer, line.indent)
	}
	entries := []tocEntry{}
	for _, line := range block {
		if line.indent == outer {
			entries = append(entries, line.entry)
		}
	}
	if len(entries) >= markdownTOCMinEntries {
		r.entries, r.done = entries, true
	}
}

// percentDecoded undoes a link's percent-encoding ("%C3%A9pilogue" is "épilogue"); an anchor with a malformed escape, or
// one that does not decode to UTF-8, is kept as written. (The host may not import net/url outside the download flow.)
func percentDecoded(anchor string) string {
	if !strings.Contains(anchor, "%") {
		return anchor
	}
	var out []byte
	for i := 0; i < len(anchor); i++ {
		if anchor[i] != '%' {
			out = append(out, anchor[i])
			continue
		}
		if i+2 >= len(anchor) {
			return anchor
		}
		value, err := strconv.ParseUint(anchor[i+1:i+3], 16, 8)
		if err != nil {
			return anchor
		}
		out = append(out, byte(value))
		i += 2
	}
	if !utf8.Valid(out) {
		return anchor
	}
	return string(out)
}

func indentWidth(prefix string) int {
	width := 0
	for _, r := range prefix {
		if r == '\t' {
			width += 4
		} else {
			width++
		}
	}
	return width
}

// markdownSlug is the anchor GitHub gives a heading: lower-cased, every character that is not a letter, a digit, a mark, a
// space, a hyphen or an underscore dropped, and each space made a hyphen.
func markdownSlug(heading string) string {
	var out strings.Builder
	for _, r := range strings.TrimSpace(heading) {
		switch {
		case r == ' ':
			out.WriteByte('-')
		case r == '-' || r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r):
			out.WriteRune(unicode.ToLower(r))
		}
	}
	return out.String()
}

// markdownSlugger gives each heading its anchor in document order, adding "-1", "-2" to a repeated one as GitHub does.
type markdownSlugger struct {
	seen map[string]int
}

func (s *markdownSlugger) next(heading string) string {
	if s.seen == nil {
		s.seen = map[string]int{}
	}
	slug := markdownSlug(heading)
	count := s.seen[slug]
	s.seen[slug] = count + 1
	if count == 0 {
		return slug
	}
	unique := fmt.Sprintf("%s-%d", slug, count)
	s.seen[unique]++
	return unique
}

// applyTableOfContents makes a manuscript's own table of contents the ordered chapter list once enough of its entries match a
// chapter (S6, tocAuthorityThreshold), and adds a notice whenever some did not. Only the chapter list changes, never the
// sections, so a document without one, or whose one matches weakly, is unaffected. anchorChapter maps an entry's anchor (a
// docx "_Toc" bookmark, a Markdown heading slug) to the chapter it points at.
func applyTableOfContents(draft *Draft, notices []string, entries []tocEntry, titles []string, anchorChapter map[string]string) []string {
	if len(entries) == 0 {
		return notices
	}
	matchedTitles, matchedCount := tocMatchedTitles(entries, titles, anchorChapter)
	if float64(matchedCount)/float64(len(entries)) >= tocAuthorityThreshold {
		draft.ChapterTitles = matchedTitles
	}
	if matchedCount != len(entries) {
		word := "entries"
		if len(entries) == 1 {
			word = "entry"
		}
		notices = append(notices, fmt.Sprintf("The table of contents listed %d %s; %d matched a chapter in the manuscript.", len(entries), word, matchedCount))
	}
	return notices
}
