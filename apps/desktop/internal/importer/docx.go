package importer

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type paragraphRecord struct {
	text    string
	spans   []Span
	heading bool
	// level is the paragraph's outline depth when heading is true and a depth could be determined (a numbered "heading N" style,
	// "title" at 0, or a custom style's own outlineLvl); hasLevel is false for a heading whose depth is unclear (docx.go:headingLevel).
	level    int
	hasLevel bool
	// style is the paragraph's own lower-cased style name (styleNames), kept for TOC-entry-style recognition (isTOCEntryStyle).
	style string
	// bookmarks lists the "_Toc"-prefixed w:bookmarkStart names Word opens around a heading's own run content when it builds a
	// table of contents field; a TOC entry's w:hyperlink cites one of these by name (tocAnchor) to point at the heading it names.
	bookmarks []string
	// tocAnchor is the first w:hyperlink w:anchor value starting "_Toc" found in this paragraph, when it is one of the TOC field's
	// own cached entry lines (empty otherwise, including for the heading paragraphs the entries point at).
	tocAnchor string
}

// headingLevel derives a heading's outline depth from its paragraph style name (already lower-cased by styleNames) and, for a custom
// style with no recognised name, its own <w:outlineLvl>. Word's built-in "TOC Heading" style is deliberately excluded from the
// navigation pane via outlineLvl 9, which is also why it must be recognised by name rather than by outline level; it is given level 1,
// the same depth as a chapter heading, so it ends an active Characters section the same way a sibling chapter does.
func headingLevel(style, outline string) (int, bool) {
	switch {
	case style == "title":
		return 0, true
	case style == "toc heading":
		return 1, true
	case strings.HasPrefix(style, "heading"):
		suffix := strings.TrimSpace(strings.TrimPrefix(style, "heading"))
		if suffix == "" {
			return 1, true
		}
		if level, err := strconv.Atoi(suffix); err == nil {
			return level, true
		}
		return 1, true
	}
	if outline != "" && outline != "9" {
		if level, err := strconv.Atoi(outline); err == nil {
			return level + 1, true
		}
		return 1, true
	}
	return 0, false
}

// isTOCEntryStyle matches Word's "TOC 1" .. "TOC 9" paragraph styles, the cached lines of a table of contents field - distinct
// from "TOC Heading" (the heading that introduces the whole section, matched by headingLevel instead).
func isTOCEntryStyle(style string) bool {
	return strings.HasPrefix(style, "toc ") && style != "toc heading"
}

var tocPageNumber = regexp.MustCompile(`[\s.]*\d+\s*$`)

// stripTOCPageNumber removes a trailing dot-leader and page number ("Chapter One .... 3" or, with a PAGEREF field's cached
// result, "Chapter One\t3") from a table of contents entry's visible text, leaving just the entry's own title.
func stripTOCPageNumber(text string) string {
	return strings.TrimSpace(tocPageNumber.ReplaceAllString(text, ""))
}

// tocEntry is one line of a docx's own table of contents, read from either a "TOC N"-styled paragraph or a w:hyperlink whose
// anchor cites a "_Toc" bookmark (docx.go's tocEntries collection in docxWithProgress).
type tocEntry struct {
	text   string
	anchor string
}

// tocAuthorityThreshold is the minimum fraction of a docx's own table-of-contents entries that must match a body heading (by
// bookmark anchor, then normalised text, then position) before the TOC is trusted as the chapter list instead of the heading
// heuristic (import-structure-toc-and-characters PRD, S6). Below it, a hand-typed or stale TOC is common enough that overriding
// the heuristic would do more harm than good; ADR 0089 records this as a real decision, adopting the PRD's own recommendation.
const tocAuthorityThreshold = 0.8

