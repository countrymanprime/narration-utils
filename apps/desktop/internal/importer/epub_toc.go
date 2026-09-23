package importer

import (
	"bytes"
	"encoding/xml"
	"strings"

	"golang.org/x/net/html"
)

// epubTOCEntry is one entry of an EPUB's own table of contents (nav.xhtml,
// EPUB 3, or NCX, EPUB 2): a label, the spine file it targets (resolved and
// cleaned, no fragment) and an optional element id fragment within that
// file, at whatever nesting depth the source TOC gave it (E2: every depth
// starts a chapter).
type epubTOCEntry struct {
	label    string
	file     string
	fragment string
	depth    int
}

// parseEPUBNav reads an EPUB 3 navigation document's <nav epub:type="toc">
// list into an ordered, depth-tagged entry list. x/net/html reports a
// namespaced attribute such as epub:type by its literal name (the PRD's own
// note on this), so it is matched as a plain "epub:type" key rather than a
// separate namespace.
func parseEPUBNav(content []byte, navDir string) []epubTOCEntry {
	doc, err := html.Parse(bytes.NewReader(content))
	if err != nil {
		return nil
	}
	nav := findTOCNav(doc)
	if nav == nil {
		return nil
	}
	var entries []epubTOCEntry
	var walk func(n *html.Node, depth int)
	walk = func(n *html.Node, depth int) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			if c.Data == "li" {
				if a := findFirstChild(c, "a"); a != nil {
					href := htmlAttr(a, "href")
					file, fragment := splitEPUBHref(navDir, href)
					label := collapse(textContent(a))
					if label != "" && file != "" {
						entries = append(entries, epubTOCEntry{label: label, file: file, fragment: fragment, depth: depth})
					}
				}
				if ol := findFirstChild(c, "ol"); ol != nil {
					walk(ol, depth+1)
				}
				continue
			}
			walk(c, depth)
		}
	}
	walk(nav, 0)
	return entries
}

// hasTOCEpubType reports whether an epub:type attribute value's
// space-separated tokens include "toc".
func hasTOCEpubType(value string) bool {
	for _, token := range strings.Fields(value) {
		if token == "toc" {
			return true
		}
	}
	return false
}

func findTOCNav(n *html.Node) *html.Node {
	if n.Type == html.ElementNode && n.Data == "nav" && hasTOCEpubType(htmlAttr(n, "epub:type")) {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findTOCNav(c); found != nil {
			return found
		}
	}
	return nil
}

func findFirstChild(n *html.Node, tag string) *html.Node {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && c.Data == tag {
			return c
		}
	}
	return nil
}

func textContent(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

// ncxNavPoint is one <navPoint> of an EPUB 2 NCX document, recursively
// nested for sub-chapters.
type ncxNavPoint struct {
	NavLabel struct {
		Text string `xml:"text"`
	} `xml:"navLabel"`
	Content struct {
		Src string `xml:"src,attr"`
	} `xml:"content"`
	NavPoint []ncxNavPoint `xml:"navPoint"`
}

type ncxXML struct {
	NavMap struct {
		NavPoint []ncxNavPoint `xml:"navPoint"`
	} `xml:"navMap"`
}

// parseEPUBNCX reads an EPUB 2 toc.ncx (the fallback TOC source when a book
// carries no EPUB 3 nav document, or a book built for EPUB 2 readers).
func parseEPUBNCX(content []byte, ncxDir string) []epubTOCEntry {
	var parsed ncxXML
	if err := xml.Unmarshal(content, &parsed); err != nil {
		return nil
	}
	var entries []epubTOCEntry
	var walk func(points []ncxNavPoint, depth int)
	walk = func(points []ncxNavPoint, depth int) {
		for _, point := range points {
			label := collapse(point.NavLabel.Text)
			file, fragment := splitEPUBHref(ncxDir, point.Content.Src)
			if label != "" && file != "" {
				entries = append(entries, epubTOCEntry{label: label, file: file, fragment: fragment, depth: depth})
			}
			walk(point.NavPoint, depth+1)
		}
	}
	walk(parsed.NavMap.NavPoint, 0)
	return entries
}

// splitEPUBHref splits an href into its file part (resolved against dir,
// cleaned, and rejected - returned "" - if it would leave the archive) and
// its fragment (the target element id within that file), the shape every
// TOC entry and manifest item href needs.
func splitEPUBHref(dir, href string) (file, fragment string) {
	if href == "" {
		return "", ""
	}
	parts := strings.SplitN(href, "#", 2)
	file = resolveEPUBHref(dir, parts[0])
	if len(parts) == 2 {
		fragment = parts[1]
	}
	return file, fragment
}
