package preview

import "time"

// This file is Phase 8 of the proofing-preview-suggestion PRD
// (docs/prds/proofing-preview-suggestion.prd.md#phase-8---pin-adjust-and-close-out): letting the narrator settle
// on a suggested window and keep it (Q9 recommendation B), and move its edges by paragraph (User Flow step 5).

// PinnedRange is the narrator's own decision to keep one window: "a pin per book" (Q9), not per chapter -
// settling on a preview replaces whatever was pinned before, matching the User Flow's singular "the narrator can
// pin a window". AnchorText reuses prepmarkup's own per-paragraph staleness idea (apps/desktop/internal/prepmarkup)
// rather than inventing a second one: the paragraph's text at pin (or last adjustment) time, compared against the
// manuscript's current text for the same paragraph id on every read. Nothing here is a computed verdict (SR D1): a
// pin is never suggested, only kept when the narrator asks, and Suggest never reads it back.
type PinnedRange struct {
	ChapterID    string
	ParagraphIDs []string
	// AnchorText is keyed by paragraph id, one entry per id in ParagraphIDs.
	AnchorText map[string]string
	PinnedAt   time.Time
}

// StaleReason mirrors prepmarkup's own two causes: a pin is never silently moved to a guess, only reported stale
// with why.
type StaleReason string

const (
	StaleNone StaleReason = ""
	// StaleTextChanged: every paragraph the pin names is still in the chapter, but at least one no longer reads
	// the way it did when it was pinned or last adjusted.
	StaleTextChanged StaleReason = "text_changed"
	// StaleParagraphMissing: at least one paragraph the pin names is no longer in the manuscript (a re-import
	// renumbered or dropped it).
	StaleParagraphMissing StaleReason = "paragraph_missing"
)

// checkStale compares pin's stored anchor text against paragraphs' current text (keyed by paragraph id, the
// caller's own read of the manuscript's current state). It is an exact comparison, not prepmarkup's UTF-16-offset
// anchoring: a pin covers whole paragraphs (Q3), never a sub-paragraph span, so there is no offset to reconcile -
// only "is this still the same text".
func checkStale(pin PinnedRange, paragraphs map[string]string) StaleReason {
	for _, id := range pin.ParagraphIDs {
		current, ok := paragraphs[id]
		if !ok {
			return StaleParagraphMissing
		}
		if current != pin.AnchorText[id] {
			return StaleTextChanged
		}
	}
	return StaleNone
}

// Edge names which end of a pinned range an adjustment moves (User Flow step 5: "move its edges by paragraphs").
type Edge string

const (
	EdgeStart Edge = "start"
	EdgeEnd   Edge = "end"
)

// AdjustRange grows or shrinks currentIDs by exactly one paragraph at edge, within chapterID's own paragraphs
// (paragraphs may hold other chapters too; only chapterID's own are considered - Q3, a pin never crosses a
// chapter boundary). grow true extends the range to include the next paragraph outside it on that edge; grow
// false shrinks it by dropping its own outermost paragraph on that edge. Growing past the chapter's first or last
// paragraph, or shrinking a single-paragraph range, is a no-op (Q3's "never split a paragraph" has no smaller
// in-bounds answer, and there is no paragraph beyond the chapter to grow into) rather than an error or an empty
// range. ok is false when chapterID is unknown, currentIDs is empty, or currentIDs is not a contiguous run of
// chapterID's paragraphs in order (a corrupt store, or a pin whose paragraph_missing staleness means it no longer
// resolves at all) - the caller checks staleness first and only adjusts a pin that is not StaleParagraphMissing.
func AdjustRange(paragraphs []Paragraph, chapterID string, currentIDs []string, edge Edge, grow bool) (ids []string, ok bool) {
	if len(currentIDs) == 0 {
		return nil, false
	}
	chapterParas := chapterParagraphs(paragraphs)[chapterID]
	if len(chapterParas) == 0 {
		return nil, false
	}
	indexOf := make(map[string]int, len(chapterParas))
	for i, p := range chapterParas {
		indexOf[p.ID] = i
	}
	startIdx, startOK := indexOf[currentIDs[0]]
	endIdx, endOK := indexOf[currentIDs[len(currentIDs)-1]]
	if !startOK || !endOK || endIdx < startIdx || endIdx-startIdx+1 != len(currentIDs) {
		return nil, false
	}
	for i, id := range currentIDs {
		if chapterParas[startIdx+i].ID != id {
			return nil, false // not actually contiguous, despite matching start/end (a duplicate or reordered id)
		}
	}

	switch {
	case edge == EdgeStart && grow:
		if startIdx > 0 {
			startIdx--
		}
	case edge == EdgeStart && !grow:
		if endIdx > startIdx {
			startIdx++
		}
	case edge == EdgeEnd && grow:
		if endIdx < len(chapterParas)-1 {
			endIdx++
		}
	case edge == EdgeEnd && !grow:
		if endIdx > startIdx {
			endIdx--
		}
	}

	out := make([]string, 0, endIdx-startIdx+1)
	for i := startIdx; i <= endIdx; i++ {
		out = append(out, chapterParas[i].ID)
	}
	return out, true
}
