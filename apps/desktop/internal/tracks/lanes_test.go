package tracks

import (
	"reflect"
	"testing"
)

func laneTrack(t *testing.T, lines string) Track {
	t.Helper()
	root := parseChunks("<REAPER_PROJECT\n<TRACK\n" + lines + "\n>\n>\n")
	return parseTrack(root.firstChild("REAPER_PROJECT").firstChild("TRACK"), 0, t.TempDir())
}

func TestLaneSoloReadsLanesBeyondTheFirstWord(t *testing.T) {
	// Lane 33 is bit 1 of the second word.
	track := laneTrack(t, "FREEMODE 2\nITEMLANES 40\nLANESOLO 0 2 0 0 0 0 0 0")
	if !reflect.DeepEqual(track.PlayingLanes, []int{33}) {
		t.Fatalf("playing = %v, want [33]", track.PlayingLanes)
	}
}

func TestAnUnreadableLaneSoloWordPlaysNothingAndABadLaneCountIsOneLane(t *testing.T) {
	track := laneTrack(t, "FREEMODE 2\nITEMLANES nope\nLANESOLO x")
	if track.LaneCount != 1 || track.PlayingLanes != nil {
		t.Fatalf("count = %d, playing = %v; want 1, none", track.LaneCount, track.PlayingLanes)
	}
}

func TestFreeItemPositioningIsNotFixedLanes(t *testing.T) {
	track := laneTrack(t, "FREEMODE 1\nITEMLANES 3\n<ITEM\nPOSITION 0\nYPOS 0.5 0.25 0\n>")
	if track.FixedLanes || track.Items[0].Lane != 0 {
		t.Fatalf("free positioning read as lanes: %+v", track)
	}
}

func TestAnItemLaneIsClampedToTheTrack(t *testing.T) {
	track := laneTrack(t, "FREEMODE 2\nITEMLANES 2\n<ITEM\nYPOS 1.5 0.5 2\n>\n<ITEM\nYPOS -0.5 0.5 2\n>\n<ITEM\n>\n<ITEM\nYPOS 0.5 0.5 2\n>")
	var lanes []int
	for _, item := range track.Items {
		lanes = append(lanes, item.Lane)
	}
	if !reflect.DeepEqual(lanes, []int{1, 0, 0, 1}) {
		t.Fatalf("lanes = %v, want [1 0 0 1]", lanes)
	}
}
