package importer

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
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
					records = append(records, paragraphRecord{text: text, spans: spans, heading: heading, level: level, hasLevel: hasLevel})
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
	for index, record := range records {
		if record.heading {
			if isNonChapterHeading(collapse(record.text)) {
				chapter = collapse(record.text)
				subtitle = ""
				recordLevel(chapter, record)
				continue
			}
			var glued bool
			chapter, subtitle, glued = headingParts(record.text)
			if glued {
				notices = append(notices, fmt.Sprintf("Heading %q had no gap between its number and title; split into %q and %q.", collapse(record.text), chapter, subtitle))
			}
			titles = append(titles, chapter)
			recordLevel(chapter, record)
			continue
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
		paragraphs = append(paragraphs, Paragraph{Chapter: chapter, ChapterSubtitle: subtitlePointer, Text: record.text, Spans: record.spans, SourceIndex: len(paragraphs)})
	}
	for _, notice := range notices {
		progress.report(70, "%s", notice)
	}
	progress.report(80, "Classifying front matter, chapters and reference sections")
	draft, err := newDraft("docx", filepath.Base(path), paragraphs, titles, headingLevels)
	draft.Notices = notices
	if err == nil {
		progress.report(95, "Found %d chapters in %d sections", len(titles), len(draft.Sections))
	}
	return draft, err
}
