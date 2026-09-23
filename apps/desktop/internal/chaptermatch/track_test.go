package chaptermatch

import (
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func mustResolveTrack(t *testing.T, trackGUID string, chapters []Chapter, project tracks.Project, confirmed map[string]string) TrackResult {
	t.Helper()
	result, err := ForTrack(trackGUID, chapters, project, confirmed)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestTheChapter1TrackHoldsChapter1NotChapter11(t *testing.T) {
	result := mustResolveTrack(t, guidChapter1, fixtureChapters, fixtureProject(t), nil)
	if result.Status != StatusMatched || result.Chapter == nil || result.Chapter.ChapterID != "c-0001" || result.Chapter.Score != ScoreExact {
		t.Fatalf("result = %+v, want matched to Chapter 1 exactly", result)
	}
	eleven := mustResolveTrack(t, guidChapter11, fixtureChapters, fixtureProject(t), nil)
	if eleven.Status != StatusMatched || eleven.Chapter.ChapterID != "c-0011" {
		t.Fatalf("Chapter 11 track = %+v, want Chapter 11", eleven)
	}
}

func TestATrackPlayingInTwoChapterRegionsIsAmbiguous(t *testing.T) {
	result := mustResolveTrack(t, guidNarration, fixtureChapters, fixtureProject(t), nil)
	if result.Status != StatusAmbiguous || result.Chapter != nil || len(result.Candidates) != 2 {
		t.Fatalf("result = %+v, want ambiguous between the Chapter Two and Epilogue regions", result)
	}
	for _, candidate := range result.Candidates {
		if candidate.Source != SourceRegionName || candidate.Region == nil {
			t.Fatalf("candidate = %+v, want a region-name candidate with its region", candidate)
		}
	}
}

func TestAFuzzyTrackNameIsOnlyUncertain(t *testing.T) {
	chapters := []Chapter{{ID: "c-1", Title: "The Rabbit Hole"}, {ID: "c-2", Title: "The Pool of Tears"}}
	project := namedProject("The Rabit Hole")
	result := mustResolveTrack(t, project.Tracks[0].GUID, chapters, project, nil)
	if result.Status != StatusUncertain || result.Chapter != nil || len(result.Candidates) != 1 || result.Candidates[0].ChapterID != "c-1" {
		t.Fatalf("result = %+v, want uncertain with The Rabbit Hole as the one choice", result)
	}
}

func TestATrackNamedForNoChapterIsNone(t *testing.T) {
	result := mustResolveTrack(t, guidRoomTone, fixtureChapters, fixtureProject(t), nil)
	if result.Status != StatusNone || result.Chapter != nil || len(result.Candidates) != 0 {
		t.Fatalf("result = %+v, want none", result)
	}
}

func TestAConfirmedLinkWinsOverTheTrackName(t *testing.T) {
	confirmed := map[string]string{guidChapter11: "c-0003"}
	result := mustResolveTrack(t, guidChapter11, fixtureChapters, fixtureProject(t), confirmed)
	if result.Status != StatusConfirmed || result.Chapter.ChapterID != "c-0003" || result.Chapter.Source != SourceConfirmed {
		t.Fatalf("result = %+v, want confirmed to Chapter Three", result)
	}
	if !reflect.DeepEqual(result.Warnings, []Warning{WarningConfirmedTrackRenamed}) {
		t.Fatalf("warnings = %v, want the renamed warning (the name says Chapter 11)", result.Warnings)
	}
}

func TestALinkToAChapterTheManuscriptLostSuggestsNothing(t *testing.T) {
	confirmed := map[string]string{guidChapter1: "c-gone"}
	result := mustResolveTrack(t, guidChapter1, fixtureChapters, fixtureProject(t), confirmed)
	if result.Status != StatusNone || result.Chapter != nil || !reflect.DeepEqual(result.Warnings, []Warning{WarningConfirmedChapterMissing}) {
		t.Fatalf("result = %+v, want none with the missing-chapter warning", result)
	}
	if forChapter := mustResolve(t, "c-0001", fixtureChapters, fixtureProject(t), confirmed); len(forChapter.Candidates) != 0 {
		t.Fatalf("ForChapter = %+v, want the linked-elsewhere track to be nobody's candidate either", forChapter)
	}
}

func TestForTrackRefusesATrackOutsideTheProject(t *testing.T) {
	if _, err := ForTrack("{not-a-track}", fixtureChapters, fixtureProject(t), nil); err == nil {
		t.Fatal("want an error for a track the project does not have")
	}
}

// directionCases are the projects both directions are checked over: the REAPER-shaped fixture (track and region names)
// and a set of names covering exact, prefix, ambiguous-prefix, fuzzy and no match.
func directionCases(t *testing.T) []struct {
	chapters []Chapter
	project  tracks.Project
} {
	names := namedProject("Chapter 1", "Chapter 11", "Chapter 2", "Chaptr 2", "Chapter", "chapter two pickups", "", "Epilogue", "Room Tone", "Prolog")
	return []struct {
		chapters []Chapter
		project  tracks.Project
	}{
		{fixtureChapters, fixtureProject(t)},
		{
			[]Chapter{{ID: "c-1", Title: "Chapter 1"}, {ID: "c-2", Title: "Chapter 2: The Pool"}, {ID: "c-2b", Title: "Chapter Two Again"}, {ID: "c-11", Title: "Chapter 11"}, {ID: "c-e", Title: "Epilogue"}, {ID: "c-p", Title: "Prologue"}},
			names,
		},
	}
}

// Parity: without links, ForTrack lists chapter C (score and source included) exactly when ForChapter(C) lists the
// track; so the two directions can never disagree about which names match.
func TestForTrackAndForChapterAgreeOnEveryCandidate(t *testing.T) {
	for _, c := range directionCases(t) {
		for _, track := range c.project.Tracks {
			byTrack := map[string]ChapterCandidate{}
			for _, candidate := range mustResolveTrack(t, track.GUID, c.chapters, c.project, nil).Candidates {
				byTrack[candidate.ChapterID] = candidate
			}
			for _, chapter := range c.chapters {
				var fromChapter *Candidate
				for _, candidate := range mustResolve(t, chapter.ID, c.chapters, c.project, nil).Candidates {
					if candidate.TrackGUID == track.GUID {
						found := candidate
						fromChapter = &found
					}
				}
				fromTrack, listed := byTrack[chapter.ID]
				if listed != (fromChapter != nil) {
					t.Fatalf("track %q, chapter %q: ForTrack lists it %v, ForChapter lists it %v", track.Name, chapter.Title, listed, fromChapter != nil)
				}
				if listed && (fromTrack.Score != fromChapter.Score || fromTrack.Source != fromChapter.Source || !reflect.DeepEqual(fromTrack.Region, fromChapter.Region)) {
					t.Fatalf("track %q, chapter %q: ForTrack %+v, ForChapter %+v", track.Name, chapter.Title, fromTrack, *fromChapter)
				}
			}
		}
	}
}

// Parity with links: a track linked to chapter C is confirmed for C both ways, and is no other chapter's candidate.
func TestForTrackAndForChapterAgreeOnAConfirmedLink(t *testing.T) {
	project := fixtureProject(t)
	confirmed := map[string]string{guidNarration: "c-0002", guidChapter11: "c-0001"}
	for guid, chapterID := range confirmed {
		result := mustResolveTrack(t, guid, fixtureChapters, project, confirmed)
		if result.Status != StatusConfirmed || result.Chapter.ChapterID != chapterID {
			t.Fatalf("ForTrack(%s) = %+v, want confirmed to %s", guid, result, chapterID)
		}
		forChapter := mustResolve(t, chapterID, fixtureChapters, project, confirmed)
		if forChapter.Status != StatusConfirmed || forChapter.Track.TrackGUID != guid {
			t.Fatalf("ForChapter(%s) = %+v, want confirmed to %s", chapterID, forChapter, guid)
		}
		for _, other := range fixtureChapters {
			if other.ID == chapterID {
				continue
			}
			for _, candidate := range mustResolve(t, other.ID, fixtureChapters, project, confirmed).Candidates {
				if candidate.TrackGUID == guid {
					t.Fatalf("track %s is linked to %s but is a candidate for %s", guid, chapterID, other.ID)
				}
			}
		}
	}
}

// The status rule is shared: a track ForTrack matches to a chapter C would, alone in the project, be ForChapter(C)'s
// match too; and one ForTrack only offers (uncertain) would, alone, only be offered by ForChapter(C) as well.
func TestForTrackUsesTheSameConfidenceRuleAsForChapter(t *testing.T) {
	for _, c := range directionCases(t) {
		for _, track := range c.project.Tracks {
			result := mustResolveTrack(t, track.GUID, c.chapters, c.project, nil)
			if result.Status != StatusMatched && result.Status != StatusUncertain {
				continue
			}
			alone := tracks.Project{Tracks: []tracks.Track{track}, Regions: c.project.Regions}
			forChapter := mustResolve(t, result.Candidates[0].ChapterID, c.chapters, alone, nil)
			if forChapter.Status != result.Status {
				t.Fatalf("track %q: ForTrack says %s, ForChapter(%s) with the track alone says %s", track.Name, result.Status, result.Candidates[0].ChapterTitle, forChapter.Status)
			}
		}
	}
}

// ADR 0110: the fuzzy fallback is never confident, even when its ratio reaches a prefix match's score.
func TestAFuzzyMatchScoringAsHighAsAPrefixIsStillUncertainForAChapter(t *testing.T) {
	chapters := []Chapter{{ID: "c-1", Title: "The Rabbit Hole"}, {ID: "c-2", Title: "The Pool of Tears"}}
	result := mustResolve(t, "c-1", chapters, namedProject("The Rabit Hole"), nil)
	if result.Status != StatusUncertain || result.Track != nil || result.Candidates[0].Score < ScoreContained {
		t.Fatalf("result = %+v, want uncertain although the fuzzy ratio is %v", result, result.Candidates[0].Score)
	}
}

func flaggedProject(tracksIn ...tracks.Track) tracks.Project {
	project := tracks.Project{}
	for i, track := range tracksIn {
		track.Index = i
		if track.GUID == "" {
			track.GUID = "guid-" + track.Name
		}
		project.Tracks = append(project.Tracks, track)
	}
	return project
}

var suggestChapters = []Chapter{{ID: "c-1", Title: "Chapter 1"}, {ID: "c-2", Title: "Chapter 2"}, {ID: "c-3", Title: "Chapter 3"}, {ID: "c-11", Title: "Chapter 11"}}

func mustSuggest(t *testing.T, project tracks.Project, confirmed map[string]string) Suggestion {
	t.Helper()
	suggestion, err := Suggest(suggestChapters, project, confirmed)
	if err != nil {
		t.Fatal(err)
	}
	return suggestion
}

func TestSuggestReadsTheArmedTrackBeforeTheSelectedOne(t *testing.T) {
	project := flaggedProject(tracks.Track{Name: "Chapter 1", Selected: true}, tracks.Track{Name: "Chapter 11", Armed: true})
	suggestion := mustSuggest(t, project, nil)
	if suggestion.Basis != BasisArmed || suggestion.Track == nil || suggestion.Track.Name != "Chapter 11" {
		t.Fatalf("suggestion = %+v, want read from the armed Chapter 11 track", suggestion)
	}
	if suggestion.Status != StatusMatched || suggestion.Chapter.ChapterID != "c-11" {
		t.Fatalf("suggestion = %+v, want Chapter 11 (never Chapter 1)", suggestion)
	}
}

func TestSuggestFallsBackToTheSelectedTrack(t *testing.T) {
	project := flaggedProject(tracks.Track{Name: "Chapter 1", Selected: true}, tracks.Track{Name: "Chapter 11"})
	suggestion := mustSuggest(t, project, nil)
	if suggestion.Basis != BasisSelected || suggestion.Status != StatusMatched || suggestion.Chapter.ChapterID != "c-1" {
		t.Fatalf("suggestion = %+v, want Chapter 1 from the selected track", suggestion)
	}
}

func TestSuggestWithNoArmedOrSelectedTrackSuggestsNothing(t *testing.T) {
	suggestion := mustSuggest(t, flaggedProject(tracks.Track{Name: "Chapter 1"}), nil)
	if suggestion.Basis != BasisNone || suggestion.Status != StatusNone || suggestion.Chapter != nil || suggestion.Track != nil {
		t.Fatalf("suggestion = %+v, want nothing", suggestion)
	}
	if suggestion.Candidates == nil || suggestion.Warnings == nil {
		t.Fatal("candidates and warnings must be empty lists, not null, on the wire")
	}
}

func TestSuggestHonoursAConfirmedLinkOnTheArmedTrack(t *testing.T) {
	project := flaggedProject(tracks.Track{Name: "Narration", Armed: true})
	suggestion := mustSuggest(t, project, map[string]string{"guid-Narration": "c-3"})
	if suggestion.Status != StatusConfirmed || suggestion.Chapter.ChapterID != "c-3" {
		t.Fatalf("suggestion = %+v, want the confirmed Chapter 3", suggestion)
	}
}

func TestSuggestNeverGuessesOnAnUncertainArmedTrack(t *testing.T) {
	project := flaggedProject(tracks.Track{Name: "Chaptr 3 retakes", Armed: true})
	suggestion := mustSuggest(t, project, nil)
	if suggestion.Chapter != nil || (suggestion.Status != StatusUncertain && suggestion.Status != StatusNone) {
		t.Fatalf("suggestion = %+v, want no chosen chapter", suggestion)
	}
}

func TestSeveralArmedTracksAgreeingOnAChapterSuggestIt(t *testing.T) {
	project := flaggedProject(tracks.Track{Name: "Chapter 2", Armed: true}, tracks.Track{GUID: "guid-b", Name: "Chapter 2", Armed: true})
	suggestion := mustSuggest(t, project, map[string]string{"guid-b": "c-2"})
	if suggestion.Track != nil || suggestion.Status != StatusMatched || suggestion.Chapter.ChapterID != "c-2" {
		t.Fatalf("suggestion = %+v, want Chapter 2, matched (only one track is confirmed)", suggestion)
	}
}

func TestSeveralArmedTracksDisagreeingOfferEveryChapter(t *testing.T) {
	project := flaggedProject(tracks.Track{Name: "Chapter 2", Armed: true}, tracks.Track{Name: "Chapter 3", Armed: true}, tracks.Track{Name: "Room Tone", Armed: true})
	suggestion := mustSuggest(t, project, nil)
	if suggestion.Status != StatusAmbiguous || suggestion.Chapter != nil || len(suggestion.Candidates) != 2 {
		t.Fatalf("suggestion = %+v, want ambiguous between Chapter 2 and Chapter 3", suggestion)
	}
	if suggestion.Candidates[0].ChapterID != "c-2" || suggestion.Candidates[1].ChapterID != "c-3" {
		t.Fatalf("candidates = %+v, want track order", suggestion.Candidates)
	}
}

func TestSeveralArmedTracksNamingNoChapterSuggestNothing(t *testing.T) {
	project := flaggedProject(tracks.Track{Name: "Room Tone", Armed: true}, tracks.Track{Name: "Click", Armed: true})
	if suggestion := mustSuggest(t, project, nil); suggestion.Status != StatusNone || len(suggestion.Candidates) != 0 {
		t.Fatalf("suggestion = %+v, want none", suggestion)
	}
}
