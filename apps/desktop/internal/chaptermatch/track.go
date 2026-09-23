package chaptermatch

import (
	"fmt"
	"sort"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// WarningConfirmedChapterMissing: the track's confirmed link names a chapter
// the current manuscript no longer has (re-imported or removed). ForChapter
// never offers such a track for any chapter, so ForTrack does not guess one.
const WarningConfirmedChapterMissing Warning = "confirmed-chapter-missing"

// ChapterCandidate is one chapter a track may hold (ForTrack's direction).
type ChapterCandidate struct {
	ChapterID    string     `json:"chapterId"`
	ChapterTitle string     `json:"chapterTitle"`
	Score        float64    `json:"score"`
	Source       Source     `json:"source"`
	Region       *RegionRef `json:"region"`

	confident bool // as Candidate.confident
}

// TrackResult is ForTrack's answer. Chapter is set only when Status is
// StatusConfirmed or StatusMatched; otherwise Candidates (best first) is what
// the narrator picks from.
type TrackResult struct {
	Status     Status             `json:"status"`
	Chapter    *ChapterCandidate  `json:"chapter"`
	Candidates []ChapterCandidate `json:"candidates"`
	Warnings   []Warning          `json:"warnings"`
}

// ForTrack is ForChapter's other direction: which chapter the track holds
// (ADR 0113). Its candidates are exactly the chapters whose ForChapter lists
// this track as a candidate, with the same score and source, and its status
// follows the same rule (classifyScores): a narrator-confirmed link wins; a
// track linked to a chapter the manuscript no longer has is nobody's
// candidate. It never creates a link.
func ForTrack(trackGUID string, chapters []Chapter, project tracks.Project, confirmed map[string]string) (TrackResult, error) {
	track, ok := findTrack(project, trackGUID)
	if !ok {
		return TrackResult{}, fmt.Errorf("track %q is not in the project", trackGUID)
	}
	candidates := chapterCandidates(track, chapters, project)
	warnings := []Warning{}

	if linkedTo, linked := confirmed[trackGUID]; linked {
		index := chapterIndex(chapters, linkedTo)
		if index < 0 {
			return TrackResult{Status: StatusNone, Candidates: []ChapterCandidate{}, Warnings: append(warnings, WarningConfirmedChapterMissing)}, nil
		}
		chapter := ChapterCandidate{ChapterID: chapters[index].ID, ChapterTitle: chapters[index].Title, Score: ScoreExact, Source: SourceConfirmed}
		if found, ok := findChapterCandidate(candidates, linkedTo); ok {
			chapter.Region = found.Region
		} else {
			warnings = append(warnings, WarningConfirmedTrackRenamed)
		}
		return TrackResult{Status: StatusConfirmed, Chapter: &chapter, Candidates: candidates, Warnings: warnings}, nil
	}

	scores := make([]float64, len(candidates))
	for i, candidate := range candidates {
		scores[i] = candidate.Score
	}
	status := classifyScores(scores, len(candidates) > 0 && candidates[0].confident)
	result := TrackResult{Status: status, Candidates: candidates, Warnings: warnings}
	if status == StatusMatched {
		best := candidates[0]
		result.Chapter = &best
	}
	return result, nil
}

// chapterCandidates mirrors nameCandidates from the track's side: the chapter
// its name matches best, and the chapter each region it plays in matches
// best. A chapter found both ways keeps its better score, and the track name
// on a tie. Best first, ties in manuscript order.
func chapterCandidates(track tracks.Track, chapters []Chapter, project tracks.Project) []ChapterCandidate {
	titles := make([]string, len(chapters))
	for i, chapter := range chapters {
		titles[i] = chapter.Title
	}
	byChapter := map[int]ChapterCandidate{}
	add := func(index int, candidate ChapterCandidate) {
		if existing, ok := byChapter[index]; !ok || candidate.Score > existing.Score+scoreEpsilon {
			byChapter[index] = candidate
		}
	}
	if strings.TrimSpace(track.Name) != "" {
		if match := MatchTitle(titles, track.Name); match.Index >= 0 {
			add(match.Index, ChapterCandidate{ChapterID: chapters[match.Index].ID, ChapterTitle: chapters[match.Index].Title, Score: match.Score, Source: SourceTrackName, confident: match.Confident})
		}
	}
	for _, region := range project.Regions {
		if strings.TrimSpace(region.Name) == "" {
			continue
		}
		if _, audible := track.RecordedEnd(&tracks.Span{Start: region.Start, End: region.End}); !audible {
			continue
		}
		if match := MatchTitle(titles, region.Name); match.Index >= 0 {
			ref := RegionRef{Name: region.Name, Start: region.Start, End: region.End}
			add(match.Index, ChapterCandidate{ChapterID: chapters[match.Index].ID, ChapterTitle: chapters[match.Index].Title, Score: match.Score, Source: SourceRegionName, Region: &ref, confident: match.Confident})
		}
	}

	indexes := make([]int, 0, len(byChapter))
	for index := range byChapter {
		indexes = append(indexes, index)
	}
	sort.Slice(indexes, func(i, j int) bool {
		a, b := byChapter[indexes[i]], byChapter[indexes[j]]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		return indexes[i] < indexes[j]
	})
	candidates := make([]ChapterCandidate, 0, len(indexes))
	for _, index := range indexes {
		candidates = append(candidates, byChapter[index])
	}
	return candidates
}

func findTrack(project tracks.Project, guid string) (tracks.Track, bool) {
	for _, track := range project.Tracks {
		if track.GUID == guid {
			return track, true
		}
	}
	return tracks.Track{}, false
}

func chapterIndex(chapters []Chapter, id string) int {
	for i, chapter := range chapters {
		if chapter.ID == id {
			return i
		}
	}
	return -1
}

func findChapterCandidate(candidates []ChapterCandidate, chapterID string) (ChapterCandidate, bool) {
	for _, candidate := range candidates {
		if candidate.ChapterID == chapterID {
			return candidate, true
		}
	}
	return ChapterCandidate{}, false
}
