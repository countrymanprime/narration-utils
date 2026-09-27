package production

import (
	"math"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

func TestCheckDate(t *testing.T) {
	for _, good := range []string{"2026-12-01", " 2027-02-28 ", "2028-02-29"} {
		if got, err := CheckDate(good); err != nil || got != strings.TrimSpace(good) {
			t.Errorf("%q: want accepted, got %q %v", good, got, err)
		}
	}
	for _, bad := range []string{"", "2026-13-01", "2027-02-29", "12/01/2026", "2026-12-01T00:00:00Z", "tomorrow"} {
		if _, err := CheckDate(bad); err == nil {
			t.Errorf("%q: want refused", bad)
		}
	}
}

func TestCheckAmount(t *testing.T) {
	for _, good := range []float64{0, 1250.5} {
		if err := CheckAmount(&good); err != nil {
			t.Errorf("%v: %v", good, err)
		}
	}
	if err := CheckAmount(nil); err != nil {
		t.Errorf("no amount clears it: %v", err)
	}
	for _, bad := range []float64{-1, math.NaN(), math.Inf(1)} {
		if err := CheckAmount(&bad); err == nil {
			t.Errorf("%v: want refused", bad)
		}
	}
}

func TestCleanMilestonesTrimsAndKeepsTheNarratorsOrder(t *testing.T) {
	cleaned, err := CleanMilestones([]project.Milestone{
		{Name: "  Final delivery ", DueDate: "2026-12-01", Note: "  "},
		{Name: "ACX 15-minute checkpoint", DueDate: " 2026-10-15", Note: " send it "},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []project.Milestone{
		{Name: "Final delivery", DueDate: "2026-12-01"},
		{Name: "ACX 15-minute checkpoint", DueDate: "2026-10-15", Note: "send it"},
	}
	if len(cleaned) != 2 || cleaned[0] != want[0] || cleaned[1] != want[1] {
		t.Fatalf("got %+v", cleaned)
	}
	empty, err := CleanMilestones(nil)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("no milestones is an empty list, got %#v %v", empty, err)
	}
}

func TestCleanMilestonesRefusesAMilestoneWithoutANameOrADate(t *testing.T) {
	cases := [][]project.Milestone{
		{{Name: " ", DueDate: "2026-12-01"}},
		{{Name: "Delivery", DueDate: ""}},
		{{Name: "Delivery", DueDate: "2026-02-30"}},
		{{Name: strings.Repeat("n", maxMilestoneName+1), DueDate: "2026-12-01"}},
		{{Name: "Delivery", DueDate: "2026-12-01", Note: strings.Repeat("n", maxMilestoneNote+1)}},
		make([]project.Milestone, maxMilestones+1),
	}
	for i, milestones := range cases {
		if _, err := CleanMilestones(milestones); err == nil {
			t.Errorf("case %d: want refused", i)
		}
	}
}

func TestPlanOfReadsTheManifestFieldsAndIsEmptyWithoutOne(t *testing.T) {
	empty := PlanOf(nil)
	if empty.Deadline != nil || empty.ContractedAmount != nil || empty.Milestones == nil || len(empty.Milestones) != 0 {
		t.Fatalf("want an empty plan, got %#v", empty)
	}
	amount := 900.0
	manifest := &project.Manifest{Deadline: "2026-12-01", ContractedAmount: &amount, Milestones: []project.Milestone{{Name: "A", DueDate: "2026-10-01"}}}
	plan := PlanOf(manifest)
	if plan.Deadline == nil || *plan.Deadline != "2026-12-01" || plan.ContractedAmount == nil || *plan.ContractedAmount != 900 || len(plan.Milestones) != 1 {
		t.Fatalf("unexpected plan: %#v", plan)
	}
	amount = 1
	plan.Milestones[0].Name = "changed"
	if *plan.ContractedAmount != 900 || manifest.Milestones[0].Name != "A" {
		t.Fatal("PlanOf must copy, not alias, the manifest's values")
	}
}
