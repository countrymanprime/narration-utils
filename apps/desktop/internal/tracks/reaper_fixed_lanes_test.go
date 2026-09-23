package tracks

import (
	"testing"
)

// testdata/reaper/fixed-lanes.rpp was written by REAPER 7.80 during spike S7 (docs/research/reaper-spike-s7-fixed-lanes.md).
// A lane is only the item's YPOS line and the track's FREEMODE, ITEMLANES and LANESOLO lines. Phase 25 of the reaper
// automation follow-through PRD (ADR 0147) taught the parser to read them, so retakes on lanes are no longer seen as
// overlapping items; LINKEDLANE (comp areas) and LANENAME are still not read.

const lineIDKey = "narration_utils_line_id"

func TestAFixedLaneProjectParsesEveryTrack(t *testing.T) {
	project := parseReaperFixture(t, "fixed-lanes.rpp")

	want := []string{
		"A - enable by API", "A2 - overlapping then lanes", "A3 - one item, action", "A4 - overlapping, action",
		"A5 - API enable plus I_NUMFIXEDLANES=1", "B - retakes on lanes", "E1 - takes, then I_FREEMODE=2",
		"E2 - takes, then convert to lanes", "E3 - takes, then explode to lanes", "E4 - candidate active, then convert",
		"E5 - lanes, lane 1 plays, convert to takes", "F - comp", "F2 - comp kept", "G - lanes off by API",
	}
	got := trackNames(project)
	if len(got) != len(want) {
		t.Fatalf("tracks = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("tracks = %v, want %v", got, want)
		}
	}
}

// Track B holds three retakes of one line on lanes 0, 1 and 2 of a 7-lane track, only lane 2 playing (LANESOLO 4),
// plus a fourth item (another line) on lane 0. The parser now places each retake on its own lane and knows which
// one REAPER plays.
func TestTheParserPlacesRetakesOnTheirLanesAndKnowsWhichLanePlays(t *testing.T) {
	track := trackNamed(t, parseReaperFixture(t, "fixed-lanes.rpp"), "B - retakes on lanes")

	if !track.FixedLanes || track.LaneCount != 7 {
		t.Fatalf("fixed lanes = %v, lane count = %d; want true, 7", track.FixedLanes, track.LaneCount)
	}
	if got := track.PlayingLanes; len(got) != 1 || got[0] != 2 {
		t.Fatalf("playing lanes = %v, want [2]", got)
	}
	var lanes []int
	for _, item := range track.Items {
		if item.Ext[lineIDKey] != "line-000004" {
			continue
		}
		if item.Position != 0 || item.Length != 3 || !item.SourceAvailable {
			t.Errorf("retake %q: position %v length %v available %v, want 0, 3, true", item.Name, item.Position, item.Length, item.SourceAvailable)
		}
		lanes = append(lanes, item.Lane)
		if want := item.Lane == 2; track.LanePlays(item.Lane) != want {
			t.Errorf("retake %q on lane %d plays = %v, want %v", item.Name, item.Lane, !want, want)
		}
	}
	if len(lanes) != 3 || lanes[0] != 0 || lanes[1] != 1 || lanes[2] != 2 {
		t.Fatalf("retake lanes = %v, want [0 1 2]", lanes)
	}
}

// Lanes turned on by the API alone write ITEMLANES 1 with items at half the track height (YPOS 0 0.5 2), and REAPER
// reopens that as two lanes (ITEMLANES 2 after a re-save). Either way every item is on lane 0, and with no LANESOLO
// line every lane plays.
func TestLanesTurnedOnByTheAPIAloneKeepEveryItemOnLaneZeroBeforeAndAfterAResave(t *testing.T) {
	for _, fixture := range []struct {
		file  string
		lanes int
	}{{"fixed-lanes.rpp", 1}, {"fixed-lanes-resaved.rpp", 2}} {
		track := trackNamed(t, parseReaperFixture(t, fixture.file), "A2 - overlapping then lanes")
		if !track.FixedLanes || track.LaneCount != fixture.lanes {
			t.Fatalf("%s: fixed lanes = %v, lane count = %d; want true, %d", fixture.file, track.FixedLanes, track.LaneCount, fixture.lanes)
		}
		if len(track.PlayingLanes) != fixture.lanes {
			t.Errorf("%s: playing lanes = %v, want every lane", fixture.file, track.PlayingLanes)
		}
		for _, item := range track.Items {
			if item.Lane != 0 || !track.LanePlays(item.Lane) {
				t.Errorf("%s: item %q lane %d plays %v, want lane 0 playing", fixture.file, item.Name, item.Lane, track.LanePlays(item.Lane))
			}
		}
	}
}

// LANESOLO is a bitmask over several 32-bit words. E3 (takes exploded to two lanes) wrote 4294967293, every bit but
// bit 1, then all-ones words: of its two lanes only lane 0 plays, the lane REAPER plays after a conversion.
func TestLaneSoloIsABitmaskAndLanesPastTheTrackAreIgnored(t *testing.T) {
	track := trackNamed(t, parseReaperFixture(t, "fixed-lanes.rpp"), "E3 - takes, then explode to lanes")

	if track.LaneCount != 2 || len(track.PlayingLanes) != 1 || track.PlayingLanes[0] != 0 {
		t.Fatalf("lane count = %d, playing = %v; want 2 lanes, [0]", track.LaneCount, track.PlayingLanes)
	}
	if track.Items[0].Lane != 0 || track.Items[1].Lane != 1 {
		t.Fatalf("lanes = %d, %d; want 0, 1", track.Items[0].Lane, track.Items[1].Lane)
	}
	if track.LanePlays(5) || track.LanePlays(-1) {
		t.Fatalf("a lane outside the track must not play")
	}
}

