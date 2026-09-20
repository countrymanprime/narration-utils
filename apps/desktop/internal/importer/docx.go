package importer

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

type paragraphRecord struct {
	text    string
	spans   []Span
	heading bool
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
				heading := strings.HasPrefix(style, "heading") || style == "title"
				if outline != "" && outline != "9" {
					heading = true
				}
				text, spans := builder.build(heading)
				if text != "" {
					records = append(records, paragraphRecord{text: text, spans: spans, heading: heading})
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
	first := len(records)
	for index, record := range records {
		if record.heading && !isNonChapterHeading(record.text) {
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
	for index, record := range records {
		if record.heading {
			if isNonChapterHeading(collapse(record.text)) {
				chapter = collapse(record.text)
				subtitle = ""
				continue
			}
			var glued bool
			chapter, subtitle, glued = headingParts(record.text)
			if glued {
				notices = append(notices, fmt.Sprintf("Heading %q had no gap between its number and title; split into %q and %q.", collapse(record.text), chapter, subtitle))
			}
			titles = append(titles, chapter)
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
	draft, err := newDraft("docx", filepath.Base(path), paragraphs, titles)
	draft.Notices = notices
	if err == nil {
		progress.report(95, "Found %d chapters in %d sections", len(titles), len(draft.Sections))
	}
	return draft, err
}
