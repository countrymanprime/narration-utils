// This file is Phase 3 of docs/prds/editing-readiness-analysis.prd.md: the
// empty-space composition. Architecture Notes: "Empty space is the
// complement of speech-bearing audio. For each analyzed item, the
// speech-bearing intervals are the played range minus its silence runs,
// mapped to timeline time. The union across unmuted items on the track is
// the audible content; every complement interval inside the chapter span is
// empty space... Head and tail are the complement before the first and
// after the last audible interval." ComposeEmptySpace below is exactly that:
// a pure function over already-decoded per-item silence runs (Decode,
// decode.go) mapped to timeline time by the caller (Phase 5's job or a
// caller feeding cached results), so a policy change (maximum gap, head or
// tail limit) re-evaluates with 0 decodes (Success Metrics: "Policy change
// costs no decode").
package editing

import (
	"fmt"
	"sort"
	"strconv"
)

// timelineMergeEpsilon absorbs floating-point rounding at a silence or item
// boundary: two intervals within this of touching are merged as if they
// touched exactly, so a rounding error never creates a spurious sliver
// candidate between two runs that are really one continuous stretch.
const timelineMergeEpsilon = 1e-6

// TimelineInterval is a closed-open span of chapter timeline seconds
// (project seconds, the findings contract's TimeRange.Start/End).
type TimelineInterval struct {
	Start float64
	End   float64
}

func (iv TimelineInterval) length() float64 { return iv.End - iv.Start }

func (iv TimelineInterval) overlaps(other TimelineInterval) bool {
	return iv.Start < other.End && other.Start < iv.End
}

// ItemAudible is one unmuted, analyzable item's contribution to empty-space
// composition: its own PlayedRange and file (for the finding's source-
// relative identity, Q7), where it sits on the timeline (Extent), and its
// own silence runs mapped to timeline time. Silences must already be mapped
// from Decode's source-relative-to-the-played-range convention to timeline
// time by the caller: TimelineSilenceStart = item.Position + (source-relative
// start - PlayedRange.Start), valid because every analyzable item plays at
// rate 1 (ReasonPlayRateNotOne refuses anything else) so one source second
// is exactly one timeline second.
type ItemAudible struct {
	ItemGUID    string
	TakeGUID    string
	File        string
	PlayedRange PlayedRange
	Extent      TimelineInterval // [item.Position, item.Position+item.Length)
	Silences    []TimelineInterval
}

// PlayedRange is a local alias of evidence.PlayedRange kept unexported-field-
// free so this file does not have to import evidence just for one field
// type; ItemAudibleFromItem below is what actually bridges the two.
type PlayedRange struct {
	Start float64
	End   float64
}

// ItemAudibleFromItem builds one ItemAudible from an item's resolved Source
// and a Decode result over it: it maps every silence run from Decode's
// source-relative-to-the-range time back to timeline time using itemPosition
// (the item's own Position) and translates Source.PlayedRange into this
// file's PlayedRange alias.
func ItemAudibleFromItem(itemGUID, takeGUID string, itemPosition float64, src Source, scan ItemScan) ItemAudible {
	audible := ItemAudible{
		ItemGUID: itemGUID, TakeGUID: takeGUID, File: src.File,
		PlayedRange: PlayedRange{Start: src.PlayedRange.Start, End: src.PlayedRange.End},
		Extent:      TimelineInterval{Start: itemPosition, End: itemPosition + (src.PlayedRange.End - src.PlayedRange.Start)},
	}
	for _, region := range scan.Silences {
		audible.Silences = append(audible.Silences, TimelineInterval{
			Start: itemPosition + region.StartSeconds,
			End:   itemPosition + region.EndSeconds,
		})
	}
	return audible
}

// audibleIntervals is item's own Extent minus its Silences, in timeline
// time: the speech-bearing sub-intervals of one item.
func (item ItemAudible) audibleIntervals() []TimelineInterval {
	silences := sortedIntervals(item.Silences)
	cursor := item.Extent.Start
	var out []TimelineInterval
	for _, silence := range silences {
		if silence.Start > cursor {
			out = append(out, TimelineInterval{Start: cursor, End: silence.Start})
		}
		cursor = max(cursor, silence.End)
	}
	if cursor < item.Extent.End {
		out = append(out, TimelineInterval{Start: cursor, End: item.Extent.End})
	}
	return out
}

// Policy is the narrator's empty-space settings (Q2, Q3): nil means unset,
// which a caller must read as "not checked" for that part, never a silent
// default (D10: "policy values unset by default"; Q2/Q3's D22 default is
// exactly this - unknown until the narrator sets a value, never a guessed
// number).
type Policy struct {
	MaxGapSeconds  *float64
	HeadMaxSeconds *float64
	TailMaxSeconds *float64
}

