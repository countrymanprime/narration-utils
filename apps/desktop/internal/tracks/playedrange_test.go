package tracks

import (
	"path/filepath"
	"testing"
)

// itemAt finds the item that starts at position on the track.
func itemAt(t *testing.T, track Track, position float64) Item {
	t.Helper()
	for _, item := range track.Items {
		if near(item.Position, position) {
			return item
		}
	}
	t.Fatalf("no item at %v on %q", position, track.Name)
	return Item{}
}

// The edit and proof workspace PRD Phase 1: TracksList sends where each item's
// active take starts in its source and how fast it plays, so a player can play
// the item's played range instead of its whole file from 0.
func TestAnItemSaysWhereItsActiveTakeStartsInTheSourceAndItsRate(t *testing.T) {
	project := parseChapterTracks(t)
	cases := []struct {
		name        string
		track       string
		position    float64
		takeGUID    string
		sourceStart float64
		playRate    float64
	}{
		{"SOFFS and PLAYRATE", "Chapter 1", 12, "{C0000000-0000-4000-8000-000000000002}", 2, 1.5},
		{"no PLAYRATE line plays at rate 1, active second take", "Chapter 11", 0, "{C0000000-0000-4000-8000-000000000012}", 3, 1},
		{"a section's start is added to SOFFS", "Narration", 30, "", 41, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := itemAt(t, trackNamed(t, project, tc.track), tc.position)
			if tc.takeGUID != "" && item.TakeGUID != tc.takeGUID {
				t.Fatalf("takeGuid = %q, want %q", item.TakeGUID, tc.takeGUID)
			}
			if item.TakeGUID != item.Active().GUID {
				t.Fatalf("takeGuid = %q, want the active take's %q", item.TakeGUID, item.Active().GUID)
			}
			if !near(item.SourceStart, tc.sourceStart) || !near(item.PlayRate, tc.playRate) {
				t.Fatalf("item = %+v, want source start %v at rate %v", item, tc.sourceStart, tc.playRate)
			}
		})
	}
}

func TestTheREAPERSavedSectionAndRateItemsSayTheirPlayedRange(t *testing.T) {
	project, err := Parse(filepath.Join("testdata", "reaper", "saved-cases.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	section := trackNamed(t, project, "Section").Items[0]
	if !near(section.SourceStart, 0.5) || !near(section.PlayRate, 1) {
		t.Fatalf("section = %+v, want source start 0.5 (SECTION STARTPOS 0.5 + SOFFS 0) at rate 1", section)
	}
	rate := trackNamed(t, project, "Rate and stretch").Items[0]
	if !near(rate.SourceStart, 0.5) || !near(rate.PlayRate, 1.25) {
		t.Fatalf("rate = %+v, want source start 0.5 at rate 1.25", rate)
	}
}

func TestAZeroOrMissingRateReadsAsREAPERsDefaultOfOne(t *testing.T) {
	for _, rate := range []float64{0, -1} {
		if got := (Take{PlayRate: rate}).Rate(); got != 1 {
			t.Fatalf("Rate() of PLAYRATE %v = %v, want 1", rate, got)
		}
	}
	if got := (Take{PlayRate: 0.75}).Rate(); got != 0.75 {
		t.Fatalf("Rate() = %v, want 0.75", got)
	}
}