// tocMatchedTitles matches a document's own table-of-contents entries, in their own order, to the chapter titles the heading
// heuristic already found - by bookmark anchor first, then normalised heading text, then position among what is left - and
// reports how many of the TOC's own entries matched something at all (for the mismatch notice). A title is used by at most one
// entry.
func tocMatchedTitles(entries []tocEntry, titles []string, bookmarkChapter map[string]string) (matched []string, matchedCount int) {
	used := make([]bool, len(titles))
	entryTitle := make([]string, len(entries))
	for index, entry := range entries {
		if entry.anchor == "" {
			continue
		}
		chapter, ok := bookmarkChapter[entry.anchor]
		if !ok {
			continue
		}
		for t, title := range titles {
			if !used[t] && title == chapter {
				used[t] = true
				entryTitle[index] = title
				break
			}
		}
	}
	for index, entry := range entries {
		if entryTitle[index] != "" {
			continue
		}
		norm := normalizedHeading(entry.text)
		for t, title := range titles {
			if !used[t] && normalizedHeading(title) == norm {
				used[t] = true
				entryTitle[index] = title
				break
			}
		}
	}
	remaining := []int{}
	for t := range titles {
		if !used[t] {
			remaining = append(remaining, t)
		}
	}
	position := 0
	for index := range entries {
		if entryTitle[index] != "" {
			continue
		}
		if position >= len(remaining) {
			break
		}
		entryTitle[index] = titles[remaining[position]]
		used[remaining[position]] = true
		position++
	}
	for _, title := range entryTitle {
		if title != "" {
			matched = append(matched, title)
			matchedCount++
		}
	}
	return matched, matchedCount
}

func docxEntry(archive *zip.ReadCloser, name string) ([]byte, bool) {
	for _, file := range archive.File {
		if file.Name == name {
			reader, err := file.Open()
			if err != nil {
				return nil, false
			}
			defer func() { _ = reader.Close() }() // read-only
			bytes, err := io.ReadAll(reader)
			return bytes, err == nil
		}
	}
	return nil, false
}

func attr(start xml.StartElement, local string) string {
	for _, attribute := range start.Attr {
		if attribute.Name.Local == local {
			return attribute.Value
		}
	}
	return ""
}

// wordStyles holds the lower-cased display names of a document's paragraph
// and character styles, keyed by style id.
type wordStyles struct {
	paragraph map[string]string
	character map[string]string
}

func styleNames(content []byte) wordStyles {
	styles := wordStyles{paragraph: map[string]string{}, character: map[string]string{}}
	decoder := xml.NewDecoder(strings.NewReader(string(content)))
	id, kind := "", ""
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "style":
				id, kind = attr(value, "styleId"), attr(value, "type")
			case "name":
				if id == "" {
					continue
				}
				name := strings.ToLower(attr(value, "val"))
				switch kind {
				case "paragraph":
					styles.paragraph[id] = name
				case "character":
					styles.character[id] = name
				}
			}
		case xml.EndElement:
			if value.Name.Local == "style" {
				id, kind = "", ""
			}
		}
	}
	return styles
}

// switchOff reports whether a run-property toggle such as <w:b w:val="0"/>
// explicitly disables its formatting; a bare element means "on".
func switchOff(value string) bool {
	switch strings.ToLower(value) {
	case "0", "false", "off", "none":
		return true
	}
	return false
}

// characterStyleFormatting maps the built-in semantic character styles Word
// applies for Emphasis/Strong to the formatting they visually produce.
func characterStyleFormatting(name string) Style {
	switch {
	case strings.Contains(name, "strong"):
		return styleBold
	case strings.Contains(name, "emphasis"):
		return styleItalic
	}
	return 0
}

