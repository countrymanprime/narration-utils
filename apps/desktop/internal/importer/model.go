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
	// SubtitleReturnsToBody says the subtitle was a line of plain text under the heading (a two-line plain-text heading block), not
	// part of the heading itself, so a narrator who says it is not a subtitle wants it back as the chapter's first paragraph rather
	// than joined to the title (story-bible-and-import-ux-briefs PRD, Phase 5; case F3 of docs/research/import-heading-misreads.md).
	// Set only on the first paragraph under that heading, which is where the line goes back, so a repeated heading loses no line.
	// Never written to the canonical manuscript.
	SubtitleReturnsToBody bool `json:"-"`
}

type DraftSection struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Subtitle is the first paragraph's chapter subtitle, the one the chapter takes when the manuscript is written
	// (manuscript.canonicalize), so the review shows what the chapter will be called. Empty when the heading had none.
	Subtitle string `json:"subtitle,omitempty"`
	// SubtitleOff is where the subtitle's line goes if the narrator says it is not a subtitle (ApplySubtitleOverrides):
	// SubtitleOffJoinsTitle or SubtitleOffReturnsToBody. Empty when there is no subtitle.
	SubtitleOff    string `json:"subtitleOff,omitempty"`
	ContentKind    string `json:"contentKind"`
	ParagraphCount int    `json:"paragraphCount"`
}

// Property is one labelled fact captured from a character candidate's source lines ("Codename": "Wren"), in the order the
// manuscript gave them. It mirrors guide.Property so bindings.go can hand it straight to Service.CreateFull with no conversion
// beyond the package boundary itself (import-structure-toc-and-characters PRD, Phase 3, S5).
type Property struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type CharacterCandidate struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	SourceSectionID string     `json:"sourceSectionId"`
	Properties      []Property `json:"properties,omitempty"`
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

// splitLabel splits a trimmed candidate line on the first of the label separators and reports whether one was found. The left
// side is a name or a label; the right is a description or a property value depending on what the caller does with it.
func splitLabel(value string) (left, right string, found bool) {
	for _, separator := range []string{" — ", " – ", " - ", ": "} {
		if l, r, ok := strings.Cut(value, separator); ok {
			return strings.TrimSpace(l), strings.TrimSpace(r), true
		}
	}
	return value, "", false
}

// characterCandidateScanner turns a manuscript's cast lines into candidates using the structural rule (S4 of the
// import-structure-toc-and-characters PRD, Phase 3): a bare name line or heading opens a candidate; a "Label: value" line that
// follows attaches as an ordered property to the open candidate; with no candidate open, "Name: description" keeps the legacy
// behavior of opening one from a labelled line whose label looks like a name. This replaces the old per-line, stateless
// characterLine check, which read every "Label: value" as its own candidate (the "Codename" collision bug the PRD's Evidence
// traces by hand): "Codename: X" no longer opens a candidate named "Codename" once a real name line has opened one already.
type characterCandidateScanner struct {
	sourceSectionID string
	candidates      []CharacterCandidate
	seen            map[string]bool
	open            *CharacterCandidate
	// opened is true once openWithName has been called at all, a duplicate name included. It gates the legacy "Name: description"
	// fallback (S4): that reading is only for a block that never opened a candidate structurally at all. Without this, a labelled
	// line found with nothing open right after a *duplicate* name closed one (openWithName leaves s.open nil either way) would be
	// misread as a brand-new candidate opening from whatever short label happened to follow - a name-shaped label like "Notes" or
	// "Age" would fabricate a phantom character (review finding on this phase).
	opened bool
}

// commit closes whatever candidate is open, adding it to the result. A no-op with nothing open.
func (s *characterCandidateScanner) commit() {
	if s.open == nil {
		return
	}
	s.candidates = append(s.candidates, *s.open)
	s.open = nil
}

// openWithName starts a new candidate, closing whatever was open first. A name already claimed (case-insensitively, anywhere in
// the draft) opens nothing, so a repeated heading or line does not duplicate the entry - but it still counts as "opened" so a
// labelled line that follows is not misread as the start of a new one (see the opened field's own comment).
func (s *characterCandidateScanner) openWithName(name string) {
	s.commit()
	s.opened = true
	key := strings.ToLower(name)
	if s.seen[key] {
		return
	}
	s.seen[key] = true
	s.open = &CharacterCandidate{ID: fmt.Sprintf("candidate-%s-%03d", s.sourceSectionID, len(s.candidates)+1), Name: name, SourceSectionID: s.sourceSectionID}
}

