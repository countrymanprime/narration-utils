package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/production"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// The production plan bindings (production-tracking.prd.md Phase 3): deadline, contracted amount and milestones on the
// project manifest.

func decodePlan(t *testing.T, encoded string) production.Plan {
	t.Helper()
	var plan production.Plan
	decodeInto(t, encoded, &plan)
	return plan
}

func TestProductionPlanIsEmptyForAProjectThatHasSetNothing(t *testing.T) {
	host := hostWithCredits(t)
	encoded, err := host.ProductionPlan()
	if err != nil {
		t.Fatal(err)
	}
	plan := decodePlan(t, encoded)
	if plan.Deadline != nil || plan.ContractedAmount != nil || plan.Milestones == nil || len(plan.Milestones) != 0 {
		t.Fatalf("want an empty plan, got %s", encoded)
	}
}

func TestProductionSetDeadlineStoresItOnTheManifestAndClearsIt(t *testing.T) {
	host := hostWithCredits(t)
	amount := 1800.0
	encoded, err := host.ProductionSetDeadline(" 2026-12-01 ", &amount)
	if err != nil {
		t.Fatal(err)
	}
	plan := decodePlan(t, encoded)
	if plan.Deadline == nil || *plan.Deadline != "2026-12-01" || plan.ContractedAmount == nil || *plan.ContractedAmount != 1800 {
		t.Fatalf("unexpected answer: %s", encoded)
	}
	manifest, ok, err := project.Load(host.persist, host.config.projectFolder)
	if err != nil || !ok || manifest.Deadline != "2026-12-01" || *manifest.ContractedAmount != 1800 {
		t.Fatalf("want it on the manifest, got %+v ok=%v err=%v", manifest, ok, err)
	}

	encoded, err = host.ProductionSetDeadline("", nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan := decodePlan(t, encoded); plan.Deadline != nil || plan.ContractedAmount != nil {
		t.Fatalf("want both cleared, got %s", encoded)
	}
}

func TestProductionSetDeadlineRefusesABadDateOrAmountAndWritesNothing(t *testing.T) {
	host := hostWithCredits(t)
	negative := -5.0
	if _, err := host.ProductionSetDeadline("2026-02-30", nil); err == nil {
		t.Fatal("want an impossible date refused")
	}
	if _, err := host.ProductionSetDeadline("2026-12-01", &negative); err == nil {
		t.Fatal("want a negative amount refused")
	}
	if manifest, ok, _ := project.Load(host.persist, host.config.projectFolder); ok && (manifest.Deadline != "" || manifest.ContractedAmount != nil) {
		t.Fatalf("a refused call must write nothing: %+v", manifest)
	}
}

func TestProductionSaveMilestonesReplacesTheListInOrder(t *testing.T) {
	host := hostWithCredits(t)
	encoded, err := host.ProductionSaveMilestones([]project.Milestone{
		{Name: "ACX 15-minute checkpoint", DueDate: "2026-10-15", Note: "rights holder approves"},
		{Name: "Final delivery", DueDate: "2026-12-01"},
	})
	if err != nil {
		t.Fatal(err)
	}
	plan := decodePlan(t, encoded)
	if len(plan.Milestones) != 2 || plan.Milestones[0].Name != "ACX 15-minute checkpoint" || plan.Milestones[1].DueDate != "2026-12-01" {
		t.Fatalf("unexpected answer: %s", encoded)
	}

	if _, err := host.ProductionSaveMilestones([]project.Milestone{{Name: "", DueDate: "2026-10-15"}}); err == nil {
		t.Fatal("want a milestone with no name refused")
	}
	reread, err := host.ProductionPlan()
	if err != nil {
		t.Fatal(err)
	}
	if plan := decodePlan(t, reread); len(plan.Milestones) != 2 {
		t.Fatalf("a refused save must keep the previous list, got %s", reread)
	}

	encoded, err = host.ProductionSaveMilestones(nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan := decodePlan(t, encoded); len(plan.Milestones) != 0 || plan.Milestones == nil {
		t.Fatalf("want an empty list, got %s", encoded)
	}
}

func TestProductionSettingOneFieldKeepsTheOthersAndTheCredits(t *testing.T) {
	host := hostWithExtras(t, 10)
	if _, err := host.CreditsSetStatus("opening", "finalized"); err != nil {
		t.Fatal(err)
	}
	if _, err := host.ProductionSaveMilestones([]project.Milestone{{Name: "Checkpoint", DueDate: "2026-10-15"}}); err != nil {
		t.Fatal(err)
	}
	amount := 10.0
	if _, err := host.ProductionSetDeadline("2026-12-01", &amount); err != nil {
		t.Fatal(err)
	}
	manifest, _, err := project.Load(host.persist, host.config.projectFolder)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Milestones) != 1 || manifest.CreditsStatus["opening"] != "finalized" {
		t.Fatalf("setting the deadline must keep the milestones and credits: %+v", manifest)
	}
}

func TestTheProductionPlanSurvivesClearDerivedData(t *testing.T) {
	host := hostWithExtras(t, 10)
	amount := 2400.0
	if _, err := host.ProductionSetDeadline("2026-12-01", &amount); err != nil {
		t.Fatal(err)
	}
	if _, err := host.ProductionSaveMilestones([]project.Milestone{{Name: "Checkpoint", DueDate: "2026-10-15"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.ManuscriptClearProjectData(true); err != nil {
		t.Fatal(err)
	}
	encoded, err := host.ProductionPlan()
	if err != nil {
		t.Fatal(err)
	}
	plan := decodePlan(t, encoded)
	if plan.Deadline == nil || *plan.Deadline != "2026-12-01" || plan.ContractedAmount == nil || len(plan.Milestones) != 1 {
		t.Fatalf("want the plan to survive Clear, like the credits do, got %s", encoded)
	}
}

func TestProductionPlanBindingsRequireAnOpenProject(t *testing.T) {
	host := NewHost()
	if _, err := host.ProductionPlan(); err == nil {
		t.Fatal("want an error with no project open")
	}
	if _, err := host.ProductionSetDeadline("2026-12-01", nil); err == nil {
		t.Fatal("want an error with no project open")
	}
	if _, err := host.ProductionSaveMilestones(nil); err == nil {
		t.Fatal("want an error with no project open")
	}
}

func TestProductionPlanReadsACorruptManifestAsEmpty(t *testing.T) {
	host := hostWithCredits(t)
	path := project.Path(host.config.projectFolder)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	encoded, err := host.ProductionPlan()
	if err != nil {
		t.Fatal(err)
	}
	if plan := decodePlan(t, encoded); plan.Deadline != nil || len(plan.Milestones) != 0 {
		t.Fatalf("want an empty plan (persist kept the corrupt file aside), got %s", encoded)
	}
}
