// This file turns this package's own candidates into findings-contract
// records (Architecture Notes' "Findings shape": "silence_cleanup for all
// three classes, with evidence.class of silence, click or breath... source
// carries item and take GUIDs and file, time_range is project seconds in the
// saved project plus the source-relative range in evidence,
// manuscript.chapter_id is filled from the confirmed mapping, and
// suggested_action is the DX Phase 9 trim or split proposal with
// requires_confirmation: true, parameters only").
package editing

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// analyzerName is this package's findings.Finding.Analyzer value, shared by
// every class this package raises (the class itself is evidence["class"],
// matching DX Phase 9's own silence_cleanup findings shape).
const analyzerName = "editing"

// EmptySpaceFinding builds one silence_cleanup finding for a composed
// empty-space candidate (Phase 3). documentID/chapterID/chapterTitle come
// from the confirmed mapping; policy is echoed as evidence so a narrator
// always sees the threshold in force, matching D10's "every value is
// reported with the findings it raises". The finding's Source names the
// first item the candidate touches (findings.Source holds only one item;
// a candidate spanning several is named fully in evidence["item_guids"]
// instead - a deliberate simplification for a multi-item candidate, since
// the contract's Source has no room for more than one).
func EmptySpaceFinding(documentID, chapterID, chapterTitle string, candidate EmptySpaceCandidate, itemFiles map[string]string, itemTakes map[string]string, policy Policy) findings.Finding {
	primaryItem, primaryTake, primaryFile := "", "", ""
	if len(candidate.ItemGUIDs) > 0 {
		primaryItem = candidate.ItemGUIDs[0]
		primaryTake = itemTakes[primaryItem]
		primaryFile = itemFiles[primaryItem]
	}
	evidenceMap := map[string]any{
		"class": "silence", "boundary": string(candidate.Class),
		"duration_seconds": candidate.Range.length(),
		"item_guids":       candidate.ItemGUIDs,
		"parts":            partsEvidence(candidate.Parts),
	}
	if policy.MaxGapSeconds != nil {
		evidenceMap["max_gap_seconds"] = *policy.MaxGapSeconds
	}
	if policy.HeadMaxSeconds != nil {
		evidenceMap["head_max_seconds"] = *policy.HeadMaxSeconds
	}
	if policy.TailMaxSeconds != nil {
		evidenceMap["tail_max_seconds"] = *policy.TailMaxSeconds
	}

	sourceStart, sourceEnd := sourceRangeOf(candidate)
	confidence := 0.6
	evidenceMap["reason"] = fmt.Sprintf("a %s candidate: %.2f s of empty space (%s); it is cut only once you approve it",
		candidate.Class, candidate.Range.length(), partsSummary(candidate.Parts))

	finding := findings.Finding{
		SchemaVersion: findings.SchemaVersion,
		Analyzer:      analyzerName,
		Source:        findings.Source{File: primaryFile, ItemGUID: primaryItem, TakeGUID: primaryTake},
		TimeRange: &findings.TimeRange{
			Start: candidate.Range.Start, End: candidate.Range.End,
			SourceStart: sourceStart, SourceEnd: sourceEnd,
		},
		Manuscript:       &findings.Manuscript{ChapterID: chapterID, ChapterTitle: chapterTitle},
		Category:         findings.CategorySilenceCleanup,
		Severity:         findings.SeverityInfo,
		Confidence:       &confidence,
		ConfidenceReason: "an empty-space candidate against the narrator's own threshold, not a calibrated score",
		Evidence:         evidenceMap,
		SuggestedAction: &findings.SuggestedAction{
			Kind: "trim_empty_space",
			Parameters: map[string]any{
				"start_seconds": candidate.Range.Start, "end_seconds": candidate.Range.End, "boundary": string(candidate.Class),
			},
			RequiresConfirmation: true,
		},
		Review:          findings.ReviewState{Status: findings.StatusUnreviewed},
		EvidenceVersion: EmptySpaceEvidenceVersion(candidate),
	}
	finding.ID = findings.StableID(analyzerName, documentID, chapterID, "empty_space", finding.EvidenceVersion)
	return finding
}

// sourceRangeOf reports the widest source-relative range a candidate's own
// item_silence parts span, for the finding's TimeRange.SourceStart/SourceEnd
// (a "stale-project fallback" per the findings.TimeRange doc comment). A
// candidate made only of track_gap parts (no item touches it at all) has no
// source-relative range to give, and returns nil, nil.
func sourceRangeOf(candidate EmptySpaceCandidate) (*float64, *float64) {
	var start, end *float64
	for _, part := range candidate.Parts {
		if part.Kind != PartItemSilence {
			continue
		}
		if start == nil || part.SourceStart < *start {
			s := part.SourceStart
			start = &s
		}
		if end == nil || part.SourceEnd > *end {
			e := part.SourceEnd
			end = &e
		}
	}
	return start, end
}

func partsEvidence(parts []CandidatePart) []map[string]any {
	out := make([]map[string]any, len(parts))
	for i, part := range parts {
		entry := map[string]any{"kind": string(part.Kind), "length_seconds": part.Length}
		if part.Kind == PartItemSilence {
			entry["item_guid"] = part.ItemGUID
			entry["source_start_seconds"] = part.SourceStart
			entry["source_end_seconds"] = part.SourceEnd
		}
		out[i] = entry
	}
	return out
}

func partsSummary(parts []CandidatePart) string {
	itemParts, gapParts := 0, 0
	for _, part := range parts {
		if part.Kind == PartItemSilence {
			itemParts++
		} else {
			gapParts++
		}
	}
	switch {
	case itemParts > 0 && gapParts > 0:
		return fmt.Sprintf("%d item silence(s) and %d timeline gap(s) merged", itemParts, gapParts)
	case itemParts > 0:
		return fmt.Sprintf("%d item silence(s)", itemParts)
	default:
		return fmt.Sprintf("%d timeline gap(s)", gapParts)
	}
}

// EmptySpaceEvidenceVersion is Q7 option B's identity for a composed
// empty-space candidate: a hash of its class plus every part's own
// source-relative range (item_silence) or length (track_gap), in order -
// never the played range as a whole, never the item's timeline position, and
// never an analysis parameter (Q7: "excluding parameters, played range and
// item position"). Two runs that find the same audio in the same relative
// place get the same version even if an unrelated item moved, a threshold
// changed, or the candidate's own timeline position shifted because an
// earlier item was trimmed - so a narrator's dismissal survives exactly the
// edits Q7 says it should.
//
// A scoped-down version of Q7 B: the recommendation also asks for "a content
// hash of the region and its margin", which would need re-reading the source
// audio bytes at finding-build time; this package does not do that (an
// honest simplification, not a silent omission - see this package's own
// Phase 3 commit message).
func EmptySpaceEvidenceVersion(candidate EmptySpaceCandidate) string {
	parts := []string{"silence", string(candidate.Class)}
	for _, part := range candidate.Parts {
		if part.Kind == PartItemSilence {
			parts = append(parts, string(part.Kind), part.ItemGUID, formatFloat(part.SourceStart), formatFloat(part.SourceEnd))
		} else {
			parts = append(parts, string(part.Kind), formatFloat(part.Length))
		}
	}
	return hashParts(parts...)
}
