package main

import (
	"errors"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// chapterKindResult is ManuscriptSetChapterKind's payload: the chapter as the chapter list now sends it (with
// removedFromRecording set while it is out of recording), the kind it had before, and the links a removal cleared.
type chapterKindResult struct {
	Chapter      map[string]any          `json:"chapter"`
	PreviousKind string                  `json:"previousKind"`
	ClearedLinks []evidence.TrackMapping `json:"clearedLinks"`
}

// manuscriptSetChapterKind is chapter-track-link-control PRD Phase 3's "Remove from recording" and "Restore": the
// manuscript service rewrites only that chapter's kind (keeping every id, the paragraphs, the status, notes, findings
// and check results), and a chapter that is no longer narration loses its track links, so the track is free for
// another chapter and no hidden chapter holds one (TL5 A). Every recording surface already filters by kind. A link
// clear that fails leaves the kind changed and reports the error; asking again clears them.
func (h *Host) manuscriptSetChapterKind(chapterID, kind string) (chapterKindResult, error) {
	svc := h.services()
	if svc.manuscript == nil || svc.config.projectFolder == "" {
		return chapterKindResult{}, errors.New("open a project and import a manuscript first")
	}
	change, err := svc.manuscript.SetChapterKind(chapterID, kind, time.Now())
	if err != nil {
		return chapterKindResult{}, err
	}
	result := chapterKindResult{Chapter: change.Chapter, PreviousKind: change.PreviousKind, ClearedLinks: []evidence.TrackMapping{}}
	if kind == "narration" {
		return result, nil
	}
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return chapterKindResult{}, err
	}
	cleared, err := store.ClearChapter(documentID, chapterID)
	if err != nil {
		return chapterKindResult{}, err
	}
	if cleared != nil {
		result.ClearedLinks = cleared
	}
	return result, nil
}
