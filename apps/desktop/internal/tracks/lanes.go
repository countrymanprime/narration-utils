package tracks

import (
	"math"
	"strconv"
)

// Fixed item lanes, as REAPER 7.80 saves them (spike S7, docs/research/reaper-spike-s7-fixed-lanes.md; ADR 0147).
// The track carries FREEMODE 2 (fixed lanes; 1 is free item positioning, which also writes YPOS), ITEMLANES <count>
// and, once a lane has been silenced, LANESOLO <word> <word> ...: a bitmask over 32-bit words, bit N set when lane N
// plays. An item carries no lane number, only YPOS <top> <height> <flag>, its top and height as fractions of the
// track height (YPOS 0.5 0.25 2 is lane 2 of 4).

// fixedLaneMode is the FREEMODE value of a track in fixed item lane mode.
const fixedLaneMode = "2"

// laneSoloWordBits is the width of one LANESOLO word.
const laneSoloWordBits = 32

type trackLanes struct {
	fixed   bool
	count   int
	playing []int
}

// parseLanes reads a track's lane mode, lane count and playing lanes. A track not in fixed-lane mode reads as no
// lanes at all, whatever other lane lines it kept (a track converted back to takes keeps its LANESOLO line).
func parseLanes(track *node) trackLanes {
	if track.attr0("FREEMODE") != fixedLaneMode {
		return trackLanes{}
	}
	count, err := strconv.Atoi(track.attr0("ITEMLANES"))
	if err != nil || count < 1 {
		count = 1
	}
	lanes := trackLanes{fixed: true, count: count}
	words, hasSolo := track.attrs["LANESOLO"]
	for lane := 0; lane < count; lane++ {
		if !hasSolo || laneBitSet(words, lane) {
			lanes.playing = append(lanes.playing, lane)
		}
	}
	return lanes
}

// laneBitSet reads bit lane of the LANESOLO words. A word that is missing or does not parse reads as not playing.
func laneBitSet(words []string, lane int) bool {
	index := lane / laneSoloWordBits
	if index >= len(words) {
		return false
	}
	word, err := strconv.ParseUint(words[index], 10, laneSoloWordBits)
	if err != nil {
		return false
	}
	return word&(1<<uint(lane%laneSoloWordBits)) != 0
}

// itemLane converts an item's YPOS top fraction to its lane on a track of count lanes, clamped to the track: lanes
// have equal height, so the top of lane N is N/count. A missing or unreadable YPOS is the top lane.
func itemLane(item *node, count int) int {
	top, err := strconv.ParseFloat(item.attr0("YPOS"), 64)
	if err != nil || count < 1 {
		return 0
	}
	lane := int(math.Round(top * float64(count)))
	if lane < 0 {
		return 0
	}
	if lane >= count {
		return count - 1
	}
	return lane
}
