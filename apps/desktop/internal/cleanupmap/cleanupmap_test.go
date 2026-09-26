package cleanupmap

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func itemPlaying(guid, file string, length, soffs, playrate float64) tracks.Item {
	return tracks.Item{
		GUID:        guid,
		Length:      length,
		SourceFile:  file,
		SourceStart: soffs,
		PlayRate:    playrate,
		TakeGUID:    guid + "-take",
		Takes: []tracks.Take{{
			GUID: guid + "-take", SourceFile: file, SOFFS: soffs, PlayRate: playrate,
		}},
	}
}

func TestForFileFindsTheItemThatPlaysTheCutRange(t *testing.T) {
	item := itemPlaying("{item-1}", "C:/Alice/media/ch1.wav", 30, 10, 1)
	project := tracks.Project{Tracks: []tracks.Track{{GUID: "{track-1}", Items: []tracks.Item{item}}}}

	candidates, refusals := ForFile(project, "C:/Alice/media/ch1.wav", 12.5, 15.5)
	if len(refusals) != 0 {
		t.Fatalf("refusals = %#v, want none", refusals)
	}
	if len(candidates) != 1 || candidates[0] != (Candidate{TrackGUID: "{track-1}", ItemGUID: "{item-1}", TakeGUID: "{item-1}-take"}) {
		t.Fatalf("candidates = %#v, want the one item", candidates)
	}
}

func TestForFileMatchesThePathCaseInsensitively(t *testing.T) {
	item := itemPlaying("{item-1}", `C:\Alice\media\ch1.WAV`, 30, 10, 1)
	project := tracks.Project{Tracks: []tracks.Track{{Items: []tracks.Item{item}}}}

	candidates, _ := ForFile(project, `c:\alice\media\ch1.wav`, 12, 13)
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want one case-insensitive match", candidates)
	}
}

// filepath.Clean only collapses a redundant ".." segment against the OS's own separator, so this uses forward
// slashes (always a separator, on every GOOS Go builds for) rather than the Windows backslash the case test above
// uses, which this project's target OS treats as one too but this test's host OS may not.
func TestForFileMatchesThePathAfterCleaningARedundantSegment(t *testing.T) {
	item := itemPlaying("{item-1}", "C:/Alice/media/ch1.wav", 30, 10, 1)
	project := tracks.Project{Tracks: []tracks.Track{{Items: []tracks.Item{item}}}}

	candidates, _ := ForFile(project, "C:/Alice/media/../media/ch1.wav", 12, 13)
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want one match after Clean collapses the redundant segment", candidates)
	}
}

func TestForFileIgnoresAnItemPlayingADifferentFile(t *testing.T) {
	item := itemPlaying("{item-1}", "C:/Alice/media/ch2.wav", 30, 10, 1)
	project := tracks.Project{Tracks: []tracks.Track{{Items: []tracks.Item{item}}}}

	candidates, refusals := ForFile(project, "C:/Alice/media/ch1.wav", 12, 13)
	if len(candidates) != 0 || len(refusals) != 0 {
		t.Fatalf("candidates = %#v, refusals = %#v, want neither: this item was never a candidate", candidates, refusals)
	}
}

func TestForFileRefusesARangeOutsideWhatTheItemPlays(t *testing.T) {
	// Plays source 10..40 (length 30, rate 1); the cut at 45..46 is past the end.
	item := itemPlaying("{item-1}", "ch1.wav", 30, 10, 1)
	project := tracks.Project{Tracks: []tracks.Track{{GUID: "{track-1}", Items: []tracks.Item{item}}}}

	candidates, refusals := ForFile(project, "ch1.wav", 45, 46)
	if len(candidates) != 0 {
		t.Fatalf("candidates = %#v, want none", candidates)
	}
	if len(refusals) != 1 || refusals[0] != (Refusal{TrackGUID: "{track-1}", ItemGUID: "{item-1}", Reason: ReasonOutsidePlayedRange}) {
		t.Fatalf("refusals = %#v, want one outside-played-range", refusals)
	}
}

func TestForFileRefusesAStretchedOrSectionedTake(t *testing.T) {
	stretched := itemPlaying("{item-1}", "ch1.wav", 30, 10, 1)
	stretched.Takes[0].StretchMarkerCount = 1
	sectioned := itemPlaying("{item-2}", "ch1.wav", 30, 10, 1)
	sectioned.Takes[0].Section = &tracks.SectionOffsets{StartPos: 5}

	project := tracks.Project{Tracks: []tracks.Track{{GUID: "{track-1}", Items: []tracks.Item{stretched, sectioned}}}}

	candidates, refusals := ForFile(project, "ch1.wav", 12, 13)
	if len(candidates) != 0 {
		t.Fatalf("candidates = %#v, want none: both takes are unreliable to map", candidates)
	}
	if len(refusals) != 2 || refusals[0].Reason != ReasonUnreliableMapping || refusals[1].Reason != ReasonUnreliableMapping {
		t.Fatalf("refusals = %#v, want two unreliable-mapping", refusals)
	}
}

func TestForFileFindsEveryItemThatPlaysTheFile(t *testing.T) {
	first := itemPlaying("{item-1}", "ch1.wav", 30, 10, 1)
	second := itemPlaying("{item-2}", "ch1.wav", 20, 10, 1)
	project := tracks.Project{Tracks: []tracks.Track{{GUID: "{track-1}", Items: []tracks.Item{first, second}}}}

	candidates, _ := ForFile(project, "ch1.wav", 12, 13)
	if len(candidates) != 2 {
		t.Fatalf("candidates = %#v, want both items that play the file", candidates)
	}
}
