package chaptermatch

import (
	"fmt"
	"sort"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Chapter is one manuscript chapter: just its id and title, so this package
// needs nothing from the manuscript package.
type Chapter struct {
	ID    string
	Title string
}

// Status is how sure ForChapter is of a chapter's track (ADR 0110).
type Status string

const (
	// StatusConfirmed: the narrator confirmed the link (chapter-track-map.json,
	// ADR 0100) and the track is in the project.
	StatusConfirmed Status = "confirmed"
	// StatusMatched: one track's name (or a region's) matches the chapter
	// exactly or as a whole-token prefix, and no other comes near it.
	StatusMatched Status = "matched"
	// StatusUncertain: the best candidate is only a fuzzy or an ambiguous-
	// prefix match; the narrator picks.
	StatusUncertain Status = "uncertain"
	// StatusAmbiguous: two or more candidates score (near) equally, or two
	// tracks are confirmed for the chapter; the narrator picks.
	StatusAmbiguous Status = "ambiguous"
	// StatusNone: no track is a candidate. Nothing is ever created.
	StatusNone Status = "none"
)

// Source says what made a track a candidate.
type Source string

const (
	SourceConfirmed  Source = "confirmed"
	SourceTrackName  Source = "track-name"
	SourceRegionName Source = "region-name"
)

// Warning flags something the narrator should see beside the result.
type Warning string

const (
	// WarningConfirmedTrackMissing: a confirmed track is no longer in the
	// project (deleted, or a different .rpp is selected).
	WarningConfirmedTrackMissing Warning = "confirmed-track-missing"
	// WarningConfirmedTrackRenamed: the confirmed track's name, and every region
	// it plays in, no longer match the chapter.
	WarningConfirmedTrackRenamed Warning = "confirmed-track-renamed"
	// WarningConfirmedLinksConflict: several tracks are confirmed for the
	// chapter.
	WarningConfirmedLinksConflict Warning = "confirmed-links-conflict"
)

// NearEqualMargin is how close a second candidate's score must be to the
// best one for the two to count as a tie. An exact name (1.0) is clear of a
// whole-token prefix (0.95); two prefixes, or two fuzzy scores within this
// margin, are not.
const NearEqualMargin = 0.05

// scoreEpsilon absorbs float rounding in score comparisons (1.0 - 0.95 is not
// exactly 0.05).
const scoreEpsilon = 1e-9

// RegionRef is the region a region-name candidate was found through.
type RegionRef struct {
	Name  string  `json:"name"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// Candidate is one track that may hold the chapter.
type Candidate struct {
	TrackGUID  string     `json:"trackGuid"`
	TrackName  string     `json:"trackName"`
	TrackIndex int        `json:"trackIndex"`
	Score      float64    `json:"score"`
	Source     Source     `json:"source"`
	Region     *RegionRef `json:"region"`
}

// Result is ForChapter's answer. Track is set only when Status is
// StatusConfirmed or StatusMatched; otherwise Candidates (best first) is what
// the narrator picks from.
type Result struct {
	Status     Status      `json:"status"`
	Track      *Candidate  `json:"track"`
	Candidates []Candidate `json:"candidates"`
	Warnings   []Warning   `json:"warnings"`
}

// ForChapter finds the track holding chapterID. confirmed is every
// narrator-confirmed link (track GUID -> chapter id, chapter-track-map.json):
// a link for this chapter wins over any name, and a track linked to another
// chapter is never a candidate for this one. Without a usable link, each
// track's name, and each region's name, is matched against every chapter
// title with FindChapterByTrackName, so a track is a candidate only when this
// chapter is the one its name matches best ("Chapter 1" never goes to
// "Chapter 11"). A region candidate is every track with an unmuted item
// playing inside the region.
func ForChapter(chapterID string, chapters []Chapter, project tracks.Project, confirmed map[string]string) (Result, error) {
	target := -1
	titles := make([]string, len(chapters))
	for i, chapter := range chapters {
		titles[i] = chapter.Title
		if chapter.ID == chapterID {
			target = i
		}
	}
	if target < 0 {
		return Result{}, fmt.Errorf("chapter %q is not in the manuscript", chapterID)
	}

	candidates := nameCandidates(target, titles, project, chapterID, confirmed)
	linked, missing := confirmedTracks(chapterID, project, confirmed)
	warnings := []Warning{}
	if missing {
		warnings = append(warnings, WarningConfirmedTrackMissing)
	}

	switch {
	case len(linked) > 1:
		return Result{Status: StatusAmbiguous, Candidates: linked, Warnings: append(warnings, WarningConfirmedLinksConflict)}, nil
	case len(linked) == 1:
		track := linked[0]
		if found, ok := findCandidate(candidates, track.TrackGUID); ok {
			track.Region = found.Region
		} else {
			warnings = append(warnings, WarningConfirmedTrackRenamed)
		}
		return Result{Status: StatusConfirmed, Track: &track, Candidates: candidates, Warnings: warnings}, nil
	}
	return Result{Status: classify(candidates), Track: chosen(candidates), Candidates: candidates, Warnings: warnings}, nil
}

// nameCandidates collects the track-name and region-name candidates, best
// first (ties in track order). A track found both ways keeps its better
// score, and its track name on a tie.
func nameCandidates(target int, titles []string, project tracks.Project, chapterID string, confirmed map[string]string) []Candidate {
	eligible := func(track tracks.Track) bool {
		linkedTo, ok := confirmed[track.GUID]
		return !ok || linkedTo == chapterID
	}
	byTrack := map[string]Candidate{}
	add := func(candidate Candidate) {
		if existing, ok := byTrack[candidate.TrackGUID]; !ok || candidate.Score > existing.Score+scoreEpsilon {
			byTrack[candidate.TrackGUID] = candidate
		}
	}
	for _, track := range project.Tracks {
		if strings.TrimSpace(track.Name) == "" || !eligible(track) {
			continue
		}
		if index, score := FindChapterByTrackName(titles, track.Name); index == target {
			add(Candidate{TrackGUID: track.GUID, TrackName: track.Name, TrackIndex: track.Index, Score: score, Source: SourceTrackName})
		}
	}
	for _, region := range project.Regions {
		if strings.TrimSpace(region.Name) == "" {
			continue
		}
		index, score := FindChapterByTrackName(titles, region.Name)
		if index != target {
			continue
		}
		span := tracks.Span{Start: region.Start, End: region.End}
		for _, track := range project.Tracks {
			if !eligible(track) {
				continue
			}
			if _, audible := track.RecordedEnd(&span); audible {
				ref := RegionRef{Name: region.Name, Start: region.Start, End: region.End}
				add(Candidate{TrackGUID: track.GUID, TrackName: track.Name, TrackIndex: track.Index, Score: score, Source: SourceRegionName, Region: &ref})
			}
		}
	}

	candidates := make([]Candidate, 0, len(byTrack))
	for _, candidate := range byTrack {
		candidates = append(candidates, candidate)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		return candidates[i].TrackIndex < candidates[j].TrackIndex
	})
	return candidates
}

// confirmedTracks returns the project's tracks confirmed for chapterID, in
// track order, and whether any confirmed link names a track the project no
// longer has.
func confirmedTracks(chapterID string, project tracks.Project, confirmed map[string]string) ([]Candidate, bool) {
	present := map[string]bool{}
	var linked []Candidate
	for _, track := range project.Tracks {
		present[track.GUID] = true
		if confirmed[track.GUID] == chapterID {
			linked = append(linked, Candidate{TrackGUID: track.GUID, TrackName: track.Name, TrackIndex: track.Index, Score: ScoreExact, Source: SourceConfirmed})
		}
	}
	missing := false
	for guid, linkedTo := range confirmed {
		if linkedTo == chapterID && !present[guid] {
			missing = true
		}
	}
	return linked, missing
}

func classify(candidates []Candidate) Status {
	switch {
	case len(candidates) == 0:
		return StatusNone
	case len(candidates) > 1 && candidates[0].Score-candidates[1].Score < NearEqualMargin-scoreEpsilon:
		return StatusAmbiguous
	case candidates[0].Score >= ScoreContained-scoreEpsilon:
		return StatusMatched
	default:
		return StatusUncertain
	}
}

func chosen(candidates []Candidate) *Candidate {
	if classify(candidates) != StatusMatched {
		return nil
	}
	best := candidates[0]
	return &best
}

func findCandidate(candidates []Candidate, trackGUID string) (Candidate, bool) {
	for _, candidate := range candidates {
		if candidate.TrackGUID == trackGUID {
			return candidate, true
		}
	}
	return Candidate{}, false
}

// RecordedEnd is where candidate's track's recorded audio ends: over the
// region's span for a candidate found through a region (a track holding
// several chapters), over the whole track otherwise. It reports false when
// the track is gone or holds nothing audible there.
func RecordedEnd(project tracks.Project, candidate Candidate) (tracks.RecordedEnd, bool) {
	for _, track := range project.Tracks {
		if track.GUID != candidate.TrackGUID {
			continue
		}
		if candidate.Region != nil {
			return track.RecordedEnd(&tracks.Span{Start: candidate.Region.Start, End: candidate.Region.End})
		}
		return track.RecordedEnd(nil)
	}
	return tracks.RecordedEnd{}, false
}
