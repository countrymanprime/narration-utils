package chaptermatch

import "github.com/countrymanprime/narration-utils/shell/internal/tracks"

// Basis is which of the saved .rpp's tracks a suggestion was read from.
type Basis string

const (
	// BasisArmed: the record-armed track(s), the one the narrator records on.
	BasisArmed Basis = "armed"
	// BasisSelected: no track is armed, so the selected track(s).
	BasisSelected Basis = "selected"
	// BasisNone: no track is armed or selected; nothing is suggested.
	BasisNone Basis = "none"
)

// TrackRef names the track a suggestion was read from.
type TrackRef struct {
	GUID  string `json:"guid"`
	Name  string `json:"name"`
	Index int    `json:"index"`
}

// Suggestion is Suggest's answer: the chapter the narrator is most likely
// recording, as of the .rpp's last save. Track is set when one track was
// read; with several, it is nil and the answer is their shared chapter or a
// choice between theirs.
type Suggestion struct {
	Basis Basis     `json:"basis"`
	Track *TrackRef `json:"track"`
	TrackResult
}

// Suggest finds the chapter the narrator is recording from the saved
// project (ADR 0113): the record-armed track, else the selected one, mapped
// to a chapter with ForTrack. Several such tracks give a confident answer
// only when every one of them is confident about the same chapter; otherwise
// their chapters are offered as a choice. It never guesses past ForTrack's
// statuses and never creates a track or a link.
func Suggest(chapters []Chapter, project tracks.Project, confirmed map[string]string) (Suggestion, error) {
	basis, picked := suggestionTracks(project)
	if len(picked) == 0 {
		return Suggestion{Basis: BasisNone, TrackResult: TrackResult{Status: StatusNone, Candidates: []ChapterCandidate{}, Warnings: []Warning{}}}, nil
	}
	results := make([]TrackResult, 0, len(picked))
	for _, track := range picked {
		result, err := ForTrack(track.GUID, chapters, project, confirmed)
		if err != nil {
			return Suggestion{}, err
		}
		results = append(results, result)
	}
	if len(picked) == 1 {
		track := picked[0]
		return Suggestion{Basis: basis, Track: &TrackRef{GUID: track.GUID, Name: track.Name, Index: track.Index}, TrackResult: results[0]}, nil
	}
	return Suggestion{Basis: basis, TrackResult: combine(results)}, nil
}

// suggestionTracks is the armed tracks, or failing those the selected ones.
func suggestionTracks(project tracks.Project) (Basis, []tracks.Track) {
	var armed, selected []tracks.Track
	for _, track := range project.Tracks {
		if track.Armed {
			armed = append(armed, track)
		}
		if track.Selected {
			selected = append(selected, track)
		}
	}
	switch {
	case len(armed) > 0:
		return BasisArmed, armed
	case len(selected) > 0:
		return BasisSelected, selected
	}
	return BasisNone, nil
}

// combine merges several tracks' answers: one shared confident chapter keeps
// the first track's answer (confirmed only when every track is confirmed);
// anything else is ambiguous between every chapter any track named, or none
// when no track named one.
func combine(results []TrackResult) TrackResult {
	warnings := []Warning{}
	seenWarning := map[Warning]bool{}
	for _, result := range results {
		for _, warning := range result.Warnings {
			if !seenWarning[warning] {
				seenWarning[warning] = true
				warnings = append(warnings, warning)
			}
		}
	}
	if agreed, ok := sharedChapter(results); ok {
		return TrackResult{Status: agreed.status, Chapter: agreed.chapter, Candidates: []ChapterCandidate{*agreed.chapter}, Warnings: warnings}
	}

	candidates := []ChapterCandidate{}
	seen := map[string]bool{}
	for _, result := range results {
		for _, candidate := range append(chapterOf(result), result.Candidates...) {
			if !seen[candidate.ChapterID] {
				seen[candidate.ChapterID] = true
				candidates = append(candidates, candidate)
			}
		}
	}
	if len(candidates) == 0 {
		return TrackResult{Status: StatusNone, Candidates: candidates, Warnings: warnings}
	}
	return TrackResult{Status: StatusAmbiguous, Candidates: candidates, Warnings: warnings}
}

type agreement struct {
	status  Status
	chapter *ChapterCandidate
}

func sharedChapter(results []TrackResult) (agreement, bool) {
	status := StatusConfirmed
	var chapter *ChapterCandidate
	for _, result := range results {
		if result.Chapter == nil || (chapter != nil && result.Chapter.ChapterID != chapter.ChapterID) {
			return agreement{}, false
		}
		if chapter == nil {
			chapter = result.Chapter
		}
		if result.Status != StatusConfirmed {
			status = StatusMatched
		}
	}
	return agreement{status: status, chapter: chapter}, true
}

func chapterOf(result TrackResult) []ChapterCandidate {
	if result.Chapter == nil {
		return nil
	}
	return []ChapterCandidate{*result.Chapter}
}
