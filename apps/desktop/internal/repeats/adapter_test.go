package repeats

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

func TestToFindingsSkipsGroupsWithFewerThanTwoMembers(t *testing.T) {
	groups := []Group{
		{ID: 0, FirstUnit: 0, LastUnit: 3, Members: []Member{{ItemGUID: "{A}", TakeGUID: "{T1}", Coverage: 1, Quality: 1}}},
	}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"})

	if len(out) != 0 {
		t.Fatalf("want 0 findings for a singleton group, got %d", len(out))
	}
}

func TestToFindingsClassifiesAnExactCopyRegardlessOfCoverage(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "a.wav", Coverage: 0.4, Quality: 0.9, ExactCopyGroup: "EC0"},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"})

	if len(out) != 1 {
		t.Fatalf("want 1 finding, got %d", len(out))
	}
	f := out[0]
	if f.Category != findings.CategoryDuplicateRead {
		t.Fatalf("want category duplicate_read for an exact copy, got %q", f.Category)
	}
	if f.Evidence["kind"] != "exact_copy" {
		t.Fatalf("want evidence.kind exact_copy, got %v", f.Evidence["kind"])
	}
}

func TestToFindingsClassifiesFullCoverageAsARestartDuplicateRead(t *testing.T) {
	groups := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "a.wav", Coverage: 1.0, Quality: 0.9},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "b.wav", Coverage: 0.95, Quality: 0.8},
		},
	}}

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"})

	f := out[0]
	if f.Category != findings.CategoryDuplicateRead || f.Evidence["kind"] != "restart" {
		t.Fatalf("want duplicate_read/restart, got category=%q kind=%v", f.Category, f.Evidence["kind"])
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

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"})

	f := out[0]
	if f.Category != findings.CategoryPickup || f.Evidence["kind"] != "pickup" {
		t.Fatalf("want pickup/pickup, got category=%q kind=%v", f.Category, f.Evidence["kind"])
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

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"})

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

	out := ToFindings(groups, findings.Project{Path: "P"}, findings.Manuscript{ChapterID: "c1"})

	f := out[0]
	want := (0.8 + 0.6) / 2
	if f.Confidence != want {
		t.Fatalf("want confidence %.3f, got %.3f", want, f.Confidence)
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

	out := ToFindings(groups, findings.Project{Path: "P", OutputPath: "out"}, findings.Manuscript{ChapterID: "c1", ChapterTitle: "Chapter One"})

	for _, f := range out {
		if err := f.Validate(); err != nil {
			t.Fatalf("Validate: %v", err)
		}
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

	idA := ToFindings([]Group{groupA}, proj, man)[0].ID
	idAReordered := ToFindings([]Group{groupAReordered}, proj, man)[0].ID
	idB := ToFindings([]Group{groupB}, proj, man)[0].ID

	if idA != idAReordered {
		t.Fatalf("want the same ID regardless of member order, got %q vs %q", idA, idAReordered)
	}
	if idA == idB {
		t.Fatal("want a different ID when the group's members differ")
	}
}
