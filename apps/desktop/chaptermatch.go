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
	match, _, err := chapterTrackMatchIn(h.services(), chapterID)
	return match, err
}

// chapterTrackMatchIn is chapterTrackMatchFor over one services snapshot; it also returns the parsed project, so a
// caller (the tail-audio locate) can go on to a track the narrator picked without reading the .rpp again.
func chapterTrackMatchIn(svc hostServices, chapterID string) (chapterTrackMatch, tracks.Project, error) {
	chapters, project, confirmed, err := matchInputs(svc)
	if err != nil {
		return chapterTrackMatch{}, tracks.Project{}, err
	}

	result, err := chaptermatch.ForChapter(chapterID, chapters, project, confirmed)
	if err != nil {
		return chapterTrackMatch{}, tracks.Project{}, fmt.Errorf("that chapter is not part of the current manuscript")
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
	return match, project, nil
}

// matchInputs is what both matcher directions read, from one services
// snapshot: the manuscript's chapters, the selected .rpp as of its last save,
// and every narrator-confirmed link (track GUID -> chapter id).
func matchInputs(svc hostServices) ([]chaptermatch.Chapter, tracks.Project, map[string]string, error) {
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return nil, tracks.Project{}, nil, err
	}
	chapters, err := manuscriptChapters(svc)
	if err != nil {
		return nil, tracks.Project{}, nil, err
	}
	project, err := selectedProject(svc)
	if err != nil {
		return nil, tracks.Project{}, nil, err
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return nil, tracks.Project{}, nil, err
	}
	confirmed := make(map[string]string, len(mappings))
	for _, mapping := range mappings {
		confirmed[mapping.TrackGUID] = mapping.ChapterID
	}
	return chapters, project, confirmed, nil
}

// chapterSuggestion is ChapterSuggestion's payload: the chapter the narrator
// is most likely recording, read from the selected .rpp's armed (else
// selected) track as of its last save (teleprompter-engines-and-input-devices
// PRD Phase 11, ADR 0113).
type chapterSuggestion struct {
	ProjectFile string `json:"projectFile"`
	SavedAt     string `json:"savedAt"`
	chaptermatch.Suggestion
}

// chapterSuggestionFor suggests a chapter from the saved project. It only
// reads: it never creates a track or a link, and never follows a running
// REAPER (that is teleprompter-manuscript-integration PRD Phase 11).
func (h *Host) chapterSuggestionFor() (chapterSuggestion, error) {
	chapters, project, confirmed, err := matchInputs(h.services())
	if err != nil {
		return chapterSuggestion{}, err
	}
	suggestion, err := chaptermatch.Suggest(chapters, project, confirmed)
	if err != nil {
		return chapterSuggestion{}, err
	}
	return chapterSuggestion{ProjectFile: project.Path, SavedAt: savedAt(project.Path), Suggestion: suggestion}, nil
}

// trackChapterEntry is one requested GUID's answer within ChaptersForTracks:
// chaptermatch.TrackResult when the GUID resolved to a track in the project,
// or Error when it did not (a stale finding after a project switch or a
// deleted item never fails the whole call).
type trackChapterEntry struct {
	chaptermatch.TrackResult
	Error string `json:"error,omitempty"`
}

// chaptersForTracksResult is ChaptersForTracks's payload: every requested
// GUID's chapter, from the same saved .rpp as of one read.
type chaptersForTracksResult struct {
	ProjectFile string                       `json:"projectFile"`
	SavedAt     string                       `json:"savedAt"`
	Tracks      map[string]trackChapterEntry `json:"tracks"`
}

// chaptersForTracks is ForTrack (ADR 0113) run over every GUID in guids, in
// bulk: the Review page's chapter grouping (diagnostics-delivery-and-cleanup-
// tools PRD Phase 8) needs a chapter for findings that carry only a track,
// item or take GUID (apps/desktop/internal/findings.Source) instead of a
// manuscript-anchored chapter id, and it groups many findings, from many
// analyzers, at once. A GUID may name a track directly, or an item or take on
// one (resolved via resolveTrackGUID); one unresolved GUID never fails the
// others. It only reads: it never creates a track or a link.
func (h *Host) chaptersForTracks(guids []string) (chaptersForTracksResult, error) {
	chapters, project, confirmed, err := matchInputs(h.services())
	if err != nil {
		return chaptersForTracksResult{}, err
	}
	result := chaptersForTracksResult{
		ProjectFile: project.Path,
		SavedAt:     savedAt(project.Path),
		Tracks:      make(map[string]trackChapterEntry, len(guids)),
	}
	for _, guid := range guids {
		trackGUID, ok := resolveTrackGUID(project, guid)
		if !ok {
			result.Tracks[guid] = trackChapterEntry{Error: fmt.Sprintf("%q is not in the current project", guid)}
			continue
		}
		match, err := chaptermatch.ForTrack(trackGUID, chapters, project, confirmed)
		if err != nil {
			result.Tracks[guid] = trackChapterEntry{Error: err.Error()}
			continue
		}
		result.Tracks[guid] = trackChapterEntry{TrackResult: match}
	}
	return result, nil
}

// resolveTrackGUID finds the track guid names: itself, the track holding the
// item it names, or the track holding the take it names. Source identity in
// findings.Source is not always a track GUID, since an analyzer often only
// knows the item or take it measured.
func resolveTrackGUID(project tracks.Project, guid string) (string, bool) {
	for _, track := range project.Tracks {
		if track.GUID == guid {
			return track.GUID, true
		}
		for _, item := range track.Items {
			if item.GUID == guid {
				return track.GUID, true
			}
			for _, take := range item.Takes {
				if take.GUID == guid {
					return track.GUID, true
				}
			}
		}
	}
	return "", false
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
