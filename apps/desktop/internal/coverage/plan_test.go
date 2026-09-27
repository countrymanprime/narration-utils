package coverage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// planItemLength is deliberately far longer than windowMinSeconds so a window near the middle of
// an item is never truncated by its own edges; the edge-truncation tests place their regions near
// an item's own start or end on purpose.
const planItemLength = 300.0

// planItems are three unmuted items on one track, in play order (index 0, 1, 2), the shape
// planRecheck reads from a run's plan.
func planItems() []plannedItem {
	items := make([]plannedItem, 3)
	for i := range items {
		items[i] = plannedItem{ManifestItem: ManifestItem{
			Index: i, ItemGUID: itemGUID(i), SourceFile: sourceFile(i), StartOffset: 0, Length: planItemLength, WordsFile: wordsFileFor(i),
		}}
	}
	return items
}

func itemGUID(i int) string     { return []string{"{ITEM-0}", "{ITEM-1}", "{ITEM-2}"}[i] }
func sourceFile(i int) string   { return []string{"a.wav", "b.wav", "c.wav"}[i] }
func wordsFileFor(i int) string { return []string{"w-0.json", "w-1.json", "w-2.json"}[i] }

func pos(itemIndex int, guid string, t float64) *RegionPosition {
	return &RegionPosition{ItemIndex: itemIndex, ItemGUID: guid, SourceTime: t}
}

func TestPlanRecheckDoesNothingWithoutAModelOrRegions(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "skip", Before: pos(0, itemGUID(0), 10), After: pos(0, itemGUID(0), 12)}

	if plan := planRecheck(Report{Regions: []RegionLine{region}}, items, ""); plan.needed() {
		t.Fatalf("no recheck model must plan nothing, got %+v", plan)
	}
	if plan := planRecheck(Report{}, items, "large-v3-turbo"); plan.needed() {
		t.Fatalf("no regions must plan nothing, got %+v", plan)
	}
}

func TestPlanRecheckWindowsOneRegionInOneItem(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "skip", Before: pos(0, itemGUID(0), 10), After: pos(0, itemGUID(0), 12)}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	if plan.WholeChapter || len(plan.Windows) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	w := plan.Windows[0]
	if w.ItemIndex != 0 || w.ItemGUID != itemGUID(0) || w.SourceFile != sourceFile(0) || w.WordsFile != wordsFileFor(0) {
		t.Fatalf("window = %+v", w)
	}
	// Padded to the 25s minimum (2s wide, padded 3s past each bound, then still short of 25),
	// shifted right off the item's own start (0) rather than shrunk.
	if w.Start != 0 || w.End != windowMinSeconds {
		t.Fatalf("window bounds = [%g,%g], want [0,%g]", w.Start, w.End, windowMinSeconds)
	}
}

func TestPlanRecheckAWindowNeverGoesNegative(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "head", Before: nil, After: pos(0, itemGUID(0), 1)}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	if len(plan.Windows) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	w := plan.Windows[0]
	if w.Start != 0 || w.End != windowMinSeconds {
		t.Fatalf("window = %+v, want [0,%g]", w, windowMinSeconds)
	}
}

func TestPlanRecheckANilBeforeRunsToTheItemsOwnStart(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "head", Before: nil, After: pos(0, itemGUID(0), 5)}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	if len(plan.Windows) != 1 || plan.Windows[0].Start != 0 {
		t.Fatalf("plan = %+v, want a window starting at the item's own edge", plan)
	}
}

func TestPlanRecheckANilAfterRunsToTheItemsOwnEnd(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "tail", Before: pos(2, itemGUID(2), planItemLength-5), After: nil}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	if len(plan.Windows) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	w := plan.Windows[0]
	if w.ItemIndex != 2 || w.End != planItemLength {
		t.Fatalf("window = %+v, want it to run to item 2's own end (%g)", w, planItemLength)
	}
}

func TestPlanRecheckARegionCrossingTwoItemsBecomesOneWindowPerItem(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "skip", Before: pos(0, itemGUID(0), planItemLength-2), After: pos(1, itemGUID(1), 2)}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	if len(plan.Windows) != 2 {
		t.Fatalf("plan = %+v, want two windows (one per item)", plan)
	}
	first, second := plan.Windows[0], plan.Windows[1]
	if first.ItemIndex != 0 || first.End != planItemLength { // item 0 runs to its own end
		t.Fatalf("first window = %+v", first)
	}
	if second.ItemIndex != 1 || second.Start != 0 { // item 1 starts at its own edge
		t.Fatalf("second window = %+v", second)
	}
}

