package repeats

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

func TestToFindingsSkipsGroupsWithFewerThanTwoMembers(t *testing.T) {
	groups := []Group{
		{ID: 0, FirstUnit: 0, LastUnit: 3, Members: []Member{{ItemGUID: "{A}", TakeGUID: "{T1}", Coverage: 1, Quality: 1}}},
	}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())

	if len(out) != 0 {
		t.Fatalf("want 0 findings for a singleton group, got %d", len(out))
	}
}

// Q11 recommendation A: an exact byte-identical copy is a pickup-category
// signal (evidence.kind exact_copy), not duplicate_read, regardless of
// coverage or quality - the narrator re-recorded the line, even if the
// bytes came out identical.
func TestToFindingsClassifiesAnExactCopyAsAPickupRegardlessOfCoverage(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "a.wav", Coverage: 0.4, Quality: 0.9, ExactCopyGroup: "EC0"},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())

	if len(out) != 1 {
		t.Fatalf("want 1 finding, got %d", len(out))
	}
	f := out[0]
	if f.Category != findings.CategoryPickup {
		t.Fatalf("want category pickup for an exact copy, got %q", f.Category)
	}
	if f.Evidence["kind"] != "exact_copy" {
		t.Fatalf("want evidence.kind exact_copy, got %v", f.Evidence["kind"])
	}
}

// Full coverage with quality below the near-duplicate threshold is a
// restart (a clean re-read from the top after a stumble or false start,
// still category pickup per Q11 recommendation A).
func TestToFindingsClassifiesFullCoverageBelowQualityThresholdAsARestartPickup(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.95, Quality: 0.8},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())

	f := out[0]
	if f.Category != findings.CategoryPickup || f.Evidence["kind"] != "restart" {
		t.Fatalf("want pickup/restart, got category=%q kind=%v", f.Category, f.Evidence["kind"])
	}
}

// Full coverage with every member's quality at or above the near-duplicate
// threshold is a near-identical re-read: category duplicate_read, per Q11
// recommendation A.
func TestToFindingsClassifiesFullCoverageHighQualityAsANearDuplicateDuplicateRead(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.99},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.98, Quality: 0.98},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())

	f := out[0]
	if f.Category != findings.CategoryDuplicateRead || f.Evidence["kind"] != "near_duplicate" {
		t.Fatalf("want duplicate_read/near_duplicate, got category=%q kind=%v", f.Category, f.Evidence["kind"])
	}
}

func TestToFindingsClassifiesPartialCoverageAsAPickup(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.4, Quality: 0.7},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())

	f := out[0]
	if f.Category != findings.CategoryPickup || f.Evidence["kind"] != "pickup" {
		t.Fatalf("want pickup/pickup, got category=%q kind=%v", f.Category, f.Evidence["kind"])
	}
}

// Custom, narrower thresholds (Q12: layered project settings) change the
// classification outcome for the same evidence, proving the thresholds are
// actually load-bearing and not just plumbed through unused.
func TestToFindingsUsesTheGivenThresholdsNotHardcodedOnes(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 0.85, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.85, Quality: 0.9},
		},
	}}

	// Default thresholds (full coverage 0.9) would call 0.85 coverage
	// partial, hence a pickup.
	defaultOut := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())
	if defaultOut[0].Evidence["kind"] != "pickup" {
		t.Fatalf("want pickup under default thresholds, got %v", defaultOut[0].Evidence["kind"])
	}

	// A looser project-configured full-coverage threshold (0.8) and a
	// near-duplicate quality threshold the members clear (0.85) reclassify
	// the same evidence as a near-duplicate duplicate_read.
	looser := Thresholds{FullCoverage: 0.8, NearDuplicateQuality: 0.85}
	looseOut := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, looser)
	if looseOut[0].Category != findings.CategoryDuplicateRead || looseOut[0].Evidence["kind"] != "near_duplicate" {
		t.Fatalf("want duplicate_read/near_duplicate under looser thresholds, got category=%q kind=%v", looseOut[0].Category, looseOut[0].Evidence["kind"])
	}
}

