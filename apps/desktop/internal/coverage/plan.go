package coverage

import (
	"encoding/json"
	"sort"
)

// The model cascade's window planner (recording-check-model-cascade PRD Phase 4). It never runs
// anything and reads nothing from disk: given the first pass's report and the items it played, it
// decides whether a second pass is wanted at all, and if so whether to re-check bounded windows of
// specific items or the whole chapter, following MC1-MC3 (owner-adopted 2026-09-23).
const (
	// windowsSchemaVersion is the sidecar's --recheck windows file version (coverage_mode.WINDOWS_SCHEMA_VERSION).
	windowsSchemaVersion = 1
	// windowEdgePadSeconds is padded past each matched-word bound so the stronger model's own
	// decode never cuts off a word right at the edge the first pass matched (the PRD's
	// Architecture notes: "Word times at a window edge disagree between models").
	windowEdgePadSeconds = 3.0
	// windowMinSeconds is the smallest window transcribed (MC3): Whisper's cost is per 30-second
	// block (the PRD's Evidence benchmark), so a shorter window costs the same as this one.
	windowMinSeconds = 25.0
	// windowMergeGapSeconds (MC3): two windows of the same words file closer than this merge into
	// one, since transcribing the gap between them costs no more than the gap between the calls.
	windowMergeGapSeconds = 20.0
	// windowWholeChapterFraction (MC3): past this share of the chapter's played seconds, the
	// windows cost about as much as the whole, so one whole-chapter pass replaces them.
	windowWholeChapterFraction = 0.60
)

// window is one bounded stretch of one item's source audio to re-check with the stronger model:
// the shape the sidecar's --recheck windows file lists (coverage_mode.Window).
type window struct {
	ItemIndex  int
	ItemGUID   string
	SourceFile string
	WordsFile  string
	Start      float64
	End        float64
}

func (w window) length() float64 { return w.End - w.Start }

// recheckPlan is what the second pass should do: nothing (the first pass reported no regions, or
// no recheck model was asked for), a list of windows, or the whole chapter.
type recheckPlan struct {
	Windows      []window
	WholeChapter bool
}

// needed reports whether a second pass is wanted at all.
func (p recheckPlan) needed() bool { return p.WholeChapter || len(p.Windows) > 0 }

// planRecheck plans the second pass from the first pass's report and the items the run played.
// recheckModel empty (Phase 5 has not turned the cascade on for this run) or a report with no
// regions (the first pass called the chapter complete) both mean nothing to plan: the model
// cascade PRD's "no second pass when nothing is missing".
func planRecheck(report Report, items []plannedItem, recheckModel string) recheckPlan {
	if recheckModel == "" || len(report.Regions) == 0 {
		return recheckPlan{}
	}
	var ordered []plannedItem
	for _, item := range items {
		if !item.Muted {
			ordered = append(ordered, item)
		}
	}
	if len(ordered) == 0 {
		return recheckPlan{}
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Index < ordered[j].Index })

	bounds := make(map[int][2]float64, len(ordered))
	for _, item := range ordered {
		bounds[item.Index] = [2]float64{item.StartOffset, item.StartOffset + item.Length}
	}

	var raw []window
	for _, region := range report.Regions {
		raw = append(raw, regionWindows(region, ordered)...)
	}
	if len(raw) == 0 {
		return recheckPlan{}
	}
	for i, w := range raw {
		itemBounds := bounds[w.ItemIndex]
		raw[i] = padWindow(w, itemBounds[0], itemBounds[1])
	}
	merged := mergeWindows(raw)
	if totalLength(merged) > windowWholeChapterFraction*totalPlayed(ordered) {
		return recheckPlan{WholeChapter: true}
	}
	return recheckPlan{Windows: merged}
}