func TestPlanRecheckARegionSpanningAWhollyMissingMiddleItem(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "skip", Before: pos(0, itemGUID(0), planItemLength-2), After: pos(2, itemGUID(2), 2)}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	if len(plan.Windows) != 3 {
		t.Fatalf("plan = %+v, want a window in every item from 0 to 2", plan)
	}
	if plan.Windows[1].ItemIndex != 1 || plan.Windows[1].Start != 0 || plan.Windows[1].End != planItemLength {
		t.Fatalf("the wholly-spanned middle item must be windowed in full: %+v", plan.Windows[1])
	}
}

func TestPlanRecheckTwoCloseRegionsOfTheSameItemMerge(t *testing.T) {
	items := planItems()
	regions := []RegionLine{
		{Kind: "skip", Before: pos(0, itemGUID(0), 10), After: pos(0, itemGUID(0), 11)},
		{Kind: "skip", Before: pos(0, itemGUID(0), 20), After: pos(0, itemGUID(0), 21)}, // padded windows overlap once extended
	}

	plan := planRecheck(Report{Regions: regions}, items, "large-v3-turbo")

	if len(plan.Windows) != 1 {
		t.Fatalf("plan = %+v, want the two close regions to merge into one window", plan)
	}
}

func TestPlanRecheckTwoFarRegionsOfTheSameItemStaySeparate(t *testing.T) {
	items := planItems()
	regions := []RegionLine{
		{Kind: "skip", Before: pos(0, itemGUID(0), 50), After: pos(0, itemGUID(0), 51)},
		{Kind: "skip", Before: pos(0, itemGUID(0), 200), After: pos(0, itemGUID(0), 201)},
	}

	plan := planRecheck(Report{Regions: regions}, items, "large-v3-turbo")

	if len(plan.Windows) != 2 {
		t.Fatalf("plan = %+v, want the two far regions to stay separate windows", plan)
	}
}

func TestPlanRecheckFallsBackToTheWholeChapterPastTheFraction(t *testing.T) {
	items := planItems() // 3 * planItemLength seconds of played audio in total
	var regions []RegionLine
	for i := 0; i < 3; i++ {
		regions = append(regions, RegionLine{Kind: "skip", Before: pos(i, itemGUID(i), 0), After: pos(i, itemGUID(i), planItemLength)})
	}

	plan := planRecheck(Report{Regions: regions}, items, "large-v3-turbo")

	if !plan.WholeChapter || len(plan.Windows) != 0 {
		t.Fatalf("plan = %+v, want the whole chapter once the windows exceed %g%% of it", plan, windowWholeChapterFraction*100)
	}
}

func TestPlanRecheckStaysWithinWindowsWhenUnderTheFraction(t *testing.T) {
	items := planItems()
	region := RegionLine{Kind: "skip", Before: pos(0, itemGUID(0), 10), After: pos(0, itemGUID(0), 12)}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	if plan.WholeChapter {
		t.Fatalf("plan = %+v, a single small window must not trip the whole-chapter fallback", plan)
	}
}

func TestPlanRecheckMutedItemsAreNeverWindowed(t *testing.T) {
	items := planItems()
	items[1].Muted = true
	region := RegionLine{Kind: "skip", Before: pos(0, itemGUID(0), planItemLength-2), After: pos(2, itemGUID(2), 2)}

	plan := planRecheck(Report{Regions: []RegionLine{region}}, items, "large-v3-turbo")

	for _, w := range plan.Windows {
		if w.ItemIndex == 1 {
			t.Fatalf("a muted item must never be windowed: %+v", plan.Windows)
		}
	}
}

func TestWriteWindowsFileMatchesTheSidecarsSixKeysExactly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "windows.json")
	windows := []window{{ItemIndex: 1, ItemGUID: "{G}", SourceFile: "a.wav", WordsFile: "w-1.json", Start: 3.5, End: 18.5}}

	if err := writeWindowsFile(path, windows); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["schemaVersion"] != float64(1) {
		t.Fatalf("schemaVersion = %v", decoded["schemaVersion"])
	}
	entries, ok := decoded["windows"].([]any)
	if !ok || len(entries) != 1 {
		t.Fatalf("windows = %v", decoded["windows"])
	}
	entry, ok := entries[0].(map[string]any)
	if !ok {
		t.Fatalf("entry = %v", entries[0])
	}
	want := map[string]bool{"itemIndex": true, "itemGuid": true, "sourceFile": true, "wordsFile": true, "start": true, "end": true}
	if len(entry) != len(want) {
		t.Fatalf("entry keys = %v, want exactly %v", entry, want)
	}
	for key := range entry {
		if !want[key] {
			t.Fatalf("entry has an unknown key %q the sidecar's argparse-style check would refuse", key)
		}
	}
}