func TestToFindingsSourceIsTheHighestQualityMember(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.5},
			{ItemGUID: "{B}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 1.0, Quality: 0.9},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())

	f := out[0]
	if f.Source.File != "b.wav" || f.Source.ItemGUID != "{B}" || f.Source.TakeGUID != "{T2}" {
		t.Fatalf("want source from the higher-quality member, got %+v", f.Source)
	}
}

func TestToFindingsConfidenceIsTheAverageMemberQuality(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", Coverage: 1.0, Quality: 0.8},
			{ItemGUID: "{B}", TakeGUID: "{T2}", Coverage: 1.0, Quality: 0.6},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())

	f := out[0]
	want := (0.8 + 0.6) / 2
	if f.Confidence == nil || *f.Confidence != want {
		t.Fatalf("want confidence %.3f, got %v", want, f.Confidence)
	}
	if f.ConfidenceReason == "" {
		t.Fatal("want a non-empty confidence reason")
	}
}

func TestToFindingsProducesRecordsThatPassValidate(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "a.wav", Coverage: 0.4, Quality: 0.9, ExactCopyGroup: "EC0"},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P", OutputPath: "out"}, findings.Manuscript{ChapterID: "c1", ChapterTitle: "Chapter One"}, DefaultThresholds())

	for _, f := range out {
		if err := f.Validate(); err != nil {
			t.Fatalf("Validate: %v", err)
		}
	}
}

func TestToFindingsEvidenceVersionIsNonEmptyAndStableForUnchangedEvidence(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.95, Quality: 0.8},
		},
	}}

	first := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())[0]
	second := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())[0]

	if first.EvidenceVersion == "" {
		t.Fatal("want a non-empty evidence version")
	}
	if first.EvidenceVersion != second.EvidenceVersion {
		t.Fatalf("want a stable evidence version for unchanged evidence, got %q vs %q", first.EvidenceVersion, second.EvidenceVersion)
	}
}

// A re-scan of the same members with different quality (a model upgrade,
// or an ASR re-run) must change EvidenceVersion even though the ID (member
// identity only) stays the same, so findings.Store returns any prior
// decision to unreviewed rather than silently keeping it against moved
// evidence.
func TestToFindingsEvidenceVersionChangesWhenMemberQualityChangesButIDDoesNot(t *testing.T) {
	base := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.95, Quality: 0.8},
		},
	}}
	rescanned := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.5}, // quality moved
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.95, Quality: 0.8},
		},
	}}

	before := ToFindings(base, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())[0]
	after := ToFindings(rescanned, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"}, DefaultThresholds())[0]

	if before.ID != after.ID {
		t.Fatalf("want the same finding ID (same members) regardless of quality drift, got %q vs %q", before.ID, after.ID)
	}
	if before.EvidenceVersion == after.EvidenceVersion {
		t.Fatal("want a different evidence version when a member's quality changes")
	}
}

func TestToFindingsIDIsStableAcrossRescansAndDiffersWhenMembersDiffer(t *testing.T) {
	groupA := Group{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", StartOffset: 0, Length: 4, Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", StartOffset: 0, Length: 4, Coverage: 1.0, Quality: 0.8},
		},
	}
	// Same members, reversed order (as if the sidecar wrote them in a
	// different order on a re-scan) - the ID must not change.
	groupAReordered := Group{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{groupA.Members[1], groupA.Members[0]},
	}
	groupB := Group{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", StartOffset: 0, Length: 4, Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{C}", TakeGUID: "{T3}", SourceFile: "c.wav", StartOffset: 0, Length: 4, Coverage: 1.0, Quality: 0.8},
		},
	}

	proj := findings.Project{Path: "P"}
	man := findings.Manuscript{ChapterID: "c1"}

	idA := ToFindings([]Group{groupA}, proj, man, DefaultThresholds())[0].ID
	idAReordered := ToFindings([]Group{groupAReordered}, proj, man, DefaultThresholds())[0].ID
	idB := ToFindings([]Group{groupB}, proj, man, DefaultThresholds())[0].ID

	if idA != idAReordered {
		t.Fatalf("want the same ID regardless of member order, got %q vs %q", idA, idAReordered)
	}
	if idA == idB {
		t.Fatal("want a different ID when the group's members differ")
	}
}
