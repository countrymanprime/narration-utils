package main

import (
	"fmt"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// This file is Phase 1 of docs/prds/chapter-track-link-control.prd.md: an
// atomic "set this chapter's track" and "unlink this chapter", and one read of
// every narration chapter's link state and track facts from a single parse of
// the saved .rpp (ChapterTrackMatch per row would parse it once per chapter).

// chapterTrackSetResult is ChapterTrackSet's payload: the link as written, the
// link it displaced from another chapter (null when the track was free), and
// every link that remains.
type chapterTrackSetResult struct {
	DocumentID string `json:"documentId"`
	evidence.ChapterLinkSet
	Mappings []evidence.TrackMapping `json:"mappings"`
}

// chapterTrackSet makes trackGUID chapterID's one confirmed link, replacing
// any link the chapter had and taking the track from any chapter that held it
// (TL3 A). Like mappingConfirm it refuses a chapter outside the manuscript, so
// the stored title is always the real one.
func (h *Host) chapterTrackSet(chapterID, trackGUID string) (chapterTrackSetResult, error) {
	svc := h.services()
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return chapterTrackSetResult{}, err
	}
	if trackGUID == "" {
		return chapterTrackSetResult{}, fmt.Errorf("choose a track before linking a chapter")
	}
	title, ok, err := chapterTitle(svc, chapterID)
	if err != nil {
		return chapterTrackSetResult{}, err
	}
	if !ok {
		return chapterTrackSetResult{}, fmt.Errorf("that chapter is not part of the current manuscript")
	}
	set, err := store.SetChapter(documentID, chapterID, title, trackGUID)
	if err != nil {
		return chapterTrackSetResult{}, err
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return chapterTrackSetResult{}, err
	}
	return chapterTrackSetResult{DocumentID: documentID, ChapterLinkSet: set, Mappings: mappings}, nil
}

// chapterTrackUnlink removes every link chapterID holds and returns the links
// that remain, in ChapterTrackMapList's shape.
func (h *Host) chapterTrackUnlink(chapterID string) (map[string]any, error) {
	svc := h.services()
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return nil, err
	}
	if _, ok, err := chapterTitle(svc, chapterID); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("that chapter is not part of the current manuscript")
	}
	if _, err := store.ClearChapter(documentID, chapterID); err != nil {
		return nil, err
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"documentId": documentID, "mappings": mappings}, nil
}

// linksProjectState says whether the saved .rpp could be read: ready, none
// found, several found and none chosen, or unreadable.
type linksProjectState string

const (
	linksProjectReady  linksProjectState = "ready"
	linksProjectNone   linksProjectState = "none"
	linksProjectChoose linksProjectState = "choose"
	linksProjectError  linksProjectState = "error"
)

// trackSpan is a track's first item start to its last item end, in project
// seconds.
type trackSpan struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// trackSummary is what the chapter track panel shows about one track, as of
// the .rpp's last save. LinkedChapterID is the chapter the track is confirmed
// for ("" when none), so linking it elsewhere can say which chapter loses it.
type trackSummary struct {
	GUID               string     `json:"guid"`
	Index              int        `json:"index"`
	Name               string     `json:"name"`
	Color              string     `json:"color"`
	Muted              bool       `json:"muted"`
	Soloed             bool       `json:"soloed"`
	ItemCount          int        `json:"itemCount"`
	PlayableCount      int        `json:"playableCount"`
	MissingSourceCount int        `json:"missingSourceCount"`
	UnsupportedCount   int        `json:"unsupportedCount"`
	Span               *trackSpan `json:"span"`
	LinkedChapterID    string     `json:"linkedChapterId"`
}

// chapterTrackLink is one narration chapter's row: the matcher's answer (as
// ChapterTrackMatch gives it), every confirmed link the chapter holds (with
// when it was confirmed, including a link to a track the project no longer
// has), and where the matched track's audio ends.
type chapterTrackLink struct {
	ChapterID    string `json:"chapterId"`
	ChapterTitle string `json:"chapterTitle"`
	chaptermatch.Result
	Links       []evidence.TrackMapping `json:"links"`
	RecordedEnd *tracks.RecordedEnd     `json:"recordedEnd"`
}

// chapterTrackLinks is ChapterTrackLinks' payload. When Project is not ready,
// Message says why, Tracks is empty and every chapter's status is none (the
// match is unknown without a project), but its confirmed links are listed.
type chapterTrackLinks struct {
	Project     linksProjectState  `json:"project"`
	Message     string             `json:"message"`
	ProjectFile string             `json:"projectFile"`
	SavedAt     string             `json:"savedAt"`
	Tracks      []trackSummary     `json:"tracks"`
	Chapters    []chapterTrackLink `json:"chapters"`
}

func (h *Host) chapterTrackLinks() (chapterTrackLinks, error) {
	return chapterTrackLinksIn(h.services())
}

