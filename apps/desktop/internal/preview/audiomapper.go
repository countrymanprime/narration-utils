package preview

import "strings"

// This file is Phase 6 of the proofing-preview-suggestion PRD
// (docs/prds/proofing-preview-suggestion.prd.md#phase-6---audio-position-mapper-spike-then-build): the spike's
// answer to Q8 ("how does a paragraph get an audio time range") and the mapper it decided to build.
//
// The spike compared Q8's three options against the delivered codebase, not against the PRD's proposal text:
//
//   - Option A (TR-3, persisted word timing): does not exist. Ruled out, per the PRD's own note.
//   - Option B (the line-identity stamp reader, stamp_item_lines/read_line_ids): PROVEN buildable, not merely
//     recommended-pending-a-spike. docs/research/reaper-spike-s0-item-extension-data.md settled (2026-09-21,
//     against a real REAPER 7.80 and the owner's own Challenges_001 project) that a stamped item's line id and
//     text round-trip through save and reload as plain <EXTI ...> lines in the saved .rpp, and
//     internal/tracks/extension.go already decodes them into Item.Ext with no REAPER running and no Lua change
//     (Item.Position/Item.Length give the same project-second time range Phase 7's windowed analyzers key off of).
//     The line-id scheme (internal/lineidentity's ComposeLineID/ParseLineID) already supports a paragraph-level
//     id ("p-000001@<source sha256>"), not only the chapter-level id the one shipped UI trigger (Tracks page,
//     "Link chapters") stamps today. This file re-implements that same two-field parse locally (composeLineID/
//     parseLineID below) rather than importing internal/lineidentity, which pulls in the live bridge, the
//     manuscript service and a stateful run model this package has no business depending on for a pure, offline
//     read of already-parsed item data (Architecture Notes: "small read-only interfaces").
//   - Option C (coarse per-chapter pace, no per-window claim): pace.go's ChapterPace/EstimateErrorFraction. Kept
//     as evidence Phase 7 always has, since no shipped UI stamps a paragraph yet (only a chapter) - MapParagraphsToTime
//     below is correct and tested against a real REAPER-saved fixture today, but will answer "unmapped" for every
//     paragraph in practice until a paragraph-stamping trigger exists to produce data for it. Building that
//     trigger (a new UI action, wire binding) is its own feature, out of this phase's "spike, then build" scope.
//
// Decision (recorded here rather than as a Proposed ADR: Q8 already names a recommendation, and the spike above
// resolves the question further in the recommendation's own favour rather than raising one for the owner - D22):
// build B now (it is proven, small, and testable against a real fixture), keep C as Phase 7's fallback evidence
// (since B has no data yet in practice), and treat "add a paragraph-stamping UI trigger" as later, separately
// scoped work, not part of this phase.

// StampedItem is one REAPER item's line-identity stamp and time range, already extracted from a saved project's
// parsed Item.Ext (the caller's job - Phase 7's binding, reading tracks.Item the same way evidence/staleness.go
// already does for its own fingerprints). This package takes plain values rather than a tracks.Item, so it stays
// as free of REAPER's own chunk model as Phase 5's OpenFinding is of the RD-1 store's Finding record.
type StampedItem struct {
	ItemGUID string
	// LineID is the item's raw narration_utils_line_id extension value, composeLineID's own "<entity id>@<source
	// sha256>" format when the stamp is this scheme's; an older or foreign stamp (no "@", or from before this
	// scheme existed) fails to parse and never resolves to any paragraph.
	LineID string
	// Position and Length are the item's own D_POSITION/D_LENGTH, in project seconds (SR D5's own basis: one
	// mapped track, one project timeline - the same played range evidence/fingerprint.go already reads for its
	// AnalysisKey).
	Position, Length float64
}

// MapReason names why a paragraph's mapping is unknown; "" when it mapped.
type MapReason string

const (
	// ReasonParagraphUnmapped: no stamped item's line id names this paragraph at all.
	ReasonParagraphUnmapped MapReason = "unmapped"
	// ReasonParagraphStale: exactly one item names this paragraph, but its stamped source hash no longer matches
	// the manuscript's current one (a re-import happened since the stamp was made) - the same "stale-source"
	// case internal/lineidentity's own Read() already reports for a live check.
	ReasonParagraphStale MapReason = "stale_source"
	// ReasonParagraphAmbiguous: more than one item names this paragraph (a split or duplicate of an already
	// stamped item, per docs/research/reaper-spike-s0-item-extension-data.md's own observation that both keep the
	// stamp) - this package can never safely pick one over another, so it answers unknown rather than guessing.
	ReasonParagraphAmbiguous MapReason = "ambiguous"
)

// ParagraphTimeRange is a paragraph's mapped span of project-second audio, [Start, Start+Length).
type ParagraphTimeRange struct {
	Start, Length float64
}

// ParagraphMapping is one paragraph's answer: Mapped true with a Range, or false with Reason naming why -
// "unknown" in the PRD's own tri-state language (SR D2), never treated as a time range that happens to be zero.
type ParagraphMapping struct {
	Mapped bool
	Range  ParagraphTimeRange
	Reason MapReason
}

// MapParagraphsToTime answers, for every id in paragraphIDs, whether a stamped item maps it to a time range
// against currentSourceSHA256 (the manuscript's current source checksum - the same field
// internal/lineidentity.sourceSHA256 reads). Every requested id gets an entry, mapped or not, so a caller never
// has to treat a missing map key and an explicit "unmapped" differently (Success Metrics: "unknown is shown,
// never good").
func MapParagraphsToTime(items []StampedItem, currentSourceSHA256 string, paragraphIDs []string) map[string]ParagraphMapping {
	byEntity := map[string][]StampedItem{}
	for _, item := range items {
		entityID, _, ok := parseLineID(item.LineID)
		if !ok {
			continue
		}
		byEntity[entityID] = append(byEntity[entityID], item)
	}

	result := make(map[string]ParagraphMapping, len(paragraphIDs))
	for _, id := range paragraphIDs {
		matches := byEntity[id]
		switch {
		case len(matches) == 0:
			result[id] = ParagraphMapping{Reason: ReasonParagraphUnmapped}
		case len(matches) > 1:
			result[id] = ParagraphMapping{Reason: ReasonParagraphAmbiguous}
		default:
			result[id] = mapSingle(matches[0], currentSourceSHA256)
		}
	}
	return result
}

func mapSingle(item StampedItem, currentSourceSHA256 string) ParagraphMapping {
	_, stampedHash, _ := parseLineID(item.LineID)
	if stampedHash != currentSourceSHA256 {
		return ParagraphMapping{Reason: ReasonParagraphStale}
	}
	return ParagraphMapping{Mapped: true, Range: ParagraphTimeRange{Start: item.Position, Length: item.Length}}
}

// lineIDSeparator matches internal/lineidentity.ComposeLineID/ParseLineID's own scheme exactly (an entity id
// never contains "@": docs/architecture/manuscript-line-identity.md), so a real stamp this package reads from a
// saved project parses identically here and there.
const lineIDSeparator = "@"

func composeLineID(entityID, sourceSHA256 string) string {
	return entityID + lineIDSeparator + sourceSHA256
}

func parseLineID(lineID string) (entityID, sourceSHA256 string, ok bool) {
	at := strings.LastIndex(lineID, lineIDSeparator)
	if at <= 0 || at == len(lineID)-1 {
		return "", "", false
	}
	return lineID[:at], lineID[at+1:], true
}
