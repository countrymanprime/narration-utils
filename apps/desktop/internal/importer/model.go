package importer

import (
	"fmt"
	"strings"
	"unicode"
)

// Paragraph is the wire-compatible draft paragraph consumed by the canonical
// manuscript activation service.
type Paragraph struct {
	Chapter         string  `json:"chapter"`
	ChapterSubtitle *string `json:"chapterSubtitle,omitempty"`
	Section         *string `json:"section"`
	Text            string  `json:"text"`
	Spans           []Span  `json:"spans,omitempty"`
	SourceIndex     int     `json:"sourceIndex"`
}

type DraftSection struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Subtitle is the first paragraph's chapter subtitle, the one the chapter takes when the manuscript is written
	// (manuscript.canonicalize), so the review shows what the chapter will be called. Empty when the heading had none.
	Subtitle       string `json:"subtitle,omitempty"`
	ContentKind    string `json:"contentKind"`
	ParagraphCount int    `json:"paragraphCount"`
}

type CharacterCandidate struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	SourceSectionID string `json:"sourceSectionId"`
}

type Draft struct {
	Format              string               `json:"format"`
	SourceName          string               `json:"sourceName"`
	Paragraphs          []Paragraph          `json:"paragraphs"`
	Sections            []DraftSection       `json:"sections"`
	CharacterCandidates []CharacterCandidate `json:"characterCandidates"`
	ChapterTitles       []string             `json:"chapterTitles"`
	// Notices are human-readable import-log lines about repairs the importer
	// made to the source (e.g. splitting a glued heading).
	Notices []string `json:"notices,omitempty"`
}

type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }

func collapse(value string) string { return strings.Join(strings.Fields(value), " ") }

func classifyPreHeading(paragraphs []string) []string {
	coverCount := 0
	for _, line := range paragraphs {
		if coverCount == 3 || len([]rune(line)) > 120 {
			break
		}
		coverCount++
	}
	hasCover := (coverCount >= 2 && (len(paragraphs) <= 3 || (len(paragraphs) > 1 && (strings.HasPrefix(strings.ToLower(strings.TrimSpace(paragraphs[1])), "by ") || strings.Contains(strings.ToLower(paragraphs[1]), "copyright") || strings.Contains(strings.ToLower(paragraphs[1]), "author"))))) || (len(paragraphs) > 0 && strings.HasPrefix(strings.ToLower(strings.TrimSpace(paragraphs[0])), "title:"))
	result := make([]string, len(paragraphs))
	for index := range paragraphs {
		if hasCover && index < coverCount {
			result[index] = "Cover"
		} else {
			result[index] = "Front Matter"
		}
	}
	return result
}

func normalizedHeading(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r) {
			return r
		}
		return -1
	}, value)), " "))
}

func isCharacterHeading(value string) bool {
	switch normalizedHeading(value) {
	case "characters", "character list", "cast", "cast of characters", "dramatis personae":
		return true
	}
	return false
}

func isReferenceHeading(value string) bool {
	if isCharacterHeading(value) {
		return true
	}
	switch normalizedHeading(value) {
	case "table of contents", "contents", "glossary", "pronunciation guide", "acknowledgements", "acknowledgments", "about the author", "reading group guide", "discussion questions", "family tree", "maps":
		return true
	}
	return false
}

// isNonChapterHeading matches headings that introduce a section (e.g. a table
// of contents) rather than a narrative chapter. Paragraphs following one of
// these headings must not stay attributed to whatever chapter preceded it -
// see docx.go/markdown.go, both of which start a fresh group under the
// heading's own text instead of treating it as an ordinary chapter title.
func isNonChapterHeading(value string) bool {
	switch normalizedHeading(value) {
	case "table of contents", "contents":
		return true
	}
	return false
}

func isNarrativeMarker(value string) bool {
	v := normalizedHeading(value)
	return strings.HasPrefix(v, "chapter ") || strings.HasPrefix(v, "part ") || strings.HasPrefix(v, "book ") || v == "prologue" || v == "epilogue" || v == "afterword"
}

func looksLikeName(value string) bool {
	words := strings.Fields(value)
	if len(words) == 0 || len(words) > 6 || len([]rune(value)) > 80 {
		return false
	}
	for _, r := range value {
		if !unicode.IsLetter(r) && !unicode.IsSpace(r) && r != '\'' && r != '-' && r != '’' {
			return false
		}
	}
	return true
}

func characterLine(value string) (string, string, bool) {
	value = strings.Trim(value, "•-–—* ")
	if value == "" || len([]rune(value)) > 240 {
		return "", "", false
	}
	name, description := value, ""
	for _, separator := range []string{" — ", " – ", " - ", ": "} {
		if left, right, found := strings.Cut(value, separator); found {
			name, description = strings.TrimSpace(left), strings.TrimSpace(right)
			break
		}
	}
	return name, description, looksLikeName(name)
}