// PolicyFromSettings parses the Editing settings section's three optional
// numbers (as the settings store hands them back: "" for unset, a plain
// decimal string otherwise). It never fabricates a default: an empty string
// becomes a nil pointer, not zero.
func PolicyFromSettings(maxGapSeconds, headMaxSeconds, tailMaxSeconds string) (Policy, error) {
	maxGap, err := parseOptionalSeconds("max_gap_seconds", maxGapSeconds)
	if err != nil {
		return Policy{}, err
	}
	head, err := parseOptionalSeconds("head_max_seconds", headMaxSeconds)
	if err != nil {
		return Policy{}, err
	}
	tail, err := parseOptionalSeconds("tail_max_seconds", tailMaxSeconds)
	if err != nil {
		return Policy{}, err
	}
	return Policy{MaxGapSeconds: maxGap, HeadMaxSeconds: head, TailMaxSeconds: tail}, nil
}

func parseOptionalSeconds(key, raw string) (*float64, error) {
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil, fmt.Errorf("editing setting %s: %q is not a number", key, raw)
	}
	return &value, nil
}

// PartKind is what one segment of a composed empty-space candidate is: a
// silence run inside an item's own played range, or a stretch of timeline
// where no unmuted item plays at all (a gap left by trimming, or a muted
// item's own span, per the complement-of-audible-content model).
type PartKind string

const (
	PartItemSilence PartKind = "item_silence"
	PartTrackGap    PartKind = "track_gap"
)

// CandidatePart is one contiguous segment of a composed candidate (Architecture
// Notes: "A candidate records its parts (item tail, gap, item head) and the
// item GUIDs"). For an item_silence part, SourceStart/SourceEnd are that
// item's own played-range-relative source seconds (Q7 B: a dismissal's
// identity is anchored to source-relative range, not the item's timeline
// position), computed from the item's PlayedRange and its own Extent -
// meaningful only because every analyzable item plays at rate 1.
type CandidatePart struct {
	Kind        PartKind
	ItemGUID    string  // "" for a track_gap
	SourceStart float64 // meaningful only for PartItemSilence
	SourceEnd   float64
	Length      float64 // End - Start in timeline seconds, for every kind
}

// EmptySpaceClass is what boundary of the audible content a composed
// candidate sits at.
type EmptySpaceClass string

const (
	ClassHead EmptySpaceClass = "head"
	ClassGap  EmptySpaceClass = "gap"
	ClassTail EmptySpaceClass = "tail"
)

// EmptySpaceCandidate is one composed stretch of empty space that crossed
// the narrator's policy: its outer timeline range, which boundary it is,
// its parts (Architecture Notes), and the distinct item GUIDs it touches, in
// timeline order.
type EmptySpaceCandidate struct {
	Range     TimelineInterval
	Class     EmptySpaceClass
	Parts     []CandidatePart
	ItemGUIDs []string
}

// ComposeEmptySpace is Phase 3's own pure function (Architecture Notes:
// "Scan measures, evaluation decides... Evaluation is pure and
// deterministic"). Given every unmuted, analyzable item's own silence runs
// (already in timeline time, ItemAudibleFromItem) and the narrator's policy,
// it unions the items' speech-bearing intervals, takes the complement across
// the whole track span (from the earliest item's start to the latest item's
// end - nothing before or after any item exists to trim), classifies each
// complement stretch as head, an internal gap, or tail, and keeps only the
// ones that cross the relevant policy value, set. A policy value left unset
// (nil) means that boundary is not checked at all (Q3 option A: "unset means
// head and tail not checked") - it never produces a candidate and never
// blocks the others. items with no analyzable items at all is (nil, ok=false):
// there is no track span to compose against.
func ComposeEmptySpace(items []ItemAudible, policy Policy) (candidates []EmptySpaceCandidate, ok bool) {
	if len(items) == 0 {
		return nil, false
	}
	span, audible := trackSpanAndAudible(items)
	complements := complementWithin(span, audible)
	for i, complement := range complements {
		class := ClassGap
		switch {
		case i == 0 && complement.Start <= span.Start+timelineMergeEpsilon:
			class = ClassHead
		case i == len(complements)-1 && complement.End >= span.End-timelineMergeEpsilon:
			class = ClassTail
		}
		threshold := policy.MaxGapSeconds
		switch class {
		case ClassHead:
			threshold = policy.HeadMaxSeconds
		case ClassTail:
			threshold = policy.TailMaxSeconds
		}
		if threshold == nil || complement.length() <= *threshold {
			continue
		}
		parts, itemGUIDs := candidateParts(complement, items)
		candidates = append(candidates, EmptySpaceCandidate{Range: complement, Class: class, Parts: parts, ItemGUIDs: itemGUIDs})
	}
	return candidates, true
}