// regionWindows turns one region's bounds into a window per item it spans: one window when its
// Before and After both sit in the same item, or one window per item between them (each edge item
// clipped to its own bound, any item wholly between them windowed in full) when the region crosses
// an item boundary. A nil bound (a chapter edge, or nothing said at all on that side, ADR 0168)
// runs to that item's own played edge instead.
func regionWindows(region RegionLine, ordered []plannedItem) []window {
	startIndex, startTime := ordered[0].Index, 0.0
	if region.Before != nil {
		startIndex, startTime = region.Before.ItemIndex, region.Before.SourceTime
	}
	endIndex, endTime := ordered[len(ordered)-1].Index, 0.0
	if region.After != nil {
		endIndex, endTime = region.After.ItemIndex, region.After.SourceTime
	}
	if startIndex > endIndex {
		return nil
	}
	var windows []window
	for _, item := range ordered {
		if item.Index < startIndex || item.Index > endIndex {
			continue
		}
		start, end := item.StartOffset, item.StartOffset+item.Length
		if item.Index == startIndex && region.Before != nil {
			start = startTime
		}
		if item.Index == endIndex && region.After != nil {
			end = endTime
		}
		if end <= start {
			continue
		}
		windows = append(windows, window{ItemIndex: item.Index, ItemGUID: item.ItemGUID, SourceFile: item.SourceFile, WordsFile: item.WordsFile, Start: start, End: end})
	}
	return windows
}

// padWindow extends a window past its matched-word bounds and up to the minimum window size
// (MC3), then keeps it inside the item's own played range [itemStart, itemEnd): "a window at a
// chapter edge runs to the item's edge" generalizes to every window never reading past its own
// item. A shortfall on one side shifts onto the other rather than shrinking the window, so a
// window away from both edges still reaches windowMinSeconds; one that cannot (the item itself is
// shorter) is clamped to the whole item instead.
func padWindow(w window, itemStart, itemEnd float64) window {
	start, end := w.Start-windowEdgePadSeconds, w.End+windowEdgePadSeconds
	if extra := windowMinSeconds - (end - start); extra > 0 {
		half := extra / 2
		start -= half
		end += half
	}
	if start < itemStart {
		end += itemStart - start
		start = itemStart
	}
	if end > itemEnd {
		start -= end - itemEnd
		end = itemEnd
	}
	if start < itemStart {
		start = itemStart
	}
	w.Start, w.End = start, end
	return w
}

// mergeWindows merges windows of the same words file that are closer than windowMergeGapSeconds
// apart (MC3). Windows of different words files never merge: they splice into different files.
func mergeWindows(raw []window) []window {
	byFile := map[string][]window{}
	var order []string
	for _, w := range raw {
		if _, seen := byFile[w.WordsFile]; !seen {
			order = append(order, w.WordsFile)
		}
		byFile[w.WordsFile] = append(byFile[w.WordsFile], w)
	}
	var merged []window
	for _, file := range order {
		group := byFile[file]
		sort.Slice(group, func(i, j int) bool { return group[i].Start < group[j].Start })
		current := group[0]
		for _, w := range group[1:] {
			if w.Start-current.End < windowMergeGapSeconds {
				if w.End > current.End {
					current.End = w.End
				}
				continue
			}
			merged = append(merged, current)
			current = w
		}
		merged = append(merged, current)
	}
	return merged
}

func totalLength(windows []window) float64 {
	var total float64
	for _, w := range windows {
		total += w.length()
	}
	return total
}

func totalPlayed(items []plannedItem) float64 {
	var total float64
	for _, item := range items {
		total += item.Length
	}
	return total
}

// windowsFile is the JSON the sidecar's --recheck reads (coverage_mode.read_windows): a schema
// version and a list of windows, each exactly the six keys coverage_mode.Window checks for - no
// more, no fewer (coverage_mode._WINDOW_KEYS).
type windowsFile struct {
	SchemaVersion int            `json:"schemaVersion"`
	Windows       []windowsEntry `json:"windows"`
}

type windowsEntry struct {
	ItemIndex  int     `json:"itemIndex"`
	ItemGUID   string  `json:"itemGuid"`
	SourceFile string  `json:"sourceFile"`
	WordsFile  string  `json:"wordsFile"`
	Start      float64 `json:"start"`
	End        float64 `json:"end"`
}

// writeWindowsFile writes the --recheck windows file the next stage's sidecar process reads.
func writeWindowsFile(path string, windows []window) error {
	entries := make([]windowsEntry, len(windows))
	for i, w := range windows {
		entries[i] = windowsEntry(w)
	}
	encoded, err := json.MarshalIndent(windowsFile{SchemaVersion: windowsSchemaVersion, Windows: entries}, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomically(path, encoded)
}