// A track that is not in fixed-lane mode has no lanes to choose, even when a LANESOLO line survived a conversion
// back (E2 has no FREEMODE line, and its one item reads YPOS 0 1 0): every item is on lane 0 and no lane is listed.
func TestATrackWithoutFixedLaneModeHasNoLanes(t *testing.T) {
	project := parseReaperFixture(t, "fixed-lanes.rpp")
	for _, name := range []string{"E2 - takes, then convert to lanes", "E5 - lanes, lane 1 plays, convert to takes"} {
		track := trackNamed(t, project, name)
		if track.FixedLanes || track.LaneCount != 0 || track.PlayingLanes != nil {
			t.Errorf("%s: fixed lanes = %v, count = %d, playing = %v; want false, 0, nil", name, track.FixedLanes, track.LaneCount, track.PlayingLanes)
		}
		for _, item := range track.Items {
			if item.Lane != 0 {
				t.Errorf("%s: item %q lane = %d, want 0", name, item.Name, item.Lane)
			}
		}
	}
	legacy, err := Parse("testdata/basic.rpp")
	if err != nil {
		t.Fatal(err)
	}
	for _, track := range legacy.Tracks {
		if track.FixedLanes || track.LaneCount != 0 || track.LanePlays(0) {
			t.Errorf("basic.rpp %q reads as a lane track", track.Name)
		}
	}
}

// E5 had three retakes on lanes with lane 1 playing, then REAPER's "convert fixed lanes to takes": one item, three
// takes, the playing lane's take active, and every take's own extension data kept.
func TestConvertingLanesToTakesKeepsThePlayingLaneActiveAndTheTakeProvenance(t *testing.T) {
	track := trackNamed(t, parseReaperFixture(t, "fixed-lanes.rpp"), "E5 - lanes, lane 1 plays, convert to takes")

	if len(track.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(track.Items))
	}
	item := track.Items[0]
	if len(item.Takes) != 3 || item.ActiveTake != 1 || item.Name != "retake 2" {
		t.Fatalf("takes = %d, active = %d (%q), want 3 takes with retake 2 active", len(item.Takes), item.ActiveTake, item.Name)
	}
	if item.Ext[lineIDKey] != "line-000009" {
		t.Errorf("item line id = %q, want line-000009", item.Ext[lineIDKey])
	}
	for index, take := range item.Takes {
		want := []string{"finding-e5-0", "finding-e5-1", "finding-e5-2"}[index]
		if take.Ext["narration_utils_take_finding_id"] != want {
			t.Errorf("take %d finding = %q, want %q", index, take.Ext["narration_utils_take_finding_id"], want)
		}
	}
}

// F2's comp lane holds a copy of retake 3 made by "Add comp areas for selected items": a new item (its own GUID) that
// carries the source item's line id, so a line id no longer names one item on a comped track.
func TestACompAreaCopyCarriesTheLineIDOfItsSource(t *testing.T) {
	track := trackNamed(t, parseReaperFixture(t, "fixed-lanes.rpp"), "F2 - comp kept")

	if len(track.Items) != 4 {
		t.Fatalf("items = %d, want three retakes and one comp copy", len(track.Items))
	}
	guids := map[string]bool{}
	named := 0
	for _, item := range track.Items {
		guids[item.GUID] = true
		if item.Ext[lineIDKey] != "line-000010" {
			t.Errorf("item %q line id = %q, want line-000010", item.Name, item.Ext[lineIDKey])
		}
		if item.Name == "retake 3" {
			named++
		}
	}
	if len(guids) != 4 || named != 2 {
		t.Fatalf("distinct GUIDs = %d, items named retake 3 = %d; want 4 and 2", len(guids), named)
	}
	// The comp lane "C1" was inserted at the top: the copy is on lane 0, the only lane playing (LANESOLO 1), and
	// the three retakes moved down to lanes 1 to 3.
	lanes := map[int]string{}
	for _, item := range track.Items {
		lanes[item.Lane] = item.GUID
	}
	if len(lanes) != 4 || len(track.PlayingLanes) != 1 || track.PlayingLanes[0] != 0 {
		t.Fatalf("lanes = %v, playing = %v; want four lanes, [0]", lanes, track.PlayingLanes)
	}
}

func TestAResavedFixedLaneProjectKeepsItsTracksAndItems(t *testing.T) {
	first := parseReaperFixture(t, "fixed-lanes.rpp")
	second := parseReaperFixture(t, "fixed-lanes-resaved.rpp")

	if len(first.Tracks) != len(second.Tracks) {
		t.Fatalf("track counts differ: %d vs %d", len(first.Tracks), len(second.Tracks))
	}
	for index := range first.Tracks {
		if len(first.Tracks[index].Items) != len(second.Tracks[index].Items) {
			t.Errorf("track %q: %d items, %d after a re-save", first.Tracks[index].Name, len(first.Tracks[index].Items), len(second.Tracks[index].Items))
		}
	}
}
