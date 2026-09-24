package chaptermatch

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// The fixture's tracks: "Chapter 1", "Chapter 11", "Narration" (items in the
// "Chapter Two" and "Epilogue" regions), "Room Tone" (muted only) and an empty
// "Chapter 1 pickups".
const (
	guidChapter1  = "{A0000000-0000-4000-8000-000000000001}"
	guidChapter11 = "{A0000000-0000-4000-8000-000000000011}"
	guidNarration = "{A0000000-0000-4000-8000-000000000020}"
	guidRoomTone  = "{A0000000-0000-4000-8000-000000000030}"
)

var fixtureChapters = []Chapter{
	{ID: "c-0001", Title: "Chapter 1"},
	{ID: "c-0002", Title: "Chapter Two"},
	{ID: "c-0003", Title: "Chapter Three"},
	{ID: "c-0011", Title: "Chapter 11"},
	{ID: "c-0099", Title: "Epilogue"},
}

func fixtureProject(t *testing.T) tracks.Project {
	t.Helper()
	project, err := tracks.Parse(filepath.Join("..", "tracks", "testdata", "chapter-tracks.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	return project
}

func namedProject(names ...string) tracks.Project {
	project := tracks.Project{}
	for i, name := range names {
		project.Tracks = append(project.Tracks, tracks.Track{GUID: "guid-" + name + "-" + string(rune('a'+i)), Index: i, Name: name})
	}
	return project
}

func mustResolve(t *testing.T, chapterID string, chapters []Chapter, project tracks.Project, confirmed map[string]string) Result {
	t.Helper()
	result, err := ForChapter(chapterID, chapters, project, confirmed)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestChapter1MatchesItsOwnTrackNotChapter11OrThePickupsTrack(t *testing.T) {
	result := mustResolve(t, "c-0001", fixtureChapters, fixtureProject(t), nil)
	if result.Status != StatusMatched || result.Track == nil || result.Track.TrackGUID != guidChapter1 {
		t.Fatalf("result = %+v, want matched to the Chapter 1 track", result)
	}
	if result.Track.Score != ScoreExact || result.Track.Source != SourceTrackName || len(result.Candidates) != 1 {
		t.Fatalf("result = %+v, want one exact track-name candidate", result)
	}
	eleven := mustResolve(t, "c-0011", fixtureChapters, fixtureProject(t), nil)
	if eleven.Status != StatusMatched || eleven.Track.TrackGUID != guidChapter11 {
		t.Fatalf("Chapter 11 = %+v, want its own track", eleven)
	}
}

func TestASpelledOutHeadingMatchesADigitTrackName(t *testing.T) {
	chapters := []Chapter{{ID: "c-1", Title: "CHAPTER ONE"}, {ID: "c-2", Title: "CHAPTER TWO"}}
	result := mustResolve(t, "c-1", chapters, fixtureProject(t), nil)
	if result.Status != StatusMatched || result.Track.TrackGUID != guidChapter1 || result.Track.Score != ScoreExact {
		t.Fatalf("result = %+v, want CHAPTER ONE matched to the Chapter 1 track", result)
	}
}

func TestChapter1WithOnlyAChapter11TrackIsNeverAConfidentMatch(t *testing.T) {
	// With Chapter 11 in the manuscript, its track is Chapter 11's own.
	both := []Chapter{{ID: "c-1", Title: "Chapter 1"}, {ID: "c-11", Title: "Chapter 11"}}
	if result := mustResolve(t, "c-1", both, namedProject("Chapter 11"), nil); result.Status != StatusNone {
		t.Fatalf("result = %+v, want none", result)
	}
	// Without it, the fuzzy fallback suggests the track but never matches it.
	only := []Chapter{{ID: "c-1", Title: "Chapter 1"}}
	result := mustResolve(t, "c-1", only, namedProject("Chapter 11"), nil)
	if result.Status != StatusUncertain || result.Track != nil || len(result.Candidates) != 1 {
		t.Fatalf("result = %+v, want an uncertain suggestion and no chosen track", result)
	}
}

func TestARegionNameFindsTheTrackPlayingInsideIt(t *testing.T) {
	project := fixtureProject(t)
	result := mustResolve(t, "c-0002", fixtureChapters, project, nil)
	if result.Status != StatusMatched || result.Track.TrackGUID != guidNarration || result.Track.Source != SourceRegionName {
		t.Fatalf("result = %+v, want the Narration track through the Chapter Two region (Room Tone is muted there)", result)
	}
	want := &RegionRef{Name: "Chapter Two", Start: 28, End: 40}
	if !reflect.DeepEqual(result.Track.Region, want) {
		t.Fatalf("region = %+v, want %+v", result.Track.Region, want)
	}
	end, ok := RecordedEnd(project, *result.Track)
	if !ok || end.ProjectTime != 36 || end.SourceTime != 47 {
		t.Fatalf("recorded end = %+v, want the region's last item (36 s, source 47 s)", end)
	}
}

func TestAChapterWithNoTrackOrRegionIsNoneNeverACreatedTrack(t *testing.T) {
	project := fixtureProject(t)
	before := len(project.Tracks)
	result := mustResolve(t, "c-0003", fixtureChapters, project, nil)
	if result.Status != StatusNone || result.Track != nil || len(result.Candidates) != 0 {
		t.Fatalf("result = %+v, want none", result)
	}
	if len(project.Tracks) != before {
		t.Fatal("resolving changed the project's tracks")
	}
}

func TestTwoTracksWithTheSameNameAreAmbiguousNotAPick(t *testing.T) {
	chapters := []Chapter{{ID: "c-1", Title: "Chapter 1"}}
	result := mustResolve(t, "c-1", chapters, namedProject("Chapter 1", "Chapter 1"), nil)
	if result.Status != StatusAmbiguous || result.Track != nil || len(result.Candidates) != 2 {
		t.Fatalf("result = %+v, want ambiguous with both candidates", result)
	}
}

func TestAnExactTrackBeatsAContainedOne(t *testing.T) {
	chapters := []Chapter{{ID: "c-1", Title: "Chapter 1: The Beginning"}}
	result := mustResolve(t, "c-1", chapters, namedProject("Chapter 1", "Chapter 1 - The Beginning"), nil)
	if result.Status != StatusMatched || result.Track.TrackName != "Chapter 1 - The Beginning" {
		t.Fatalf("result = %+v, want the exact name over the prefix", result)
	}
	if len(result.Candidates) != 2 || result.Candidates[1].Score != ScoreContained {
		t.Fatalf("candidates = %+v, want both, the contained one second", result.Candidates)
	}
}

func TestAFuzzyMatchIsUncertain(t *testing.T) {
	chapters := []Chapter{{ID: "c-7", Title: "Chapter Seven: Night Falls"}, {ID: "c-x", Title: "Characters"}}
	result := mustResolve(t, "c-7", chapters, namedProject("Chaptre 7 Nightfalls"), nil)
	if result.Status != StatusUncertain || result.Track != nil || len(result.Candidates) != 1 || result.Candidates[0].Score >= ScoreContained {
		t.Fatalf("result = %+v, want an uncertain fuzzy suggestion", result)
	}
}

func TestBlankTrackNamesAreNotCandidates(t *testing.T) {
	result := mustResolve(t, "c-1", []Chapter{{ID: "c-1", Title: "Chapter 1"}}, namedProject("", "  "), nil)
	if result.Status != StatusNone {
		t.Fatalf("result = %+v, want none", result)
	}
}

func TestAConfirmedLinkWinsOverTheNameAndSurvivesARenameAndReorder(t *testing.T) {
	project := fixtureProject(t)
	// Reorder and rename: Room Tone moves first and is renamed to a name that matches no chapter ("Ch. 1 (final)" would
	// now read as a take of Chapter 1, daw-chapter-track-auto-sync PRD Phase 1).
	roomTone := project.Tracks[3]
	roomTone.Name, roomTone.Index = "Room tone (final)", 0
	reordered := tracks.Project{Path: project.Path, Regions: project.Regions, Tracks: append([]tracks.Track{roomTone}, project.Tracks[:3]...)}

	result := mustResolve(t, "c-0001", fixtureChapters, reordered, map[string]string{guidRoomTone: "c-0001"})
	if result.Status != StatusConfirmed || result.Track.TrackGUID != guidRoomTone || result.Track.Source != SourceConfirmed || result.Track.TrackIndex != 0 {
		t.Fatalf("result = %+v, want the confirmed track by GUID at its new index", result)
	}
	if !reflect.DeepEqual(result.Warnings, []Warning{WarningConfirmedTrackRenamed}) {
		t.Fatalf("warnings = %v, want the renamed flag (the name no longer matches)", result.Warnings)
	}
	// The Chapter 1 track still shows as a name candidate beside the link.
	if len(result.Candidates) != 1 || result.Candidates[0].TrackGUID != guidChapter1 {
		t.Fatalf("candidates = %+v", result.Candidates)
	}
}

func TestATrackConfirmedForAnotherChapterIsNotACandidate(t *testing.T) {
	confirmed := map[string]string{guidChapter1: "c-0003"}
	if result := mustResolve(t, "c-0001", fixtureChapters, fixtureProject(t), confirmed); result.Status != StatusNone {
		t.Fatalf("c-0001 = %+v, want none: its namesake track is linked to Chapter Three", result)
	}
	three := mustResolve(t, "c-0003", fixtureChapters, fixtureProject(t), confirmed)
	if three.Status != StatusConfirmed || three.Track.TrackGUID != guidChapter1 {
		t.Fatalf("c-0003 = %+v, want the confirmed track", three)
	}
}

func TestAConfirmedTrackThatIsGoneFallsBackToTheNameAndSaysSo(t *testing.T) {
	result := mustResolve(t, "c-0001", fixtureChapters, fixtureProject(t), map[string]string{"{GONE}": "c-0001"})
	if result.Status != StatusMatched || result.Track.TrackGUID != guidChapter1 {
		t.Fatalf("result = %+v, want the name match", result)
	}
	if !reflect.DeepEqual(result.Warnings, []Warning{WarningConfirmedTrackMissing}) {
		t.Fatalf("warnings = %v", result.Warnings)
	}
}

func TestTwoConfirmedTracksForOneChapterAreAmbiguous(t *testing.T) {
	confirmed := map[string]string{guidChapter1: "c-0001", guidChapter11: "c-0001"}
	result := mustResolve(t, "c-0001", fixtureChapters, fixtureProject(t), confirmed)
	if result.Status != StatusAmbiguous || result.Track != nil || len(result.Candidates) != 2 {
		t.Fatalf("result = %+v, want ambiguous between the two links", result)
	}
	if !reflect.DeepEqual(result.Warnings, []Warning{WarningConfirmedLinksConflict}) {
		t.Fatalf("warnings = %v", result.Warnings)
	}
}

func TestAConfirmedTrackKeepsItsRegionForTheRecordedEnd(t *testing.T) {
	project := fixtureProject(t)
	result := mustResolve(t, "c-0099", fixtureChapters, project, map[string]string{guidNarration: "c-0099"})
	if result.Status != StatusConfirmed || result.Track.Region == nil || result.Track.Region.Name != "Epilogue" {
		t.Fatalf("result = %+v, want the confirmed track with the Epilogue region", result)
	}
	end, ok := RecordedEnd(project, *result.Track)
	if !ok || end.ProjectTime != 65 {
		t.Fatalf("recorded end = %+v, want the epilogue item's end", end)
	}
	if len(result.Warnings) != 0 {
		t.Fatalf("warnings = %v, want none: the region still names the chapter", result.Warnings)
	}
}

func TestRecordedEndOfAMissingTrackIsNone(t *testing.T) {
	if end, ok := RecordedEnd(fixtureProject(t), Candidate{TrackGUID: "{GONE}"}); ok {
		t.Fatalf("end = %+v, want none", end)
	}
}

func TestAnUnknownChapterIsAnError(t *testing.T) {
	if _, err := ForChapter("c-nope", fixtureChapters, fixtureProject(t), nil); err == nil {
		t.Fatal("want an error for a chapter that is not in the list")
	}
}
