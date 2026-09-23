package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// mappingContext resolves the current manuscript document's ID and the
// project's confirmed chapter-track mapping store from one hostServices
// snapshot, so a mapping binding always agrees with the project a request
// was made against even if a project switch lands mid-call (h.services()'s
// own contract). It refuses when there is no project open, or no manuscript
// imported yet - a mapping is scoped to a document (Q6), so there is
// nothing to list, confirm or clear without one.
func mappingContext(svc hostServices) (documentID string, store *evidence.MappingStore, err error) {
	folder := svc.config.projectFolder
	if folder == "" {
		return "", nil, fmt.Errorf("open a project before working with chapter-track links")
	}
	if svc.manuscript == nil {
		return "", nil, fmt.Errorf("import a manuscript before working with chapter-track links")
	}
	data, err := svc.manuscript.Load()
	if err != nil {
		return "", nil, err
	}
	documentID, _ = data["documentId"].(string)
	if documentID == "" {
		return "", nil, fmt.Errorf("import a manuscript before working with chapter-track links")
	}
	return documentID, evidence.NewMappingStore(folder), nil
}

// mappingList returns every confirmed trackGuid -> chapterId link for the
// current manuscript document.
func (h *Host) mappingList() (map[string]any, error) {
	svc := h.services()
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return nil, err
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"documentId": documentID, "mappings": mappings}, nil
}

// mappingConfirm records trackGUID as the confirmed link for chapterID,
// refusing a chapterID that is not one of the current manuscript's chapters:
// the stored ChapterTitle must be the real title, never one the caller
// invents, because Q9's re-suggestion after a re-import matches on it.
func (h *Host) mappingConfirm(trackGUID, chapterID string) (evidence.TrackMapping, error) {
	svc := h.services()
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return evidence.TrackMapping{}, err
	}
	if trackGUID == "" {
		return evidence.TrackMapping{}, fmt.Errorf("choose a track before confirming a chapter link")
	}
	title, ok, err := chapterTitle(svc, chapterID)
	if err != nil {
		return evidence.TrackMapping{}, err
	}
	if !ok {
		return evidence.TrackMapping{}, fmt.Errorf("that chapter is not part of the current manuscript")
	}
	return store.Confirm(documentID, trackGUID, chapterID, title)
}

// mappingClear removes trackGUID's confirmed link, if any, and returns the
// links that remain.
func (h *Host) mappingClear(trackGUID string) (map[string]any, error) {
	svc := h.services()
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return nil, err
	}
	if err := store.Clear(documentID, trackGUID); err != nil {
		return nil, err
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"documentId": documentID, "mappings": mappings}, nil
}

// chapterTitle looks up chapterID's title among the current manuscript's
// chapters, reporting false when chapterID is not one of them.
func chapterTitle(svc hostServices, chapterID string) (string, bool, error) {
	chapters, err := svc.manuscript.Chapters()
	if err != nil {
		return "", false, err
	}
	for _, chapter := range chapters {
		if id, _ := chapter["id"].(string); id == chapterID {
			title, _ := chapter["title"].(string)
			return title, true, nil
		}
	}
	return "", false, nil
}