// documentRecords reads word/document.xml paragraph by paragraph. Beyond <w:t>
// text it honors the structural elements that separate visible text without
// containing any: <w:br/>/<w:cr/> (soft line breaks), <w:tab/>, and
// hyphen variants. Dropping these is what glues "CHAPTER ONE" to its subtitle
// (docs/architecture/docx-import-quirks.md).
func documentRecords(content []byte, styles wordStyles) []paragraphRecord {
	records := []paragraphRecord{}
	decoder := xml.NewDecoder(strings.NewReader(string(content)))
	inParagraph, inRun, inRunProperties, inText := false, false, false, false
	var builder richBuilder
	var runStyle Style
	styleID := ""
	outline := ""
	var bookmarks []string
	tocAnchor := ""
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "p":
				inParagraph = true
				builder.reset()
				styleID = ""
				outline = ""
				bookmarks = nil
				tocAnchor = ""
			case "bookmarkStart":
				if name := attr(value, "name"); strings.HasPrefix(name, "_Toc") {
					bookmarks = append(bookmarks, name)
				}
			case "hyperlink":
				if tocAnchor == "" {
					if anchor := attr(value, "anchor"); strings.HasPrefix(anchor, "_Toc") {
						tocAnchor = anchor
					}
				}
			case "r":
				inRun, runStyle = inParagraph, 0
			case "rPr":
				inRunProperties = inRun
			case "b":
				if inRunProperties && !switchOff(attr(value, "val")) {
					runStyle |= styleBold
				}
			case "i":
				if inRunProperties && !switchOff(attr(value, "val")) {
					runStyle |= styleItalic
				}
			case "u":
				if inRunProperties && !switchOff(attr(value, "val")) {
					runStyle |= styleUnderline
				}
			case "rStyle":
				if inRunProperties {
					runStyle |= characterStyleFormatting(styles.character[attr(value, "val")])
				}
			case "t":
				if inRun {
					inText = true
				}
			case "br", "cr":
				if inRun {
					builder.lineBreak()
				}
			case "tab":
				if inRun {
					builder.tab()
				}
			case "noBreakHyphen":
				if inRun {
					builder.text("-", runStyle)
				}
			case "pStyle":
				if inParagraph && !inRun {
					styleID = attr(value, "val")
				}
			case "outlineLvl":
				if inParagraph {
					outline = attr(value, "val")
				}
			}
		case xml.EndElement:
			switch value.Name.Local {
			case "t":
				inText = false
			case "rPr":
				inRunProperties = false
			case "r":
				inRun = false
			case "p":
				if !inParagraph {
					continue
				}
				inParagraph = false
				style := styles.paragraph[styleID]
				level, hasLevel := headingLevel(style, outline)
				heading := strings.HasPrefix(style, "heading") || style == "title" || style == "toc heading"
				if outline != "" && outline != "9" {
					heading = true
				}
				text, spans := builder.build(heading)
				if text != "" {
					records = append(records, paragraphRecord{text: text, spans: spans, heading: heading, level: level, hasLevel: hasLevel, style: style, bookmarks: bookmarks, tocAnchor: tocAnchor})
				}
			}
		case xml.CharData:
			if inText {
				builder.text(string(value), runStyle)
			}
		}
	}
	return records
}

