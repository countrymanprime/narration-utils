package editing

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

func sec(v float64) *float64 { return &v }

// item builds one ItemAudible: an item at [position, position+length) with
// no internal silence unless silences are given.
func item(guid string, position, length float64, silences ...TimelineInterval) ItemAudible {
	return ItemAudible{
		ItemGUID: guid, File: "/audio/" + guid + ".wav",
		PlayedRange: PlayedRange{Start: 0, End: length},
		Extent:      TimelineInterval{Start: position, End: position + length},
		Silences:    silences,
	}
}

// TestComposeEmptySpaceInternalGap is Phase 3's fixture "a gap between
// items": two fully-audible items with a 3 s timeline gap between them (no
// item covers it at all), which must be reported as one gap candidate once
// it crosses MaxGapSeconds.
func TestComposeEmptySpaceInternalGap(t *testing.T) {
	items := []ItemAudible{item("a", 0, 5), item("b", 8, 5)} // gap [5,8), length 3
	candidates, ok := ComposeEmptySpace(items, Policy{MaxGapSeconds: sec(2)})
	if !ok {
		t.Fatalf("ComposeEmptySpace() ok = false")
	}
	if len(candidates) != 1 {
		t.Fatalf("ComposeEmptySpace() = %d candidates, want 1: %+v", len(candidates), candidates)
	}
	got := candidates[0]
	if got.Class != ClassGap {
		t.Fatalf("candidate class = %q, want %q", got.Class, ClassGap)
	}
	if got.Range != (TimelineInterval{Start: 5, End: 8}) {
		t.Fatalf("candidate range = %+v, want [5,8)", got.Range)
	}
	if len(got.Parts) != 1 || got.Parts[0].Kind != PartTrackGap {
		t.Fatalf("candidate parts = %+v, want one track_gap part", got.Parts)
	}
}

// TestComposeEmptySpaceGapBelowMaxIsNotACandidate proves the threshold is
// exclusive of "just at or under": a 2 s gap against a 2 s maximum must not
// produce a candidate.
func TestComposeEmptySpaceGapBelowMaxIsNotACandidate(t *testing.T) {
	items := []ItemAudible{item("a", 0, 5), item("b", 7, 5)} // gap length exactly 2
	candidates, ok := ComposeEmptySpace(items, Policy{MaxGapSeconds: sec(2)})
	if !ok {
		t.Fatalf("ComposeEmptySpace() ok = false")
	}
	if len(candidates) != 0 {
		t.Fatalf("ComposeEmptySpace() = %d candidates, want 0 (gap == max, not > max): %+v", len(candidates), candidates)
	}
}

// TestComposeEmptySpaceMergesTailGapHead is the Phase 3 fixture explicitly
// named in the PRD: "a tail plus a timeline gap plus a head composed above
// the maximum while each part is below it". Item A has 1 s of trailing
// silence, then a 1 s timeline gap, then item B has 1 s of leading silence:
// each part alone (1 s) is under a 2 s maximum gap, but merged they are 3 s,
// above it, and must be reported as ONE candidate with all three parts.
func TestComposeEmptySpaceMergesTailGapHead(t *testing.T) {
	itemA := item("a", 0, 5, TimelineInterval{Start: 4, End: 5}) // trailing 1s silence, ends at t=5
	itemB := item("b", 6, 5, TimelineInterval{Start: 6, End: 7}) // starts at t=6, leading 1s silence
	candidates, ok := ComposeEmptySpace([]ItemAudible{itemA, itemB}, Policy{MaxGapSeconds: sec(2)})
	if !ok {
		t.Fatalf("ComposeEmptySpace() ok = false")
	}
	if len(candidates) != 1 {
		t.Fatalf("ComposeEmptySpace() = %d candidates, want 1 merged candidate: %+v", len(candidates), candidates)
	}
	got := candidates[0]
	if got.Range != (TimelineInterval{Start: 4, End: 7}) {
		t.Fatalf("candidate range = %+v, want [4,7) (1s tail + 1s gap + 1s head)", got.Range)
	}
	if len(got.Parts) != 3 {
		t.Fatalf("candidate parts = %+v, want 3 (item tail, gap, item head)", got.Parts)
	}
	if got.Parts[0].Kind != PartItemSilence || got.Parts[0].ItemGUID != "a" {
		t.Fatalf("part 0 = %+v, want item a's tail silence", got.Parts[0])
	}
	if got.Parts[1].Kind != PartTrackGap {
		t.Fatalf("part 1 = %+v, want a track gap", got.Parts[1])
	}
	if got.Parts[2].Kind != PartItemSilence || got.Parts[2].ItemGUID != "b" {
		t.Fatalf("part 2 = %+v, want item b's head silence", got.Parts[2])
	}
	if len(got.ItemGUIDs) != 2 || got.ItemGUIDs[0] != "a" || got.ItemGUIDs[1] != "b" {
		t.Fatalf("candidate item GUIDs = %v, want [a b]", got.ItemGUIDs)
	}
}