// item processes one source line, already bullet-trimmed by the caller for a paragraph split on ';' (several facts on one line).
func (s *characterCandidateScanner) item(value string) {
	value = strings.Trim(value, "•-–—* ")
	if value == "" || len([]rune(value)) > 240 {
		return
	}
	left, right, found := splitLabel(value)
	if !found {
		if looksLikeName(value) {
			s.openWithName(value)
		} else if s.open != nil && s.open.Description == "" {
			s.open.Description = value
		}
		return
	}
	if s.open != nil {
		key := strings.ToLower(left)
		for _, existing := range s.open.Properties {
			if strings.ToLower(existing.Key) == key {
				// The sidecar's create --properties refuses a duplicate key outright (manuscript_guide.py normalize_properties), so
				// a repeated label under one candidate keeps its first value rather than failing the candidate's whole creation.
				return
			}
		}
		s.open.Properties = append(s.open.Properties, Property{Key: left, Value: right})
		return
	}
	if !s.opened && looksLikeName(left) {
		s.openWithName(left)
		if s.open != nil {
			s.open.Description = right
		}
	}
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
// kindOverrides forces a group's contentKind by its exact title, taking precedence over every text-based rule below (EPUB's
// epub:type is authoritative and does not always share a recognizable title, e.g. a dedication page titled "For My Mother" -
// txt-and-epub-import PRD, Phase 3, "Classification"; ADR 0102). Callers with no such signal (DOCX, Markdown, TXT) pass nil.
func newDraft(format, sourceName string, paragraphs []Paragraph, titles []string, headingLevels map[string]int, kindOverrides map[string]string) (Draft, error) {
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
	// candidates starts non-nil (empty, not nil) so an import with no cast still sends "characterCandidates": [] on the wire, as it
	// always has, rather than null (contract_test.go's golden payload pins this).
	scanner := &characterCandidateScanner{seen: map[string]bool{}, candidates: []CharacterCandidate{}}
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
		if override, ok := kindOverrides[group.title]; ok {
			contentKind = override
		}
		if endsCharacterScope {
			characterListActive = false
		}
		if charactersHeading {
			// charactersLevel is only (re)baselined when this heading is opening a fresh scope (characterListActive is false going
			// into it, whether it never started or a shallower heading just ended it above). A heading that also matches
			// isCharacterHeading (a "Cast" subheading nested inside an outer "Characters" section, for instance) must not overwrite
			// the level the outer heading set, or a later sibling of the outer heading would wrongly compare against the nested
			// one's deeper level and never end the section.
			if !characterListActive {
				if hasLevel {
					charactersLevel = level
				} else {
					charactersLevel = 1
				}
			}
			characterListActive = true
		}
		if charactersHeading {
			// commit first: a candidate left open by a *previous* group (a per-character heading whose own body never got a
			// trailing narrative marker to close it) must not still be open when this group's own lines are scanned, or its first
			// labelled line would silently attach to the wrong character instead of starting this group's own candidates (review
			// finding on this phase; the else-if branch below is already safe because openWithName always commits first).
			scanner.commit()
			scanner.sourceSectionID = id
			for _, paragraphIndex := range group.indexes {
				for _, item := range strings.Split(paragraphs[paragraphIndex].Text, ";") {
					scanner.item(item)
				}
			}
		} else if characterListActive && contentKind == "reference" && looksLikeName(group.title) {
			// A per-character heading (docx: each character gets its own heading under Characters) opens its candidate from the
			// heading text itself, then scans its own paragraphs the same way a flat list would: the first bare line becomes the
			// description and any "Label: value" line becomes a property, instead of the old uncapped-first-paragraph description
			// that left every labelled line after it stranded in a reference chapter nothing structured read.
			scanner.sourceSectionID = id
			scanner.openWithName(group.title)
			for _, paragraphIndex := range group.indexes {
				for _, item := range strings.Split(paragraphs[paragraphIndex].Text, ";") {
					scanner.item(item)
				}
			}
		}
		subtitle := firstSubtitle(paragraphs, group.indexes)
		sections = append(sections, DraftSection{ID: id, Title: group.title, Subtitle: subtitle, SubtitleOff: subtitleOff(paragraphs, group.indexes, subtitle), ContentKind: contentKind, ParagraphCount: len(group.indexes)})
	}
	scanner.commit()
	return Draft{Format: format, SourceName: sourceName, Paragraphs: paragraphs, Sections: sections, CharacterCandidates: scanner.candidates, ChapterTitles: titles}, nil
}
