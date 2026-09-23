package importer

import (
	"fmt"
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
	return markdownWithProgress(path, headingLevel, nil)
}

func markdownWithProgress(path string, headingLevel int, progress Progress) (Draft, error) {
	if headingLevel < 1 || headingLevel > 6 {
		return Draft{}, &Error{"Markdown chapter heading level must be between H1 and H6."}
	}
	progress.report(5, "Reading Markdown file %s", filepath.Base(path))
	raw, err := os.ReadFile(path)
	if err != nil {
		return Draft{}, &Error{"Could not read this Markdown file: " + err.Error()}
	}
	progress.report(25, "Parsing %d KB using H%d as the chapter heading level", len(raw)/1024, headingLevel)
	content := strings.TrimPrefix(string(raw), "\xef\xbb\xbf")
	chapter, subtitle, section := "Front Matter", "", ""
	paragraphs := []Paragraph{}
	titles, pending := []string{}, []markdownLine{}
	// headingLevels records the outline depth newDraft needs to bound an active Characters section (S3): every group-starting
	// heading (level == headingLevel) sits at the same depth, chapter or not, so any later one - not only a "Chapter N"-shaped
	// title - now ends the section instead of leaking every later short heading in as a candidate.
	headingLevels := map[string]int{}
	notices := []string{}
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
					if _, seen := headingLevels[chapter]; !seen {
						headingLevels[chapter] = level
					}
					continue
				}
				var glued bool
				chapter, subtitle, glued = headingParts(text)
				if glued {
					notices = append(notices, fmt.Sprintf("Heading %q had no gap between its number and title; split into %q and %q.", collapse(text), chapter, subtitle))
				}
				section = ""
				titles = append(titles, chapter)
				if _, seen := headingLevels[chapter]; !seen {
					headingLevels[chapter] = level
				}
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
	progress.report(60, "Read %d paragraphs under %d chapter headings", len(paragraphs), len(titles))
	for _, notice := range notices {
		progress.report(70, "%s", notice)
	}
	progress.report(80, "Classifying front matter, chapters and reference sections")
	draft, err := newDraft("markdown", filepath.Base(path), paragraphs, titles, headingLevels, nil)
	draft.Notices = notices
	if err == nil {
		progress.report(95, "Found %d chapters in %d sections", len(titles), len(draft.Sections))
	}
	return draft, err
}
