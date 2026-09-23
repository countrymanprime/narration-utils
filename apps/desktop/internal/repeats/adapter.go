package repeats

import (
	"fmt"
	"sort"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

const analyzerName = "repeated_span_detector"

// FullCoverageThreshold is the built-in default cutoff between a "full"
// re-read of a manuscript span and a "partial" one (a pickup of only part
// of it). Q12 recommends thresholds eventually live in layered project
// settings, not a Go or sidecar constant; this is the conservative interim
// default until that phase (5/12) wires settings through.
const FullCoverageThreshold = 0.9

// ToFindings adapts parsed repeated-span groups into findings.Finding
// records. Per Q11, this milestone adds no new finding category: every
// group becomes either CategoryPickup or CategoryDuplicateRead, and
// evidence.kind ("exact_copy", "restart" or "pickup") carries the finer
// distinction. manuscript names the chapter the groups were aligned
// against; project identifies where the finding came from. A group with
// fewer than 2 members is not a repeat and is skipped (defensive: the
// sidecar's own group_repeated_spans() never emits one).
//
// This is intentionally a *thin* adapter: it has no target item (the
// narrator picks one explicitly, per Q4/Q8), so SuggestedAction carries no
// parameters yet, and Source is only ever the group's best-quality member
// (a convenience for display, not a claim about which member is "right").
// Full per-member Source/TimeRange resolution against the live project
// model, and wiring these findings into a findings store, are phase 4/5
// work once that store and the scan service exist - this function is
// deliberately independent of both so it can be unit-tested and reused
// once they land.
func ToFindings(groups []Group, project findings.Project, manuscript findings.Manuscript) []findings.Finding {
	out := make([]findings.Finding, 0, len(groups))
	for _, g := range groups {
		if len(g.Members) < 2 {
			continue
		}
		out = append(out, groupFinding(g, project, manuscript))
	}
	return out
}

func groupFinding(g Group, project findings.Project, manuscript findings.Manuscript) findings.Finding {
	primary := g.Members[0]
	for _, m := range g.Members {
		if m.Quality > primary.Quality {
			primary = m
		}
	}

	kind, category := classify(g.Members)
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
		ID: findings.StableID(analyzerName, project.Path, manuscript.ChapterID,
			strconv.Itoa(g.FirstUnit), strconv.Itoa(g.LastUnit), memberKey(g.Members)),
		Analyzer: analyzerName,
		Project:  project,
		Source: findings.Source{
			File:     primary.SourceFile,
			ItemGUID: primary.ItemGUID,
			TakeGUID: primary.TakeGUID,
		},
		Manuscript:       &manuscript,
		Category:         category,
		Severity:         findings.SeverityInfo,
		Confidence:       &conf,
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

// classify maps a group's members onto the fixed category list (Q11): an
// exact byte-identical copy is the strongest signal and wins regardless of
// coverage; otherwise a group where every member fully covers the span is
// a duplicate_read (a clean re-read or restart), and a group with any
// partial-coverage member is a pickup (only part of the span was
// re-recorded).
func classify(members []Member) (kind string, category findings.Category) {
	hasExactCopy := false
	allFullCoverage := true
	for _, m := range members {
		if m.ExactCopyGroup != "" {
			hasExactCopy = true
		}
		if m.Coverage < FullCoverageThreshold {
			allFullCoverage = false
		}
	}
	switch {
	case hasExactCopy:
		return "exact_copy", findings.CategoryDuplicateRead
	case allFullCoverage:
		return "restart", findings.CategoryDuplicateRead
	default:
		return "pickup", findings.CategoryPickup
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