// firstSubtitle is the subtitle of the first of the given paragraphs, or "" when it has none or there are no paragraphs. It is what the
// chapter takes when the manuscript is written (manuscript.canonicalize reads the paragraph that starts the chapter), so a repeated
// title, which is merged into one section, shows the first heading's subtitle and a heading with no text under it has none.
func firstSubtitle(paragraphs []Paragraph, indexes []int) string {
	if len(indexes) == 0 {
		return ""
	}
	if subtitle := paragraphs[indexes[0]].ChapterSubtitle; subtitle != nil {
		return *subtitle
	}
	return ""
}

// newDraft groups paragraphs into sections by their (already-detected) chapter title, in first-seen order with any titles named up
// front (so an expected chapter with no paragraphs still gets an empty section). headingLevels gives the outline depth of every
// heading-derived title the caller saw - chapter headings and non-chapter ones like "Contents" alike - keyed by its exact text; a
// title absent from the map (a synthetic group such as "Front Matter" that never had its own heading paragraph) has no known level.
func newDraft(format, sourceName string, paragraphs []Paragraph, titles []string, headingLevels map[string]int) (Draft, error) {
	if len(paragraphs) == 0 {
		return Draft{}, &Error{"The manuscript has no readable text paragraphs."}
	}
	groups := make([]struct {
		title   string
		indexes []int
	}, 0)
	positions := map[string]int{}
	add := func(title string) int {
		if index, ok := positions[title]; ok {
			return index
		}
		positions[title] = len(groups)
		groups = append(groups, struct {
			title   string
			indexes []int
		}{title: title})
		return len(groups) - 1
	}
	for _, title := range titles {
		add(title)
	}
	for index, paragraph := range paragraphs {
		position := add(paragraph.Chapter)
		groups[position].indexes = append(groups[position].indexes, index)
	}
	sections := make([]DraftSection, 0, len(groups))
	candidates := []CharacterCandidate{}
	candidateNames := map[string]bool{}
	characterListActive := false
	charactersLevel := 0
	for sectionIndex, group := range groups {
		id := fmt.Sprintf("section-%04d", sectionIndex+1)
		charactersHeading := isCharacterHeading(group.title)
		narrative := isNarrativeMarker(group.title)
		level, hasLevel := headingLevels[group.title]
		// endsCharacterScope bounds the Characters section to its own subheadings (S3): a heading whose level is as shallow as or
		// shallower than the Characters heading's own (a sibling chapter, or the book's Title) ends it, the same way a Contents
		// heading now does since docx.go/markdown.go record its level too. A heading whose level cannot be determined (a synthetic
		// group that never had its own heading paragraph) falls back to the old narrative-marker check.
		endsCharacterScope := characterListActive && ((hasLevel && level <= charactersLevel) || (!hasLevel && narrative))
		contentKind := "narration"
		if normalizedHeading(group.title) == "cover" || normalizedHeading(group.title) == "opening pages" || normalizedHeading(group.title) == "front matter" {
			contentKind = "opening"
		} else if isReferenceHeading(group.title) || (characterListActive && !endsCharacterScope) {
			contentKind = "reference"
		}
		if endsCharacterScope {
			characterListActive = false
		}
		if charactersHeading {
			characterListActive = true
			if hasLevel {
				charactersLevel = level
			} else {
				charactersLevel = 1
			}
		}
		if charactersHeading {
			for _, paragraphIndex := range group.indexes {
				for _, item := range strings.Split(paragraphs[paragraphIndex].Text, ";") {
					if name, description, ok := characterLine(item); ok && !candidateNames[strings.ToLower(name)] {
						candidateNames[strings.ToLower(name)] = true
						candidates = append(candidates, CharacterCandidate{ID: fmt.Sprintf("candidate-%s-%03d", id, len(candidates)+1), Name: name, Description: description, SourceSectionID: id})
					}
				}
			}
		} else if characterListActive && contentKind == "reference" && looksLikeName(group.title) && !candidateNames[strings.ToLower(group.title)] {
			candidateNames[strings.ToLower(group.title)] = true
			description := ""
			if len(group.indexes) > 0 {
				description = paragraphs[group.indexes[0]].Text
			}
			candidates = append(candidates, CharacterCandidate{ID: fmt.Sprintf("candidate-%s-%03d", id, len(candidates)+1), Name: group.title, Description: description, SourceSectionID: id})
		}
		sections = append(sections, DraftSection{ID: id, Title: group.title, Subtitle: firstSubtitle(paragraphs, group.indexes), ContentKind: contentKind, ParagraphCount: len(group.indexes)})
	}
	return Draft{Format: format, SourceName: sourceName, Paragraphs: paragraphs, Sections: sections, CharacterCandidates: candidates, ChapterTitles: titles}, nil
}