// chapterTrackLinksIn reads the manuscript, the confirmed links and the saved
// .rpp once, from one services snapshot, and resolves every narration chapter
// against them. It refuses without a project or a manuscript, as
// mappingContext does; a missing or unreadable .rpp is a state, not an error.
func chapterTrackLinksIn(svc hostServices) (chapterTrackLinks, error) {
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return chapterTrackLinks{}, err
	}
	// ChaptersUnmeasured: the recorded fractions would parse the .rpp a second time.
	raw, err := svc.manuscript.ChaptersUnmeasured()
	if err != nil {
		return chapterTrackLinks{}, err
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return chapterTrackLinks{}, err
	}
	confirmed := make(map[string]string, len(mappings))
	for _, mapping := range mappings {
		confirmed[mapping.TrackGUID] = mapping.ChapterID
	}
	chapters := make([]chaptermatch.Chapter, 0, len(raw))
	narration := make([]chaptermatch.Chapter, 0, len(raw))
	for _, chapter := range raw {
		id, _ := chapter["id"].(string)
		title, _ := chapter["title"].(string)
		chapters = append(chapters, chaptermatch.Chapter{ID: id, Title: title})
		if kind, _ := chapter["contentKind"].(string); kind == "" || kind == "narration" {
			narration = append(narration, chaptermatch.Chapter{ID: id, Title: title})
		}
	}

	links := chapterTrackLinks{Tracks: []trackSummary{}, Chapters: make([]chapterTrackLink, 0, len(narration))}
	project, state, message := readLinksProject(svc)
	links.Project, links.Message = state, message
	if state == linksProjectReady {
		links.ProjectFile, links.SavedAt = project.Path, savedAt(project.Path)
		for _, track := range project.Tracks {
			links.Tracks = append(links.Tracks, summarizeTrack(track, confirmed[track.GUID]))
		}
	}
	for _, chapter := range narration {
		row := chapterTrackLink{ChapterID: chapter.ID, ChapterTitle: chapter.Title, Links: []evidence.TrackMapping{}}
		for _, mapping := range mappings {
			if mapping.ChapterID == chapter.ID {
				row.Links = append(row.Links, mapping)
			}
		}
		if state != linksProjectReady {
			row.Result = chaptermatch.Result{Status: chaptermatch.StatusNone, Candidates: []chaptermatch.Candidate{}, Warnings: []chaptermatch.Warning{}}
			links.Chapters = append(links.Chapters, row)
			continue
		}
		result, err := chaptermatch.ForChapter(chapter.ID, chapters, project, confirmed)
		if err != nil {
			return chapterTrackLinks{}, err
		}
		row.Result = result
		if result.Track != nil {
			if end, ok := chaptermatch.RecordedEnd(project, *result.Track); ok {
				row.RecordedEnd = &end
			}
		}
		links.Chapters = append(links.Chapters, row)
	}
	return links, nil
}

// readLinksProject parses the project's selected .rpp, telling apart no .rpp
// found, several with none chosen, and one that could not be read.
func readLinksProject(svc hostServices) (tracks.Project, linksProjectState, string) {
	candidates, selected, err := discoverProjectFiles(svc.config.projectFolder, svc.settings)
	if err != nil {
		return tracks.Project{}, linksProjectError, err.Error()
	}
	if selected == "" {
		if len(candidates) == 0 {
			return tracks.Project{}, linksProjectNone, "No REAPER project (.rpp) file was found in this project folder."
		}
		return tracks.Project{}, linksProjectChoose, "Choose which REAPER project file to use on the Tracks page."
	}
	project, err := tracks.Parse(selected)
	if err != nil {
		return tracks.Project{}, linksProjectError, fmt.Sprintf("Could not read %s: %v", filepath.Base(selected), err)
	}
	return project, linksProjectReady, ""
}

// summarizeTrack counts a track's items the way the Tracks page does (playable
// is supported with its source present) and spans them.
func summarizeTrack(track tracks.Track, linkedChapterID string) trackSummary {
	summary := trackSummary{
		GUID: track.GUID, Index: track.Index, Name: track.Name, Color: track.Color,
		Muted: track.Muted, Soloed: track.Soloed, ItemCount: len(track.Items), LinkedChapterID: linkedChapterID,
	}
	for _, item := range track.Items {
		switch {
		case !item.SourceAvailable:
			summary.MissingSourceCount++
		case !item.Supported:
			summary.UnsupportedCount++
		default:
			summary.PlayableCount++
		}
		end := item.Position + item.Length
		if summary.Span == nil {
			summary.Span = &trackSpan{Start: item.Position, End: end}
			continue
		}
		summary.Span.Start = min(summary.Span.Start, item.Position)
		summary.Span.End = max(summary.Span.End, end)
	}
	return summary
}