// trackSpanAndAudible returns the whole track's span (earliest item start to
// latest item end) and the merged union of every item's own speech-bearing
// intervals within it.
func trackSpanAndAudible(items []ItemAudible) (TimelineInterval, []TimelineInterval) {
	span := items[0].Extent
	var all []TimelineInterval
	for _, item := range items {
		span.Start = min(span.Start, item.Extent.Start)
		span.End = max(span.End, item.Extent.End)
		all = append(all, item.audibleIntervals()...)
	}
	return span, mergeIntervals(all)
}

// complementWithin returns the gaps of span not covered by merged (sorted,
// non-overlapping, already merged by mergeIntervals).
func complementWithin(span TimelineInterval, merged []TimelineInterval) []TimelineInterval {
	var out []TimelineInterval
	cursor := span.Start
	for _, interval := range merged {
		if interval.Start > cursor+timelineMergeEpsilon {
			out = append(out, TimelineInterval{Start: cursor, End: interval.Start})
		}
		cursor = max(cursor, interval.End)
	}
	if span.End > cursor+timelineMergeEpsilon {
		out = append(out, TimelineInterval{Start: cursor, End: span.End})
	}
	return out
}

// candidateParts attributes a composed complement interval to the items it
// overlaps (item_silence parts, one per overlapping item, clipped to the
// complement) and to the stretches inside it that touch no item at all
// (track_gap parts), in timeline order, plus the distinct item GUIDs touched.
func candidateParts(complement TimelineInterval, items []ItemAudible) ([]CandidatePart, []string) {
	type touch struct {
		interval TimelineInterval
		item     *ItemAudible
	}
	var touches []touch
	for i := range items {
		item := &items[i]
		if !complement.overlaps(item.Extent) {
			continue
		}
		clipped := TimelineInterval{Start: max(complement.Start, item.Extent.Start), End: min(complement.End, item.Extent.End)}
		if clipped.length() > 0 {
			touches = append(touches, touch{interval: clipped, item: item})
		}
	}
	sort.Slice(touches, func(i, j int) bool { return touches[i].interval.Start < touches[j].interval.Start })

	var parts []CandidatePart
	itemGUIDs := []string{}
	cursor := complement.Start
	for _, t := range touches {
		if t.interval.Start > cursor+timelineMergeEpsilon {
			parts = append(parts, trackGapPart(TimelineInterval{Start: cursor, End: t.interval.Start}))
		}
		sourceStart := t.item.PlayedRange.Start + (t.interval.Start - t.item.Extent.Start)
		sourceEnd := t.item.PlayedRange.Start + (t.interval.End - t.item.Extent.Start)
		parts = append(parts, CandidatePart{
			Kind: PartItemSilence, ItemGUID: t.item.ItemGUID, SourceStart: sourceStart, SourceEnd: sourceEnd,
			Length: t.interval.length(),
		})
		if !containsString(itemGUIDs, t.item.ItemGUID) {
			itemGUIDs = append(itemGUIDs, t.item.ItemGUID)
		}
		cursor = max(cursor, t.interval.End)
	}
	if complement.End > cursor+timelineMergeEpsilon {
		parts = append(parts, trackGapPart(TimelineInterval{Start: cursor, End: complement.End}))
	}
	return parts, itemGUIDs
}

func trackGapPart(gap TimelineInterval) CandidatePart {
	return CandidatePart{Kind: PartTrackGap, Length: gap.length()}
}

func containsString(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// sortedIntervals returns a sorted copy of intervals by Start.
func sortedIntervals(intervals []TimelineInterval) []TimelineInterval {
	out := append([]TimelineInterval(nil), intervals...)
	sort.Slice(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

// mergeIntervals sorts and merges overlapping or touching (within
// timelineMergeEpsilon) intervals into the smallest equivalent set.
func mergeIntervals(intervals []TimelineInterval) []TimelineInterval {
	sorted := sortedIntervals(intervals)
	var merged []TimelineInterval
	for _, interval := range sorted {
		if interval.length() <= 0 {
			continue
		}
		if len(merged) > 0 && interval.Start <= merged[len(merged)-1].End+timelineMergeEpsilon {
			merged[len(merged)-1].End = max(merged[len(merged)-1].End, interval.End)
			continue
		}
		merged = append(merged, interval)
	}
	return merged
}
