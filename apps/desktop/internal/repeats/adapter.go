package repeats

import (
	"fmt"
	"sort"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// AnalyzerName is both Finding.Analyzer and the folder name the
// internal/takereview scan service passes to
// findings.Store.SaveAnalyzerFindings, so a saved record's own analyzer
// field always matches the store path it lives under.
const AnalyzerName = "take-review"

// DefaultFullCoverageThreshold is the conservative built-in cutoff between a
// "full" re-read of a manuscript span and a "partial" one (a pickup of only
// part of it), mirrored in config/defaults.json's TakeReview tool (Q12).
// Callers outside the takereview scan service that have no settings.Store
// handy (a unit test, a one-off tool) can use DefaultThresholds().
const DefaultFullCoverageThreshold = 0.9

// DefaultNearDuplicateQualityThreshold is the conservative built-in cutoff
// above which every member of a full-coverage group is judged a clean,
// near-identical re-read (duplicate_read) rather than a restart (pickup):
// see classify's doc comment for the Q11 category mapping this decides.
const DefaultNearDuplicateQualityThreshold = 0.97

// Thresholds are the Q12 detection thresholds a caller resolves from
// layered project settings (see internal/takereview) and passes in, so this
// package stays independent of the settings store and easy to unit-test.
type Thresholds struct {
	// FullCoverage is the minimum Member.Coverage for a read to count as a
	// full re-read of the group's span rather than a partial pickup.
	FullCoverage float64
	// NearDuplicateQuality is the minimum Member.Quality every member of a
	// full-coverage group must reach to be judged a near-identical re-read
	// (duplicate_read) rather than a restart (pickup).
	NearDuplicateQuality float64
}

// DefaultThresholds returns the conservative built-in cutoffs, for callers
// with no settings.Store to resolve Q12's layered thresholds from.
func DefaultThresholds() Thresholds {
	return Thresholds{FullCoverage: DefaultFullCoverageThreshold, NearDuplicateQuality: DefaultNearDuplicateQualityThreshold}
}

// ToFindings adapts parsed repeated-span groups into findings.Finding
// records. Per Q11 (recommendation A, adopted since it was still an open
// question and this phase settles it - see the PRD's Decisions Log), this
// milestone adds no new finding category: every group becomes either
// CategoryPickup (evidence.kind "restart", "pickup" or "exact_copy") or
// CategoryDuplicateRead (evidence.kind "near_duplicate", for a clean,
// near-identical full re-read). manuscript names the chapter the groups
// were aligned against; project identifies where the finding came from. A
// group with fewer than 2 members is not a repeat and is skipped
// (defensive: the sidecar's own group_repeated_spans() never emits one).
//
// This is intentionally a *thin* adapter: it has no target item (the
// narrator picks one explicitly, per Q4/Q8), so SuggestedAction carries no
// parameters yet, and Source is only ever the group's best-quality member
// (a convenience for display, not a claim about which member is "right").
// Full per-member Source/TimeRange resolution against the live project
// model, and wiring these findings into a findings store, are the
// internal/takereview scan service's job (phase 4) - this function stays
// independent of both so it can be unit-tested and reused.
func ToFindings(groups []Group, project findings.Project, manuscript findings.Manuscript, thresholds Thresholds) []findings.Finding {
	out := make([]findings.Finding, 0, len(groups))
	for _, g := range groups {
		if len(g.Members) < 2 {
			continue
		}
		out = append(out, groupFinding(g, project, manuscript, thresholds))
	}
	return out
}

func groupFinding(g Group, project findings.Project, manuscript findings.Manuscript, thresholds Thresholds) findings.Finding {
	primary := g.Members[0]
	for _, m := range g.Members {
		if m.Quality > primary.Quality {
			primary = m
		}
	}

	kind, category := classify(g.Members, thresholds)
	conf, reason := confidence(g.Members)

	members := make([]map[string]any, 0, len(g.Members))
	for _, m := range g.Members {
		members = append(members, map[string]any{
			"item_index":       m.ItemIndex,
			"item_guid":        m.ItemGUID,
			"take_guid":        m.TakeGUID,
			"source_file":      m.SourceFile,
			"source_start":     m.StartOffset,
			"source_length":    m.Length,
			"coverage":         m.Coverage,
			"quality":          m.Quality,
			"exact_copy_group": m.ExactCopyGroup,
		})
	}

	return findings.Finding{
		SchemaVersion: findings.SchemaVersion,
		ID: findings.StableID(AnalyzerName, project.Path, manuscript.ChapterID,
			strconv.Itoa(g.FirstUnit), strconv.Itoa(g.LastUnit), memberKey(g.Members)),
		Analyzer: AnalyzerName,
		Project:  project,
		Source: findings.Source{
			File:     primary.SourceFile,
			ItemGUID: primary.ItemGUID,
			TakeGUID: primary.TakeGUID,
		},
		Manuscript: &manuscript,
		Category:   category,
		Severity:   findings.SeverityInfo,
		Confidence: &conf,
		// EvidenceVersion hashes the classification-relevant evidence (kind
		// and each member's own coverage/quality), not just which members
		// make up the group (that's the ID). A re-scan that finds the same
		// members but a different quality or coverage - a model upgrade, a
		// changed threshold changing kind - returns any existing decision
		// to unreviewed (findings.Store.applyDecision) rather than
		// silently keeping a narrator's call against evidence that moved,
		// per the findings contract and RD-1's evidence-version mechanism.
		EvidenceVersion:  evidenceVersion(kind, g.Members),
		ConfidenceReason: reason,
		Evidence: map[string]any{
			"kind":               kind,
			"matched_span_first": g.FirstUnit,
			"matched_span_last":  g.LastUnit,
			"members":            members,
		},
		SuggestedAction: &findings.SuggestedAction{
			Kind:                 "create_take",
			RequiresConfirmation: true,
			// No target item or source range is proposed yet: the
			// narrator chooses the target explicitly (Q4/Q8); ranked
			// suggestions over this same evidence are phase 5/6 UI work.
		},
		Review: findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}

// classify maps a group's members onto the fixed category list, per Q11
// recommendation A (adopted this phase): category pickup covers
// evidence.kind "restart", "pickup" and "exact_copy" - every case where the
// narrator re-recorded the line, whether byte-identical, a clean restart
// from the top, or only part of the span - and category duplicate_read is
// reserved for a "near-identical re-read": every member fully covers the
// span (no restart from a stumble or false start distinguishes them) and
// every member's own manuscript match quality is high enough that the
// reads are, in effect, duplicates of each other rather than a correction.
// An exact byte-identical copy is the strongest signal and wins regardless
// of coverage or quality; a group with any partial-coverage member is a
// pickup (only part of the span was re-recorded) regardless of quality.
func classify(members []Member, thresholds Thresholds) (kind string, category findings.Category) {
	hasExactCopy := false
	allFullCoverage := true
	allHighQuality := true
	for _, m := range members {
		if m.ExactCopyGroup != "" {
			hasExactCopy = true
		}
		if m.Coverage < thresholds.FullCoverage {
			allFullCoverage = false
		}
		if m.Quality < thresholds.NearDuplicateQuality {
			allHighQuality = false
		}
	}
	switch {
	case hasExactCopy:
		return "exact_copy", findings.CategoryPickup
	case !allFullCoverage:
		return "pickup", findings.CategoryPickup
	case allHighQuality:
		return "near_duplicate", findings.CategoryDuplicateRead
	default:
		return "restart", findings.CategoryPickup
	}
}

// confidence averages member match quality (the fraction of aligned
// tokens that matched the manuscript exactly, from the sidecar's diff) -
// a simple, reproducible, explainable stand-in until phase 4 calibrates
// against the annotated set (PRD Success Metrics). This is a confidence in
// the *grouping itself*, not a ranking of which take is better (Q9: no
// composite score).
func confidence(members []Member) (float64, string) {
	sum := 0.0
	for _, m := range members {
		sum += m.Quality
	}
	avg := sum / float64(len(members))
	return avg, fmt.Sprintf(
		"average of %d member(s)' alignment match quality (fraction of aligned tokens that matched the manuscript exactly)",
		len(members),
	)
}

// memberKey gives StableID something derived from every member, sorted for
// determinism regardless of the sidecar's own member ordering, so a
// re-scan with unchanged evidence yields the same finding ID (per the
// findings contract) and two groups that happen to cover the same span
// but come from different takes don't collide.
func memberKey(members []Member) string {
	keys := make([]string, 0, len(members))
	for _, m := range members {
		keys = append(keys, fmt.Sprintf("%s:%s:%.3f:%.3f", m.ItemGUID, m.TakeGUID, m.StartOffset, m.Length))
	}
	sort.Strings(keys)
	out := ""
	for _, k := range keys {
		out += k + ";"
	}
	return out
}

// evidenceVersion hashes the part of a group's evidence that can change
// between re-scans of the *same* members (classification kind, and each
// member's own coverage and quality), sorted the same way memberKey is for
// determinism regardless of the sidecar's member ordering. It deliberately
// excludes identity (item/take GUIDs, offsets - already in the ID) and any
// narrator-facing text, since only a material change to the evidence
// itself should return a decision to unreviewed.
func evidenceVersion(kind string, members []Member) string {
	keys := make([]string, 0, len(members))
	for _, m := range members {
		keys = append(keys, fmt.Sprintf("%s:%s:%.3f:%.3f", m.ItemGUID, m.TakeGUID, m.Coverage, m.Quality))
	}
	sort.Strings(keys)
	parts := append([]string{kind}, keys...)
	return findings.StableID(AnalyzerName, parts...)
}
