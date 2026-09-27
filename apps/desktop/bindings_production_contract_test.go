package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// ProductionPlan's, ProductionSetDeadline's and ProductionSaveMilestones's payload (production-tracking.prd.md Phase 3):
// the empty plan of a project that has set nothing, then one with a deadline, an amount and two milestones.
func TestContractProductionPlan(t *testing.T) {
	host := hostWithCredits(t)
	empty, err := host.ProductionPlan()
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "production-plan-empty", empty)

	amount := 2400.0
	if _, err := host.ProductionSetDeadline("2026-12-01", &amount); err != nil {
		t.Fatal(err)
	}
	set, err := host.ProductionSaveMilestones([]project.Milestone{
		{Name: "ACX 15-minute checkpoint", DueDate: "2026-10-15", Note: "The rights holder approves the first 15 minutes."},
		{Name: "Final delivery", DueDate: "2026-12-01"},
	})
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "production-plan-set", set)
}