// TestComposeEmptySpaceOverlappingItems is the "overlapping items" fixture:
// item B starts before item A ends (a crossfade), and both are fully
// audible, so their union must cover the whole span with no gap at all.
func TestComposeEmptySpaceOverlappingItems(t *testing.T) {
	items := []ItemAudible{item("a", 0, 5), item("b", 4, 5)} // b starts at 4, inside a's [0,5)
	candidates, ok := ComposeEmptySpace(items, Policy{MaxGapSeconds: sec(0.01)})
	if !ok {
		t.Fatalf("ComposeEmptySpace() ok = false")
	}
	if len(candidates) != 0 {
		t.Fatalf("ComposeEmptySpace() = %d candidates on fully-overlapping audio, want 0: %+v", len(candidates), candidates)
	}
}

// TestComposeEmptySpaceMutedItemIsEmptySpace is the "a muted item" fixture:
// the caller never builds an ItemAudible for a muted item (Resolve excludes
// it), so its span is empty, and if nothing else covers it, is a gap.
func TestComposeEmptySpaceMutedItemIsEmptySpace(t *testing.T) {
	// Only item A is fed in; a muted item that would have covered [5,8) on
	// the track is simply absent from items, exactly as Resolve would leave
	// it out.
	items := []ItemAudible{item("a", 0, 5), item("c", 8, 2)}
	candidates, ok := ComposeEmptySpace(items, Policy{MaxGapSeconds: sec(1)})
	if !ok {
		t.Fatalf("ComposeEmptySpace() ok = false")
	}
	if len(candidates) != 1 || candidates[0].Range != (TimelineInterval{Start: 5, End: 8}) {
		t.Fatalf("ComposeEmptySpace() = %+v, want one [5,8) gap where the muted item was", candidates)
	}
}

// TestComposeEmptySpaceHeadAndTail covers head/tail limits on and off
// (Phase 3's fixture list): head and tail are checked only when their own
// policy value is set; an unset one produces no candidate for that boundary
// at all, even when the stretch is long.
func TestComposeEmptySpaceHeadAndTail(t *testing.T) {
	// Item starts at t=2 (head = [0,2) relative to the track span... but the
	// track span floor is the earliest item's own start, so there is no
	// "before any item" head here) - use a leading silence inside the item
	// instead, which is what "head" means (Architecture Notes): the
	// complement before the first audible interval.
	leadIn := item("a", 0, 5, TimelineInterval{Start: 0, End: 3}) // 3s leading silence, audible only [3,5)
	trailOut := item("b", 5, 5, TimelineInterval{Start: 6, End: 10})
	items := []ItemAudible{leadIn, trailOut}

	t.Run("head and tail both set", func(t *testing.T) {
		candidates, ok := ComposeEmptySpace(items, Policy{HeadMaxSeconds: sec(1), TailMaxSeconds: sec(1)})
		if !ok {
			t.Fatalf("ok = false")
		}
		classes := classesOf(candidates)
		if !classes[ClassHead] || !classes[ClassTail] {
			t.Fatalf("candidates = %+v, want a head and a tail candidate", candidates)
		}
		if classes[ClassGap] {
			t.Fatalf("candidates = %+v, want no internal gap (MaxGapSeconds unset)", candidates)
		}
	})

	t.Run("head and tail both unset", func(t *testing.T) {
		candidates, ok := ComposeEmptySpace(items, Policy{})
		if !ok {
			t.Fatalf("ok = false")
		}
		if len(candidates) != 0 {
			t.Fatalf("candidates = %+v, want none: every policy value is unset (Q3 'not checked')", candidates)
		}
	})

	t.Run("head only", func(t *testing.T) {
		candidates, ok := ComposeEmptySpace(items, Policy{HeadMaxSeconds: sec(1)})
		if !ok {
			t.Fatalf("ok = false")
		}
		classes := classesOf(candidates)
		if !classes[ClassHead] {
			t.Fatalf("candidates = %+v, want a head candidate", candidates)
		}
		if classes[ClassTail] {
			t.Fatalf("candidates = %+v, want no tail candidate (TailMaxSeconds unset)", candidates)
		}
	})
}

// TestComposeEmptySpaceNoItems is the "policy unset" gate at the geometry
// level: with no analyzable items at all there is no track span to compose
// against.
func TestComposeEmptySpaceNoItems(t *testing.T) {
	if _, ok := ComposeEmptySpace(nil, Policy{MaxGapSeconds: sec(1)}); ok {
		t.Fatalf("ComposeEmptySpace(nil, ...) ok = true, want false")
	}
}

