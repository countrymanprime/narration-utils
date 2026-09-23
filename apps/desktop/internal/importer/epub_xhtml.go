package importer

import (
	"archive/zip"
	"bytes"
	"strings"

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
// blocks, the element ids found in document order (used to resolve a TOC
// fragment to a block index: the id of any node seen before or inside a
// block records that block's position, an empty <a id="..."/> anchor placed
// just before its heading is the common exporter shape), and the document's
// own epub:type (read from <body epub:type="...">, Architecture notes,
// "Classification"; "" if it carries none).
//
// files, budget, docDir and cssCache let it resolve E3's CSS-class emphasis
// (Phase 3): a linked stylesheet is read once per href across the whole book
// (docDir resolves a relative href, the shared cssCache avoids re-reading and
// re-charging the size budget for every document that links it) and merged
// with any inline <style> the document carries itself. unresolvedClasses
// accumulates, book-wide, every class name a stylesheet rule named but this
// importer could not reduce to a Style (E3: "text without a span and a count
// in Notices").
func parseEPUBXHTML(content []byte, files []*zip.File, budget *int64, docDir string, cssCache map[string]map[string]Style, unresolvedClasses map[string]bool) (blocks []epubBlock, ids map[string]int, bodyType string) {
	doc, err := html.Parse(bytes.NewReader(content))
	if err != nil {
		return nil, nil, ""
	}
	body := findElement(doc, "body")
	if body == nil {
		body = doc
	}
	classStyles := epubDocumentClassStyles(doc, files, budget, docDir, cssCache, unresolvedClasses)
	p := &epubXHTMLParser{ids: map[string]int{}, classStyles: classStyles}
	p.walkContainer(body)
	return p.blocks, p.ids, htmlAttr(body, "epub:type")
}

// epubDocumentClassStyles collects the class -> Style map this document's
// stylesheets imply: any inline <style> element plus every
// <link rel="stylesheet" href="..."> the document itself references,
// resolved against docDir. A linked stylesheet is parsed once per href for
// the whole book and cached in cssCache; unresolvedClasses is merged in
// directly since it is already shared book-wide.
func epubDocumentClassStyles(doc *html.Node, files []*zip.File, budget *int64, docDir string, cssCache map[string]map[string]Style, unresolvedClasses map[string]bool) map[string]Style {
	merged := map[string]Style{}
	merge := func(styles map[string]Style) {
		for class, style := range styles {
			merged[class] |= style
		}
	}
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "style":
				styles, unresolved := parseEPUBCSSClasses(textContent(n))
				merge(styles)
				for class := range unresolved {
					unresolvedClasses[class] = true
				}
			case "link":
				if strings.EqualFold(htmlAttr(n, "rel"), "stylesheet") {
					if href := resolveEPUBHref(docDir, htmlAttr(n, "href")); href != "" {
						merge(epubCachedStylesheetClasses(href, files, budget, cssCache, unresolvedClasses))
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return merged
}

// epubCachedStylesheetClasses reads and parses one linked stylesheet at most
// once per href for the whole book: later documents that link the same file
// (the common case - one shared stylesheet.css) reuse the cached result
// rather than reading the archive entry, and drawing down the size budget,
// again.
func epubCachedStylesheetClasses(href string, files []*zip.File, budget *int64, cssCache map[string]map[string]Style, unresolvedClasses map[string]bool) map[string]Style {
	if cached, ok := cssCache[href]; ok {
		return cached
	}
	data, err := epubEntry(files, href, budget)
	if err != nil {
		cssCache[href] = nil
		return nil
	}
	styles, unresolved := parseEPUBCSSClasses(string(data))
	for class := range unresolved {
		unresolvedClasses[class] = true
	}
	cssCache[href] = styles
	return styles
}

type epubXHTMLParser struct {
	blocks      []epubBlock
	ids         map[string]int
	classStyles map[string]Style
}

func (p *epubXHTMLParser) recordID(n *html.Node) {
	if id := htmlAttr(n, "id"); id != "" {
		if _, seen := p.ids[id]; !seen {
			p.ids[id] = len(p.blocks)
		}
	}
}

// classStyleOf ORs together the Style every one of n's space-separated class
// tokens maps to (E3: a book's own stylesheet classes, most commonly written
// as a single class on a <span>).
func (p *epubXHTMLParser) classStyleOf(n *html.Node) Style {
	var style Style
	for _, class := range strings.Fields(htmlAttr(n, "class")) {
		style |= p.classStyles[class]
	}
	return style
}

func (p *epubXHTMLParser) walkContainer(n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode || epubSkipTags[c.Data] {
			continue
		}
		p.recordID(c)
		if level, ok := epubHeadingTags[c.Data]; ok {
			var b richBuilder
			p.collectInline(&b, c, p.classStyleOf(c))
			text, spans := b.build(true)
			if text != "" {
				p.blocks = append(p.blocks, epubBlock{heading: level, text: text, spans: spans})
			}
			continue
		}
		if epubBlockTags[c.Data] {
			var b richBuilder
			p.collectInline(&b, c, p.classStyleOf(c))
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
// emphasis (i/em, b/strong, u) and single-class stylesheet emphasis (E3) as
// spans, and <br> as a line break. base is any style the block element n sits
// in already carries from its own class (e.g. <p class="italic">).
func (p *epubXHTMLParser) collectInline(b *richBuilder, n *html.Node, base Style) {
	p.walkInline(b, n, base)
}

// epubNoteRefType matches an epub:type value naming an inline note
// reference. Its text (the footnote marker, e.g. a superscript digit) is
// dropped so "the end.1" never reaches the narrator (E4); the note's own
// body, kept elsewhere as reference content, is unaffected.
func epubNoteRefType(value string) bool {
	for _, token := range strings.Fields(value) {
		if token == "noteref" {
			return true
		}
	}
	return false
}

func (p *epubXHTMLParser) walkInline(b *richBuilder, n *html.Node, style Style) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		switch c.Type {
		case html.TextNode:
			b.text(c.Data, style)
		case html.ElementNode:
			switch {
			case epubSkipTags[c.Data]:
				continue
			case epubNoteRefType(htmlAttr(c, "epub:type")):
				continue // E4: the reference marker itself is dropped, not just unstyled
			case c.Data == "br":
				b.lineBreak()
			case epubItalicTags[c.Data]:
				p.walkInline(b, c, style|styleItalic|p.classStyleOf(c))
			case epubBoldTags[c.Data]:
				p.walkInline(b, c, style|styleBold|p.classStyleOf(c))
			case c.Data == "u":
				p.walkInline(b, c, style|styleUnderline|p.classStyleOf(c))
			default:
				p.walkInline(b, c, style|p.classStyleOf(c))
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
