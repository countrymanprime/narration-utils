package tracks

import (
	"math"
	"testing"
)

func secondsItem(position, length float64) Item { return Item{Position: position, Length: length} }

func TestRecordedSecondsMergesOverlappingItemsAndSkipsMutedOnes(t *testing.T) {
	muted := secondsItem(40, 10)
	muted.Muted = true
	track := Track{Items: []Item{secondsItem(0, 10), secondsItem(5, 10), secondsItem(20, 5), secondsItem(25, 5), muted}}
	// 0-15 (two overlapping takes) + 20-30 (two touching items); the muted item counts for nothing.
	if got := track.RecordedSeconds(); got != 25 {
		t.Fatalf("RecordedSeconds = %v, want 25", got)
	}
}

func TestRecordedSecondsOfAnEmptyTrackIsZero(t *testing.T) {
	if got := (Track{}).RecordedSeconds(); got != 0 {
		t.Fatalf("RecordedSeconds = %v, want 0", got)
	}
}

func TestRecordedSecondsIsProjectTimeWhateverThePlayRate(t *testing.T) {
	item := secondsItem(0, 10)
	item.Takes = []Take{{PlayRate: 1.5, SOFFS: 2}}
	if got := (Track{Items: []Item{item}}).RecordedSeconds(); got != 10 {
		t.Fatalf("RecordedSeconds = %v, want the item's 10 s in the project", got)
	}
}

func TestRecordedSecondsCountsOnlyPlayingLanesOfAFixedLaneTrack(t *testing.T) {
	silent := secondsItem(0, 30)
	playing := secondsItem(0, 12)
	playing.Lane = 1
	track := Track{FixedLanes: true, LaneCount: 2, PlayingLanes: []int{1}, Items: []Item{silent, playing}}
	if got := track.RecordedSeconds(); got != 12 {
		t.Fatalf("RecordedSeconds = %v, want only lane 1's 12 s", got)
	}
}

// Track B of the REAPER-saved fixed-lane fixture (spike S7): three retakes of one line at 0 to 3 s on lanes 0, 1 and
// 2, only lane 2 playing, so the retakes count once and never three times.
func TestRecordedSecondsOnAREAPERSavedFixedLaneTrack(t *testing.T) {
	track := trackNamed(t, parseReaperFixture(t, "fixed-lanes.rpp"), "B - retakes on lanes")
	want := 0.0
	for _, item := range track.Items {
		if !item.Muted && track.LanePlays(item.Lane) && item.Position == 0 {
			want = item.Length
		}
	}
	got := track.RecordedSeconds()
	if want != 3 || math.Abs(got-want) > 1e-9 {
		t.Fatalf("RecordedSeconds = %v, want the playing retake's %v s", got, want)
	}
}
