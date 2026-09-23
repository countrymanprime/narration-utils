package main

import (
	"fmt"
	"os"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// trackOption is one track the narrator can pick when a chapter's match is not
// confident (the matcher never picks for them, and never creates a track).
type trackOption struct {
	GUID  string `json:"guid"`
	Name  string `json:"name"`
	Index int    `json:"index"`
}

// chapterTrackMatch is ChapterTrackMatch's payload: which track holds a
// chapter and where its recorded audio ends, from the selected .rpp as of its
// last save (teleprompter-manuscript-integration PRD Phase 8, ADR 0110).
type chapterTrackMatch struct {
	ChapterID    string `json:"chapterId"`
	ChapterTitle string `json:"chapterTitle"`
	// ProjectFile is the .rpp read; SavedAt its modification time, which the
	// UI shows as "as of last save" (REAPER may hold newer, unsaved takes).
	ProjectFile string `json:"projectFile"`
	SavedAt     string `json:"savedAt"`
	chaptermatch.Result
	// Tracks lists every track for the picker.
	Tracks []trackOption `json:"tracks"`
	// RecordedEnd is set only for a confirmed or matched track with audible
	// items: an uncertain guess never yields a resume point.
	RecordedEnd *tracks.RecordedEnd `json:"recordedEnd"`
}

// chapterTrackMatchFor resolves chapterID's track in the project's selected
// .rpp. A narrator-confirmed link (chapter-track-map.json) wins over names;
// no match is a status, not an error. Everything comes from one h.services()
// snapshot, so the manuscript, the mapping and the .rpp belong to the same
// project even if a project switch lands mid-call.
func (h *Host) chapterTrackMatchFor(chapterID string) (chapterTrackMatch, error) {
	svc := h.services()
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return chapterTrackMatch{}, err
	}
	chapters, err := manuscriptChapters(svc)
	if err != nil {
		return chapterTrackMatch{}, err
	}
	project, err := selectedProject(svc)
	if err != nil {
		return chapterTrackMatch{}, err
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return chapterTrackMatch{}, err
	}
	confirmed := make(map[string]string, len(mappings))
	for _, mapping := range mappings {
		confirmed[mapping.TrackGUID] = mapping.ChapterID
	}

	result, err := chaptermatch.ForChapter(chapterID, chapters, project, confirmed)
	if err != nil {
		return chapterTrackMatch{}, fmt.Errorf("that chapter is not part of the current manuscript")
	}
	match := chapterTrackMatch{
		ChapterID:   chapterID,
		ProjectFile: project.Path,
		SavedAt:     savedAt(project.Path),
		Result:      result,
		Tracks:      make([]trackOption, 0, len(project.Tracks)),
	}
	for _, chapter := range chapters {
		if chapter.ID == chapterID {
			match.ChapterTitle = chapter.Title
		}
	}
	for _, track := range project.Tracks {
		match.Tracks = append(match.Tracks, trackOption{GUID: track.GUID, Name: track.Name, Index: track.Index})
	}
	if result.Track != nil {
		if end, ok := chaptermatch.RecordedEnd(project, *result.Track); ok {
			match.RecordedEnd = &end
		}
	}
	return match, nil
}

// manuscriptChapters is the current manuscript's chapter list in the
// matcher's shape (every chapter, reference ones included, so a track named
// after a reference section is not mistaken for a narration chapter).
func manuscriptChapters(svc hostServices) ([]chaptermatch.Chapter, error) {
	raw, err := svc.manuscript.Chapters()
	if err != nil {
		return nil, err
	}
	chapters := make([]chaptermatch.Chapter, 0, len(raw))
	for _, chapter := range raw {
		id, _ := chapter["id"].(string)
		title, _ := chapter["title"].(string)
		chapters = append(chapters, chaptermatch.Chapter{ID: id, Title: title})
	}
	return chapters, nil
}

// savedAt is path's modification time (UTC, RFC 3339), or "" when it cannot
// be read.
func savedAt(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return ""
	}
	return info.ModTime().UTC().Format(time.RFC3339)
}