func docxWithProgress(path string, progress Progress) (Draft, error) {
	progress.report(5, "Opening Word document %s", filepath.Base(path))
	archive, err := zip.OpenReader(path)
	if err != nil {
		return Draft{}, &Error{"Could not read this Word document: " + err.Error()}
	}
	defer func() { _ = archive.Close() }() // read-only
	styles, _ := docxEntry(archive, "word/styles.xml")
	document, ok := docxEntry(archive, "word/document.xml")
	if !ok {
		return Draft{}, &Error{"This .docx file is missing its document contents."}
	}
	progress.report(20, "Reading document structure (%d KB of text)", len(document)/1024)
	records := documentRecords(document, styleNames(styles))
	headings := 0
	for _, record := range records {
		if record.heading {
			headings++
		}
	}
	progress.report(55, "Read %d paragraphs, %d of them headings", len(records), headings)
	// first is the index of the document's first heading of any kind, chapter or not (a Contents/TOC heading included): everything
	// before it is unheaded front matter or cover material, and everything from it on belongs to the heading that introduced it. A
	// TOC heading used to be skipped here so only the first *chapter* heading counted, which is what let a pre-first-chapter TOC's
	// own entries (still ordinary, non-heading paragraphs) fall through to the front-matter heuristic below alongside the real cover
	// text.
	first := len(records)
	for index, record := range records {
		if record.heading {
			first = index
			break
		}
	}
	pre := []string{}
	preRecords := []int{}
	for index, record := range records {
		if index < first && !record.heading {
			pre = append(pre, collapse(record.text))
			preRecords = append(preRecords, index)
		}
	}
	kinds := classifyPreHeading(pre)
	kindsByRecord := map[int]string{}
	for index, recordIndex := range preRecords {
		kindsByRecord[recordIndex] = kinds[index]
	}
	chapter, subtitle := "Front Matter", ""
	paragraphs := []Paragraph{}
	titles := []string{}
	notices := []string{}
	// headingLevels records the outline depth newDraft needs to bound an active Characters section to its own subheadings (S3) -
	// every heading-derived group's title, chapter or not, keyed by its exact text; the first occurrence wins.
	headingLevels := map[string]int{}
	recordLevel := func(title string, record paragraphRecord) {
		if !record.hasLevel {
			return
		}
		if _, seen := headingLevels[title]; !seen {
			headingLevels[title] = record.level
		}
	}
	// bookmarkChapter maps a "_Toc" bookmark name to the chapter title of the heading it was opened inside, for matching a docx's
	// own table of contents to the chapter list (S6, Phase 4): Word wraps a bookmarkStart/End of that name around a heading's own
	// run content when it builds a TOC, and a TOC entry's hyperlink cites that name in its w:anchor.
	bookmarkChapter := map[string]string{}
	recordBookmarks := func(chapter string, record paragraphRecord) {
		for _, name := range record.bookmarks {
			if _, seen := bookmarkChapter[name]; !seen {
				bookmarkChapter[name] = chapter
			}
		}
	}
	var tocEntries []tocEntry
	// open is the chapter heading just read while nothing has followed it yet, so a subtitle set apart from it can still join it:
	// a deeper heading (subtitleHeading) or a paragraph in Word's own "Subtitle" style (import heading misreads F4 and F5, #387).
	// apart says the chapter's subtitle came from such a line, which then returns to the text if the narrator turns it off.
	var open *paragraphRecord
	apart := false
	levels := make([]int, len(records))
	for index, record := range records {
		if record.heading && record.hasLevel {
			levels[index] = max(record.level, 1)
		}
	}
	for index, record := range records {
		if open != nil && subtitle == "" {
			line := collapse(record.text)
			underHeading := record.heading && record.hasLevel && open.hasLevel && subtitleHeading(chapter, open.level, line, record.level) &&
				aloneAtItsLevel(levels, index, open.level)
			if underHeading || (!record.heading && record.style == "subtitle") {
				subtitle, apart, open = line, true, nil
				continue
			}
		}
		open = nil
		if record.heading {
			if isNonChapterHeading(collapse(record.text)) {
				chapter = collapse(record.text)
				subtitle = ""
				recordLevel(chapter, record)
				recordBookmarks(chapter, record)
				continue
			}
			var glued bool
			chapter, subtitle, glued = headingParts(record.text)
			if glued {
				notices = append(notices, fmt.Sprintf("Heading %q had no gap between its number and title; split into %q and %q.", collapse(record.text), chapter, subtitle))
			}
			titles = append(titles, chapter)
			recordLevel(chapter, record)
			recordBookmarks(chapter, record)
			heading := record
			open, apart = &heading, false
			continue
		}
		// A paragraph is a TOC entry only when it is itself "TOC N"-styled; a hyperlink's "_Toc" anchor alone is not enough to
		// tell (a review finding on this phase): Word reuses a heading's existing "_Toc" bookmark, rather than minting a "_Ref"
		// one, for an ordinary in-body cross-reference to that heading ("Insert Cross-reference > Insert as hyperlink"), so an
		// unrelated sentence elsewhere in the manuscript could otherwise be miscounted as one more (unmatched) TOC entry and drag
		// a perfectly accurate TOC below the match threshold. The anchor is still read on every paragraph (record.tocAnchor) and
		// used here once the style already qualifies it, for bookmark-based matching.
		if isTOCEntryStyle(record.style) {
			tocEntries = append(tocEntries, tocEntry{text: stripTOCPageNumber(record.text), anchor: record.tocAnchor})
		}
		if kind, ok := kindsByRecord[index]; ok {
			chapter = kind
			subtitle = ""
		}
		var subtitlePointer *string
		if subtitle != "" {
			copy := subtitle
			subtitlePointer = &copy
		}
		paragraphs = append(paragraphs, Paragraph{Chapter: chapter, ChapterSubtitle: subtitlePointer, SubtitleReturnsToBody: apart && subtitlePointer != nil, Text: record.text, Spans: record.spans, SourceIndex: len(paragraphs)})
		apart = false
	}
	for _, notice := range notices {
		progress.report(70, "%s", notice)
	}
	progress.report(80, "Classifying front matter, chapters and reference sections")
	draft, err := newDraft("docx", filepath.Base(path), paragraphs, titles, headingLevels, nil)
	if err != nil {
		draft.Notices = notices
		return draft, err
	}
	// The docx's own table of contents becomes the authoritative, ordered chapter list once enough of its entries match a real
	// heading (S6): only the exposed chapterTitles list changes here, never Sections/grouping, so a document without a TOC (or
	// whose TOC only weakly matches) is entirely unaffected. Title and Contents were never in `titles`, so they are naturally
	// excluded whenever the TOC does not name them, without special-casing either.
	notices = applyTableOfContents(&draft, notices, tocEntries, titles, bookmarkChapter)
	draft.Notices = notices
	progress.report(95, "Found %d chapters in %d sections", len(titles), len(draft.Sections))
	return draft, nil
}
