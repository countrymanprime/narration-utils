package importer

// The narrator's answer to "is this heading's second line its subtitle?" (story-bible-and-import-ux-briefs PRD, Phase 5, I2). The
// importer's guess is always yes: every line after a heading's first, and the second line of a two-line plain-text heading, becomes
// the subtitle (headingParts, classifyTxtHeading). A no means one of two things, which the preview says per section in
// DraftSection.SubtitleOff so the review can show the result before the commit (docs/research/import-heading-misreads.md):
//
//   - SubtitleOffJoinsTitle: the line was part of the heading, a title the author wrapped by hand (F1). It joins the title.
//   - SubtitleOffReturnsToBody: the line was plain text under a plain-text heading, an epigraph say (F3). It becomes the chapter's
//     first paragraph again, so it is narrated.

import "fmt"

const (
	SubtitleOffJoinsTitle    = "title"
	SubtitleOffReturnsToBody = "body"
)

// subtitleOff is where the section's subtitle goes when it is turned off, read from the paragraph the subtitle is taken from
// (firstSubtitle). "" when there is no subtitle to turn off.
func subtitleOff(paragraphs []Paragraph, indexes []int, subtitle string) string {
	if subtitle == "" {
		return ""
	}
	if paragraphs[indexes[0]].SubtitleReturnsToBody {
		return SubtitleOffReturnsToBody
	}
	return SubtitleOffJoinsTitle
}

// ApplySubtitleOverrides returns the draft as the narrator corrected it: every section whose id maps to false loses its subtitle,
// which joins the title or returns to the body as its SubtitleOff says. True, a missing id, or false on a section with no subtitle
// changes nothing. An id the draft does not have is refused: the choices were made against another preview. The draft passed in is
// not changed. It runs in the commit, before the manuscript is canonicalized, so the written chapter is what the review showed.
//
// A repeated heading is one section. Returned to the body, each of its headings' own lines comes back in front of the text under it.
// Joined, every paragraph takes the first heading's joined title, as the written chapter already takes only the first heading's
// subtitle. A joined title that happens to equal another section's title is written as one chapter with it, the same way the
// importer already merges a repeated heading.
func ApplySubtitleOverrides(draft Draft, overrides map[string]bool) (Draft, error) {
	byTitle := map[string]DraftSection{}
	known := map[string]bool{}
	for _, section := range draft.Sections {
		known[section.ID] = true
		if keep, chosen := overrides[section.ID]; chosen && !keep && section.SubtitleOff != "" {
			byTitle[section.Title] = section
		}
	}
	for id := range overrides {
		if !known[id] {
			return Draft{}, &Error{fmt.Sprintf("The subtitle choice names a section (%s) that is not in this import preview.", id)}
		}
	}
	if len(byTitle) == 0 {
		return draft, nil
	}
	corrected := draft
	var returned map[string]int
	corrected.Paragraphs, returned = correctedParagraphs(draft.Paragraphs, byTitle)
	corrected.Sections = make([]DraftSection, len(draft.Sections))
	for index, section := range draft.Sections {
		if _, off := byTitle[section.Title]; off {
			if section.SubtitleOff == SubtitleOffReturnsToBody {
				section.ParagraphCount += returned[section.Title]
			} else {
				section.Title = joinedTitle(section)
			}
			section.Subtitle, section.SubtitleOff = "", ""
		}
		corrected.Sections[index] = section
	}
	corrected.ChapterTitles = make([]string, len(draft.ChapterTitles))
	for index, title := range draft.ChapterTitles {
		if section, off := byTitle[title]; off && section.SubtitleOff == SubtitleOffJoinsTitle {
			title = joinedTitle(section)
		}
		corrected.ChapterTitles[index] = title
	}
	return corrected, nil
}

func joinedTitle(section DraftSection) string {
	return collapse(section.Title + " " + section.Subtitle)
}

// correctedParagraphs is a new paragraph list in which the turned-off sections' paragraphs have no subtitle and either sit under the
// joined title or, in front of the first paragraph under each heading (the one the importer marked SubtitleReturnsToBody), get
// that heading's line back as a paragraph of its own. It also returns how many lines went back into each section, by title.
func correctedParagraphs(paragraphs []Paragraph, byTitle map[string]DraftSection) ([]Paragraph, map[string]int) {
	result := make([]Paragraph, 0, len(paragraphs)+len(byTitle))
	returned := map[string]int{}
	for _, paragraph := range paragraphs {
		section, off := byTitle[paragraph.Chapter]
		if !off {
			result = append(result, paragraph)
			continue
		}
		line, startsHeading := paragraph.ChapterSubtitle, paragraph.SubtitleReturnsToBody
		paragraph.ChapterSubtitle, paragraph.SubtitleReturnsToBody = nil, false
		if section.SubtitleOff == SubtitleOffJoinsTitle {
			paragraph.Chapter = joinedTitle(section)
		} else if startsHeading && line != nil {
			returned[section.Title]++
			result = append(result, Paragraph{Chapter: paragraph.Chapter, Text: *line, SourceIndex: paragraph.SourceIndex})
		}
		result = append(result, paragraph)
	}
	return result, returned
}
