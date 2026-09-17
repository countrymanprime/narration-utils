package importer

import (
	"archive/zip"
	"encoding/xml"
	"io"
	"path/filepath"
	"strings"
)

type paragraphRecord struct {
	text    string
	heading bool
}

func docxEntry(archive *zip.ReadCloser, name string) ([]byte, bool) {
	for _, file := range archive.File {
		if file.Name == name {
			reader, err := file.Open()
			if err != nil {
				return nil, false
			}
			defer reader.Close()
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

func styleNames(content []byte) map[string]string {
	names := map[string]string{}
	decoder := xml.NewDecoder(strings.NewReader(string(content)))
	id := ""
	paragraph := false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "style":
				id = attr(value, "styleId")
				paragraph = attr(value, "type") == "paragraph"
			case "name":
				if paragraph && id != "" {
					names[id] = strings.ToLower(attr(value, "val"))
				}
			}
		case xml.EndElement:
			if value.Name.Local == "style" {
				id = ""
				paragraph = false
			}
		}
	}
	return names
}

func documentRecords(content []byte, styles map[string]string) []paragraphRecord {
	records := []paragraphRecord{}
	decoder := xml.NewDecoder(strings.NewReader(string(content)))
	inParagraph, inText := false, false
	var text strings.Builder
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
				text.Reset()
				styleID = ""
				outline = ""
			case "t":
				if inParagraph {
					inText = true
				}
			case "pStyle":
				if inParagraph {
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
			case "p":
				if inParagraph {
					trimmed := strings.TrimSpace(text.String())
					if trimmed != "" {
						style := styles[styleID]
						heading := strings.HasPrefix(style, "heading") || style == "title"
						if outline != "" && outline != "9" {
							heading = true
						}
						records = append(records, paragraphRecord{text: trimmed, heading: heading})
					}
					inParagraph = false
				}
			}
		case xml.CharData:
			if inText {
				text.Write([]byte(value))
			}
		}
	}
	return records
}

func docx(path string) (Draft, error) {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return Draft{}, &Error{"Could not read this Word document: " + err.Error()}
	}
	defer archive.Close()
	styles, _ := docxEntry(archive, "word/styles.xml")
	document, ok := docxEntry(archive, "word/document.xml")
	if !ok {
		return Draft{}, &Error{"This .docx file is missing its document contents."}
	}
	records := documentRecords(document, styleNames(styles))
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
	for index, record := range records {
		text := collapse(record.text)
		if record.heading {
			if isNonChapterHeading(record.text) {
				chapter = text
				subtitle = ""
				continue
			}
			lines := strings.Split(record.text, "\n")
			chapter = collapse(lines[0])
			subtitle = ""
			if len(lines) > 1 {
				subtitle = collapse(strings.Join(lines[1:], " "))
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
		paragraphs = append(paragraphs, Paragraph{Chapter: chapter, ChapterSubtitle: subtitlePointer, Text: text, SourceIndex: len(paragraphs)})
	}
	return newDraft("docx", filepath.Base(path), paragraphs, titles)
}
