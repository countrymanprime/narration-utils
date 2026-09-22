package importer

import (
	"bytes"

	"golang.org/x/net/html"
)

// epubBlock is one block-level element read from a spine content document: a
// heading (level 1-6) or an ordinary paragraph-shaped element, with its
// normalized text and inline spans already built (txt-and-epub-import PRD,
// Phase 2, "XHTML to paragraphs"). Heading paragraphs are never emitted as
// body paragraphs, matching the DOCX and Markdown importers.
type epubBlock struct {
	heading int
	text    string
	spans   []Span
}

// epubHeadingTags maps a heading tag name to its outline level.
var epubHeadingTags = map[string]int{"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}

// epubBlockTags are the other element types treated as one paragraph each. A
// container (div, section, body wrappers, list and table containers) is not
// itself a block: it is walked for the blocks nested inside it instead.
var epubBlockTags = map[string]bool{
	"p": true, "li": true, "blockquote": true, "dd": true, "dt": true,
	"td": true, "th": true, "figcaption": true, "pre": true,
}

var epubItalicTags = map[string]bool{"i": true, "em": true}
var epubBoldTags = map[string]bool{"b": true, "strong": true}

// epubSkipTags never contribute text: scripts, styles and embedded/alternate
// content the PRD's "What We're NOT Building" excludes (images, SVG, audio,
// video, scripts; alt text is not read).
var epubSkipTags = map[string]bool{"script": true, "style": true, "img": true, "svg": true, "audio": true, "video": true}

// parseEPUBXHTML turns one spine content document into an ordered list of
// blocks, plus the element ids found in document order used to resolve a
// TOC fragment to a block index: the id of any node seen before or inside a
// block records that block's position (an empty <a id="..."/> anchor placed
// just before its heading is the common exporter shape).
func parseEPUBXHTML(content []byte) ([]epubBlock, map[string]int) {
	doc, err := html.Parse(bytes.NewReader(content))
	if err != nil {
		return nil, nil
	}
	body := findElement(doc, "body")
	if body == nil {
		body = doc
	}
	p := &epubXHTMLParser{ids: map[string]int{}}
	p.walkContainer(body)
	return p.blocks, p.ids
}

type epubXHTMLParser struct {
	blocks []epubBlock
	ids    map[string]int
}

func (p *epubXHTMLParser) recordID(n *html.Node) {
	if id := htmlAttr(n, "id"); id != "" {
		if _, seen := p.ids[id]; !seen {
			p.ids[id] = len(p.blocks)
		}
	}
}

func (p *epubXHTMLParser) walkContainer(n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode || epubSkipTags[c.Data] {
			continue
		}
		p.recordID(c)
		if level, ok := epubHeadingTags[c.Data]; ok {
			var b richBuilder
			collectInline(&b, c)
			text, spans := b.build(true)
			if text != "" {
				p.blocks = append(p.blocks, epubBlock{heading: level, text: text, spans: spans})
			}
			continue
		}
		if epubBlockTags[c.Data] {
			var b richBuilder
			collectInline(&b, c)
			text, spans := b.build(false)
			if text != "" {
				p.blocks = append(p.blocks, epubBlock{text: text, spans: spans})
			}
			continue
		}
		p.walkContainer(c)
	}
}

// collectInline accumulates n's descendant text into b, honoring semantic
// emphasis (i/em, b/strong, u) as spans and <br> as a line break (E3's
// Phase 2 scope: semantic tags only, CSS-class emphasis is Phase 3).
func collectInline(b *richBuilder, n *html.Node) {
	walkInline(b, n, 0)
}

func walkInline(b *richBuilder, n *html.Node, style Style) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		switch c.Type {
		case html.TextNode:
			b.text(c.Data, style)
		case html.ElementNode:
			switch {
			case epubSkipTags[c.Data]:
				continue
			case c.Data == "br":
				b.lineBreak()
			case epubItalicTags[c.Data]:
				walkInline(b, c, style|styleItalic)
			case epubBoldTags[c.Data]:
				walkInline(b, c, style|styleBold)
			case c.Data == "u":
				walkInline(b, c, style|styleUnderline)
			default:
				walkInline(b, c, style)
			}
		}
	}
}

func htmlAttr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func findElement(n *html.Node, tag string) *html.Node {
	if n.Type == html.ElementNode && n.Data == tag {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findElement(c, tag); found != nil {
			return found
		}
	}
	return nil
}
