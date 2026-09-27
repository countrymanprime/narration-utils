package main

import (
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/prepmarkup"
)

// The script markup layer (docs/prds/prep-depth.prd.md Phase 5, ADR 0381): stress, pause and character-tag spans the
// narrator places on the reader's text, kept in <project>/narration-utils/prep/markup.json and checked against the
// current text on every read, so a span over words that changed is reported stale rather than drawn on the wrong ones.

// PrepMarkupList returns a chapter's markup spans, each resolved against the chapter's current text.
func (h *Host) PrepMarkupList(chapterID string) (string, error) {
	return encodeBinding(h.prepMarkup().List(chapterID))
}

// PrepMarkupSave places one span on a line of a chapter: start and end are UTF-16 offsets into the line's text (the
// reader's own selection), kind is stress, pause or character_tag, and value is the pause length or the character's name.
func (h *Host) PrepMarkupSave(chapterID, paragraphID string, start, end int, kind, value string) (string, error) {
	return encodeBinding(h.prepMarkup().Save(chapterID, paragraphID, start, end, kind, value))
}

// PrepMarkupDelete removes one span by its id; a stale span needs nothing else.
func (h *Host) PrepMarkupDelete(chapterID, id string) (string, error) {
	return encodeBinding(nil, h.prepMarkup().Delete(chapterID, id))
}

// prepMarkup builds the markup store over one services() snapshot: it keeps no state of its own, so a project switch in
// the middle of a call never mixes two projects.
func (h *Host) prepMarkup() *prepmarkup.Service {
	svc := h.services()
	return prepmarkup.New(prepmarkup.Config{
		Project:    svc.config.projectFolder,
		Paragraphs: markupParagraphs(svc.manuscript),
		Reporter:   h.persist,
	})
}

// markupParagraphs reads a chapter's current lines from the manuscript, the same read the reader's own paragraphs come from.
func markupParagraphs(service *manuscript.Service) func(string) ([]prepmarkup.Paragraph, error) {
	return func(chapterID string) ([]prepmarkup.Paragraph, error) {
		if service == nil {
			return nil, nil
		}
		rows, err := service.Paragraphs(chapterID)
		if err != nil {
			return nil, err
		}
		lines := make([]prepmarkup.Paragraph, 0, len(rows))
		for _, row := range rows {
			id, _ := row["id"].(string)
			text, _ := row["text"].(string)
			lines = append(lines, prepmarkup.Paragraph{ID: id, Index: paragraphIndex(row["index"]), Text: text})
		}
		return lines, nil
	}
}

func paragraphIndex(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		return -1
	}
}
