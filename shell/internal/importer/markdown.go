package importer

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var markdownHeading = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*#*\s*$`)

func markdown(path string, headingLevel int) (Draft, error) {
	if headingLevel < 1 || headingLevel > 6 {
		return Draft{}, &Error{"Markdown chapter heading level must be between H1 and H6."}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Draft{}, &Error{"Could not read this Markdown file: " + err.Error()}
	}
	content := strings.TrimPrefix(string(raw), "\ufeff")
	chapter, section := "Front Matter", ""
	paragraphs := []Paragraph{}
	titles, pending := []string{}, []string{}
	flush := func() {
		if len(pending) == 0 {
			return
		}
		body := collapse(strings.Join(pending, " "))
		if body != "" {
			var sectionValue *string
			if section != "" {
				copy := section
				sectionValue = &copy
			}
			paragraphs = append(paragraphs, Paragraph{Chapter: chapter, Section: sectionValue, Text: body, SourceIndex: len(paragraphs)})
		}
		pending = nil
	}
	for _, line := range strings.Split(content, "\n") {
		if matches := markdownHeading.FindStringSubmatch(strings.TrimSuffix(line, "\r")); matches != nil {
			flush()
			level := len(matches[1])
			text := collapse(matches[2])
			if level == headingLevel {
				if isNonChapterHeading(text) {
					chapter = text
					section = ""
					continue
				}
				chapter = text
				section = ""
				titles = append(titles, text)
			} else if level > headingLevel {
				section = text
			}
			continue
		}
		if strings.TrimSpace(line) == "" {
			flush()
		} else {
			pending = append(pending, strings.TrimSpace(line))
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
