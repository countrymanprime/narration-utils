package retakelanes

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// fixture parses a project REAPER 7.80 wrote during spike S7 (apps/desktop/internal/tracks/testdata/reaper/README.md).
func fixture(t *testing.T, name string) tracks.Project {
	t.Helper()
	project, err := tracks.Parse(filepath.Join("..", "tracks", "testdata", "reaper", name))
	if err != nil {
		t.Fatal(err)
	}
	return project
}

func summary(list List) []string {
	var out []string
	for _, line := range list.Lines {
		var retakes []string
		for _, retake := range line.Retakes {
			plays := ""
			if retake.Plays {
				plays = "*"
			}
			retakes = append(retakes, fmt.Sprintf("%d%s %s", retake.Lane, plays, retake.Name))
		}
		out = append(out, fmt.Sprintf("%s %s: %s", line.TrackName, line.LineID, strings.Join(retakes, ", ")))
	}
	return out
}

func TestTheSpikeProjectListsEveryLineWithRetakesOnSeveralLanes(t *testing.T) {
	list := Lines(fixture(t, "fixed-lanes.rpp"))

	want := []string{
		"B - retakes on lanes line-000004: 0 retake 1, 1 retake 2, 2* retake 3",
		"E3 - takes, then explode to lanes line-000006: 0* target (active), 1 candidate",
		"E4 - candidate active, then convert line-000006: 0* target (active), 1 candidate",
		// The comp lane "C1" is lane 0: its copy of a retake plays, and the retakes moved down one lane.
		"F - comp line-000007: 0* retake 2, 1 retake 1, 2 retake 2, 3 retake 3",
		"F2 - comp kept line-000010: 0* retake 3, 1 retake 1, 2 retake 2, 3 retake 3",
		// G's lanes were turned off by the API and the run undid it, so the saved file has them on again.
		"G - lanes off by API line-000008: 0 retake 1, 1* retake 2, 2 retake 3",
	}
	got := summary(list)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("lines =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if list.LaneTracks != 12 {
		t.Fatalf("lane tracks = %d, want 12 (every track but E2 and E5)", list.LaneTracks)
	}
}

// A2 has two overlapping reads of one line, both on lane 0 after lanes were turned on: they play together, so there
// is nothing to choose between them.
func TestItemsOfALineThatShareOneLaneAreNoChoice(t *testing.T) {
	for _, line := range Lines(fixture(t, "fixed-lanes.rpp")).Lines {
		if strings.HasPrefix(line.TrackName, "A") {
			t.Fatalf("listed %s %s", line.TrackName, line.LineID)
		}
	}
}

func TestAProjectWithoutLaneTracksListsNothing(t *testing.T) {
	project, err := tracks.Parse(filepath.Join("..", "tracks", "testdata", "basic.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	list := Lines(project)
	if len(list.Lines) != 0 || list.LaneTracks != 0 || list.Lines == nil {
		t.Fatalf("list = %#v, want an empty, non-nil list and no lane tracks", list)
	}
}

func TestLinesSkipItemsWithoutALineIDAndOrderByPosition(t *testing.T) {
	item := func(guid, line string, lane int, position float64) tracks.Item {
		ext := map[string]string{}
		if line != "" {
			ext[LineIDKey] = line
		}
		return tracks.Item{GUID: guid, Name: guid, Lane: lane, Position: position, Ext: ext}
	}
	project := tracks.Project{Tracks: []tracks.Track{{
		GUID: "{T}", Name: "Narration", FixedLanes: true, LaneCount: 2, PlayingLanes: []int{0, 1},
		Items: []tracks.Item{
			item("late-0", "line-2", 1, 9), item("late-1", "line-2", 0, 9),
			item("early-0", "line-1", 1, 1), item("early-1", "line-1", 0, 1),
			item("unnamed", "", 1, 1), item("", "line-1", 1, 1),
		},
	}}}
	got := summary(Lines(project))
	want := []string{"Narration line-1: 0* early-1, 1* early-0", "Narration line-2: 0* late-1, 1* late-0"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("lines = %v, want %v", got, want)
	}
}

func TestFindNamesARetakeByLineIDAndItemGUID(t *testing.T) {
	list := Lines(fixture(t, "fixed-lanes.rpp"))
	b := list.Lines[0]
	line, retake, ok := list.Find("line-000004", b.Retakes[1].ItemGUID)
	if !ok || line.TrackName != "B - retakes on lanes" || retake.Lane != 1 {
		t.Fatalf("find = %v %v %v", ok, line.TrackName, retake)
	}
	// The comp copy on F2 shares the line id of F's items: a GUID from one track never matches the other's line.
	f2 := list.Lines[4]
	if _, _, ok := list.Find("line-000004", f2.Retakes[0].ItemGUID); ok {
		t.Fatal("a GUID matched under another line id")
	}
	if _, _, ok := list.Find("line-000004", "{00000000-0000-0000-0000-000000000000}"); ok {
		t.Fatal("an unknown GUID matched")
	}
}
