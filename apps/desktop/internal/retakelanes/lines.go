// Package retakelanes is the host's end of "retakes as fixed lanes" (reaper-automation-follow-through PRD Phase 25,
// ADR 0147, spike S7): it lists the retakes of each manuscript line that sit on fixed item lanes, from the saved
// project the static reader parses, and asks REAPER over the file bridge (pick_retake_lane in
// integrations/reaper/narration_retake_lanes.lua) to make the narrator's pick the only lane playing.
//
// The app changes one thing, only when the narrator asks: the retake's track lane play state. It never turns lanes on
// or off, never converts takes and lanes, and never builds comps. A retake is named by line id plus item GUID,
// because on a lane track every retake of a line carries the same line id.
package retakelanes

import (
	"sort"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// LineIDKey is the item extension key that names an item's manuscript line (ADR 0026).
const LineIDKey = "narration_utils_line_id"

// Retake is one item of a line on a fixed lane.
type Retake struct {
	ItemGUID string  `json:"itemGuid"`
	Name     string  `json:"name"`
	Lane     int     `json:"lane"`
	Plays    bool    `json:"plays"`
	Position float64 `json:"position"`
	Length   float64 `json:"length"`
}

// Line is every retake of one manuscript line on one lane track, in lane order.
type Line struct {
	LineID    string   `json:"lineId"`
	TrackGUID string   `json:"trackGuid"`
	TrackName string   `json:"trackName"`
	Retakes   []Retake `json:"retakes"`
}

// List is what the RetakeLanesList binding answers: the lines with a choice to make, and how many tracks are in
// fixed-lane mode at all (so the UI can tell "no lane tracks" from "no line has more than one retake").
type List struct {
	Lines      []Line `json:"lines"`
	LaneTracks int    `json:"laneTracks"`
}

// Lines groups the saved project's lane-track items by line id. A line is listed when its items on one lane track sit
// on at least two different lanes (items that share one lane play or stay silent together, so they are no choice);
// an item with no line id cannot be named, so it is left out, and so is every track not in fixed-lane mode. Lines come in track order, then by their first retake's position.
func Lines(project tracks.Project) List {
	list := List{Lines: []Line{}}
	for _, track := range project.Tracks {
		if !track.FixedLanes {
			continue
		}
		list.LaneTracks++
		list.Lines = append(list.Lines, trackLines(track)...)
	}
	return list
}

func trackLines(track tracks.Track) []Line {
	byLine := map[string]*Line{}
	var order []string
	for _, item := range track.Items {
		lineID := item.Ext[LineIDKey]
		if lineID == "" || item.GUID == "" {
			continue
		}
		line, seen := byLine[lineID]
		if !seen {
			line = &Line{LineID: lineID, TrackGUID: track.GUID, TrackName: track.Name}
			byLine[lineID] = line
			order = append(order, lineID)
		}
		line.Retakes = append(line.Retakes, Retake{
			ItemGUID: item.GUID,
			Name:     item.Name,
			Lane:     item.Lane,
			Plays:    track.LanePlays(item.Lane),
			Position: item.Position,
			Length:   item.Length,
		})
	}
	var lines []Line
	for _, lineID := range order {
		line := *byLine[lineID]
		if distinctLanes(line.Retakes) < 2 {
			continue
		}
		sort.SliceStable(line.Retakes, func(a, b int) bool { return line.Retakes[a].Lane < line.Retakes[b].Lane })
		lines = append(lines, line)
	}
	sort.SliceStable(lines, func(a, b int) bool { return firstPosition(lines[a]) < firstPosition(lines[b]) })
	return lines
}

func distinctLanes(retakes []Retake) int {
	lanes := map[int]bool{}
	for _, retake := range retakes {
		lanes[retake.Lane] = true
	}
	return len(lanes)
}

func firstPosition(line Line) float64 {
	first := line.Retakes[0].Position
	for _, retake := range line.Retakes {
		if retake.Position < first {
			first = retake.Position
		}
	}
	return first
}

// Find answers the listed retake named by line id and item GUID, with its line, or false when the saved project has
// no such retake on a lane track.
func (list List) Find(lineID, itemGUID string) (Line, Retake, bool) {
	for _, line := range list.Lines {
		if line.LineID != lineID {
			continue
		}
		for _, retake := range line.Retakes {
			if retake.ItemGUID == itemGUID {
				return line, retake, true
			}
		}
	}
	return Line{}, Retake{}, false
}
