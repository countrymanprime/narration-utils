package tracks

import (
	"testing"
)

// testdata/reaper/fixed-lanes.rpp was written by REAPER 7.80 during spike S7 (docs/research/reaper-spike-s7-fixed-lanes.md).
// The parser does not model fixed item lanes yet: a lane is only the item's YPOS line and the track's ITEMLANES,
// LANESOLO and LINKEDLANE lines, none of which it reads. These tests pin that it still parses such a project, and
// what it sees, so the phase that teaches it lanes changes them on purpose.

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

// Track B holds three retakes of one line on lanes 0, 1 and 2, only lane 2 playing (LANESOLO 4). The parser reports
// them as three overlapping items at the same position and cannot tell which one REAPER plays.
func TestTheParserSeesRetakesOnLanesAsOverlappingItems(t *testing.T) {
	track := trackNamed(t, parseReaperFixture(t, "fixed-lanes.rpp"), "B - retakes on lanes")

	var retakes []Item
	for _, item := range track.Items {
		if item.Ext[lineIDKey] == "line-000004" {
			retakes = append(retakes, item)
		}
	}
	if len(retakes) != 3 {
		t.Fatalf("items stamped line-000004 = %d, want the three retakes", len(retakes))
	}
	for _, item := range retakes {
		if item.Position != 0 || item.Length != 3 || !item.SourceAvailable {
			t.Errorf("retake %q: position %v length %v available %v, want 0, 3, true", item.Name, item.Position, item.Length, item.SourceAvailable)
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
