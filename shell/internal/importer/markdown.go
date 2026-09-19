package importer

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var markdownHeading = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*#*\s*$`)

type markdownLine struct {
	text      string
	hardBreak bool
}

// markdownLineOf trims a source line and reports whether it ends in a
// CommonMark hard break (two trailing spaces or a trailing backslash), which
// the author meant as a visible line break inside the paragraph.
func markdownLineOf(raw string) markdownLine {
	raw = strings.TrimSuffix(raw, "\r")
	hard := strings.HasSuffix(raw, "  ")
	text := strings.TrimSpace(raw)
	if strings.HasSuffix(text, "\\") && !strings.HasSuffix(text, "\\\\") {
		hard = true
		text = strings.TrimSuffix(text, "\\")
	}
	return markdownLine{text: text, hardBreak: hard}
}

func markdown(path string, headingLevel int) (Draft, error) {
	if headingLevel < 1 || headingLevel > 6 {
		return Draft{}, &Error{"Markdown chapter heading level must be between H1 and H6."}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Draft{}, &Error{"Could not read this Markdown file: " + err.Error()}
	}
	content := strings.TrimPrefix(string(raw), "\xef\xbb\xbf")
	chapter, subtitle, section := "Front Matter", "", ""
	paragraphs := []Paragraph{}
	titles, pending := []string{}, []markdownLine{}
	flush := func() {
		if len(pending) == 0 {
			return
		}
		var builder richBuilder
		for index, line := range pending {
			appendInline(&builder, line.text, 0)
			switch {
			case index == len(pending)-1:
			case line.hardBreak:
				builder.lineBreak()
			default:
				builder.text(" ", 0)
			}
		}
		body, spans := builder.build(false)
		if body != "" {
			var sectionValue, subtitleValue *string
			if section != "" {
				copy := section
				sectionValue = &copy
			}
			if subtitle != "" {
				copy := subtitle
				subtitleValue = &copy
			}
			paragraphs = append(paragraphs, Paragraph{Chapter: chapter, ChapterSubtitle: subtitleValue, Section: sectionValue, Text: body, Spans: spans, SourceIndex: len(paragraphs)})
		}
		pending = nil
	}
	for _, line := range strings.Split(content, "\n") {
		if matches := markdownHeading.FindStringSubmatch(strings.TrimSuffix(line, "\r")); matches != nil {
			flush()
			level := len(matches[1])
			var headingText richBuilder
			appendInline(&headingText, matches[2], 0)
			text, _ := headingText.build(true)
			if level == headingLevel {
				if isNonChapterHeading(text) {
					chapter, subtitle, section = collapse(text), "", ""
					continue
				}
				chapter, subtitle, _ = headingParts(text)
				section = ""
				titles = append(titles, chapter)
			} else if level > headingLevel {
				section = collapse(text)
			}
			continue
		}
		if strings.TrimSpace(line) == "" {
			flush()
		} else {
			pending = append(pending, markdownLineOf(line))
		}
	}
	flush()
	pre := []string{}
	preIndexes := []int{}
	for index, paragraph := range paragraphs {
		if paragraph.Chapter == "Front Matter" {
			pre = append(pre, paragraph.Text)
			preIndexes = append(preIndexes, index)
		}
	}
	for index, kind := range classifyPreHeading(pre) {
		paragraphs[preIndexes[index]].Chapter = kind
	}
	return newDraft("markdown", filepath.Base(path), paragraphs, titles)
}
