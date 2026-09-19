package importer

import (
	"sort"
	"strings"
	"unicode"
)

// Style is a bit set of inline formatting that survives import. Anything the
// reader cannot show faithfully (fonts, colors, sizes) is deliberately not
// modelled: the canonical manuscript keeps plain text authoritative and adds
// only "normal storytelling formatting" on top (ADR-0014).
type Style uint8

const (
	styleBold Style = 1 << iota
	styleItalic
	styleUnderline
)

var styleOrder = []struct {
	flag Style
	name string
}{{styleBold, "bold"}, {styleItalic, "italic"}, {styleUnderline, "underline"}}

// Span marks a formatted range of a paragraph's Text. Offsets are UTF-16 code
// units, the same unit the browser uses for note anchors, so the reader can
// apply them without converting.
type Span struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Style string `json:"style"`
}

type cell struct {
	r     rune
	style Style
}

// richBuilder accumulates a paragraph's raw characters (with soft breaks and
// tabs still distinguishable from ordinary whitespace) and normalizes them in
// one pass, so formatting offsets are computed against the final text.
type richBuilder struct{ cells []cell }

func (b *richBuilder) reset() { b.cells = b.cells[:0] }

func (b *richBuilder) text(value string, style Style) {
	for _, r := range value {
		b.cells = append(b.cells, cell{r: r, style: style})
	}
}

func (b *richBuilder) lineBreak() { b.cells = append(b.cells, cell{r: '\n'}) }
func (b *richBuilder) tab()       { b.cells = append(b.cells, cell{r: '\t'}) }

// build returns the normalized text and its formatting spans. Runs of
// whitespace collapse to one space; a soft break (and, for headings, a tab)
// becomes exactly one "\n" with no spaces around it; leading and trailing
// whitespace is dropped.
func (b *richBuilder) build(tabIsBreak bool) (string, []Span) {
	out := make([]cell, 0, len(b.cells))
	pendingSpace, pendingBreak := false, false
	for _, c := range b.cells {
		switch {
		case c.r == '\n' || (tabIsBreak && c.r == '\t'):
			pendingBreak = true
		case unicode.IsSpace(c.r):
			pendingSpace = true
		default:
			if len(out) > 0 {
				previous := out[len(out)-1].style
				if pendingBreak {
					out = append(out, cell{r: '\n'})
				} else if pendingSpace {
					out = append(out, cell{r: ' ', style: previous & c.style})
				}
			}
			pendingSpace, pendingBreak = false, false
			out = append(out, c)
		}
	}
	var text strings.Builder
	for _, c := range out {
		text.WriteRune(c.r)
	}
	return text.String(), spansOf(out)
}

func utf16Len(r rune) int {
	if r >= 0x10000 {
		return 2
	}
	return 1
}

func spansOf(cells []cell) []Span {
	spans := []Span{}
	for _, entry := range styleOrder {
		start, position, visible := -1, 0, false
		closeSpan := func() {
			if start >= 0 && visible {
				spans = append(spans, Span{Start: start, End: position, Style: entry.name})
			}
			start, visible = -1, false
		}
		for _, c := range cells {
			if c.style&entry.flag != 0 {
				if start < 0 {
					start = position
				}
				visible = visible || !unicode.IsSpace(c.r)
			} else {
				closeSpan()
			}
			position += utf16Len(c.r)
		}
		closeSpan()
	}
	sort.SliceStable(spans, func(left, right int) bool {
		if spans[left].Start != spans[right].Start {
			return spans[left].Start < spans[right].Start
		}
		return spans[left].End < spans[right].End
	})
	if len(spans) == 0 {
		return nil
	}
	return spans
}