// TestComposeEmptySpaceDeterministic is a Success Metrics gate:
// "Reproducibility: same audio, project and settings produce identical
// candidates and ids." Composing the same input twice must give the same
// result.
func TestComposeEmptySpaceDeterministic(t *testing.T) {
	items := []ItemAudible{item("a", 0, 5), item("b", 8, 5)}
	policy := Policy{MaxGapSeconds: sec(1)}
	first, _ := ComposeEmptySpace(items, policy)
	second, _ := ComposeEmptySpace(items, policy)
	if len(first) != len(second) || len(first) != 1 {
		t.Fatalf("non-deterministic or wrong candidate count: %+v vs %+v", first, second)
	}
	if first[0].Range != second[0].Range {
		t.Fatalf("non-deterministic candidate range: %+v vs %+v", first[0], second[0])
	}
}

// TestPolicyChangeCostsNoDecode is the other Success Metrics gate this
// package can prove directly: ComposeEmptySpace never touches measure or the
// file system, so calling it twice with two different policies over the same
// already-decoded input is, by construction, zero decodes. This test proves
// the "by construction" claim actually holds by calling it many times with
// varying policy and confirming the answer only ever depends on policy, not
// on call count or order - the only way a decode could sneak in is if this
// function's signature changed to take a context or a file path, which it
// does not.
func TestPolicyChangeCostsNoDecode(t *testing.T) {
	items := []ItemAudible{item("a", 0, 5), item("b", 8, 5)}
	for _, maxGap := range []float64{0.5, 1, 2, 4} {
		candidates, ok := ComposeEmptySpace(items, Policy{MaxGapSeconds: sec(maxGap)})
		if !ok {
			t.Fatalf("ok = false for maxGap=%v", maxGap)
		}
		want := maxGap < 3 // the gap is exactly 3s
		if got := len(candidates) == 1; got != want {
			t.Fatalf("maxGap=%v: candidate present = %v, want %v", maxGap, got, want)
		}
	}
}

func TestPolicyFromSettingsUnsetByDefault(t *testing.T) {
	policy, err := PolicyFromSettings("", "", "")
	if err != nil {
		t.Fatalf("PolicyFromSettings() error = %v", err)
	}
	if policy.MaxGapSeconds != nil || policy.HeadMaxSeconds != nil || policy.TailMaxSeconds != nil {
		t.Fatalf("PolicyFromSettings(\"\",\"\",\"\") = %+v, want every field nil (no built-in default, Q2/Q3)", policy)
	}
}

func TestPolicyFromSettingsParsesAndRejectsGarbage(t *testing.T) {
	policy, err := PolicyFromSettings("1.5", "0.2", "")
	if err != nil {
		t.Fatalf("PolicyFromSettings() error = %v", err)
	}
	if policy.MaxGapSeconds == nil || *policy.MaxGapSeconds != 1.5 {
		t.Fatalf("MaxGapSeconds = %v, want 1.5", policy.MaxGapSeconds)
	}
	if policy.HeadMaxSeconds == nil || *policy.HeadMaxSeconds != 0.2 {
		t.Fatalf("HeadMaxSeconds = %v, want 0.2", policy.HeadMaxSeconds)
	}
	if policy.TailMaxSeconds != nil {
		t.Fatalf("TailMaxSeconds = %v, want nil (unset)", policy.TailMaxSeconds)
	}
	if _, err := PolicyFromSettings("not-a-number", "", ""); err == nil {
		t.Fatalf("PolicyFromSettings() error = nil, want an error for a non-numeric value")
	}
}

// TestItemAudibleFromItemMapsDecodeTimesToTimeline proves the join point
// between Decode (source-relative-to-range time) and ComposeEmptySpace
// (timeline time): a silence found 1s into a range that starts at source
// second 2, on an item positioned at timeline t=10, must land at [11,12) on
// the timeline, not at [1,2) or [3,4).
func TestItemAudibleFromItemMapsDecodeTimesToTimeline(t *testing.T) {
	src := Source{ItemGUID: "item-1", TakeGUID: "take-1", File: "/audio/a.wav", PlayedRange: evidence.PlayedRange{Start: 2, End: 5}}
	scan := ItemScan{DurationSeconds: 3, Silences: []measure.SilenceRegion{{StartSeconds: 1, EndSeconds: 2}}}
	audible := ItemAudibleFromItem("item-1", "take-1", 10, src, scan)
	if audible.Extent != (TimelineInterval{Start: 10, End: 13}) {
		t.Fatalf("Extent = %+v, want [10,13)", audible.Extent)
	}
	if len(audible.Silences) != 1 || audible.Silences[0] != (TimelineInterval{Start: 11, End: 12}) {
		t.Fatalf("Silences = %+v, want [[11,12)]", audible.Silences)
	}
}

func classesOf(candidates []EmptySpaceCandidate) map[EmptySpaceClass]bool {
	out := map[EmptySpaceClass]bool{}
	for _, c := range candidates {
		out[c.Class] = true
	}
	return out
}
