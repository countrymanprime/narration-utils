package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
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

// productionHost is an attached project (stagesHost) whose one chapter, c-0001, is in recording.
func productionHost(t *testing.T) *Host {
	t.Helper()
	return stagesHost(t, 5)
}

func TestProductionOverviewReadsTheChaptersTheirReadinessAndTheTimeLog(t *testing.T) {
	host := productionHost(t)
	overview := decodeAnswer(t)(host.ProductionOverview())
	chapters, _ := overview["chapters"].([]any)
	if len(chapters) != 1 {
		t.Fatalf("overview = %v", overview)
	}
	chapter := chapters[0].(map[string]any)
	if chapter["id"] != "c-0001" || chapter["status"] != "recording" || chapter["pfh"] != nil {
		t.Fatalf("chapter = %v", chapter)
	}
	readiness, _ := chapter["readiness"].(map[string]any)
	if readiness == nil || readiness["target"] != "editing" {
		t.Fatalf("readiness = %v, want the stage recommendation's own verdict towards editing", chapter["readiness"])
	}
	if overview["running"] != nil || overview["deadline"] != nil {
		t.Fatalf("overview = %v, want no timer and no deadline yet", overview)
	}
	totals := overview["totals"].(map[string]any)
	if totals["effectiveRate"] != nil || totals["bookPfh"] != nil {
		t.Fatalf("totals = %v, want undefined figures with nothing logged", totals)
	}
}

// A timer is started and stopped only by these two bindings, a second start is refused rather than switching timers,
// and neither touches the chapter's status (PRD success metrics "Timer honesty", "Board never invents a status").
func TestProductionTimerStartsStopsAndRefusesASecondTimer(t *testing.T) {
	host := productionHost(t)
	started := decodeAnswer(t)(host.ProductionStartTimer("c-0001", "recording"))
	if started["status"] != "started" {
		t.Fatalf("start = %v", started)
	}
	refused := decodeAnswer(t)(host.ProductionStartTimer("c-0001", "editing"))
	if refused["status"] != "refused" || refused["reason"] != "timer_running" {
		t.Fatalf("second start = %v, want refused", refused)
	}
	running := decodeAnswer(t)(host.ProductionOverview())["running"].(map[string]any)
	if running["chapterId"] != "c-0001" || running["stage"] != "recording" {
		t.Fatalf("running = %v", running)
	}
	stopped := decodeAnswer(t)(host.ProductionStopTimer())
	if stopped["stopped"] != true || stopped["session"].(map[string]any)["endedAt"] == nil {
		t.Fatalf("stop = %v", stopped)
	}
	again := decodeAnswer(t)(host.ProductionStopTimer())
	if again["stopped"] != false || again["session"] != nil {
		t.Fatalf("second stop = %v, want a no-op", again)
	}
	chapter := decodeAnswer(t)(host.ProductionOverview())["chapters"].([]any)[0].(map[string]any)
	if chapter["status"] != "recording" {
		t.Fatalf("status = %v, want it untouched by the timer", chapter["status"])
	}
	if _, err := os.Stat(filepath.Join(host.config.projectFolder, "narration-utils", "production", "sessions.json")); err != nil {
		t.Fatalf("the time log was not written: %v", err)
	}
}

func TestProductionStartTimerRefusesAChapterTheManuscriptDoesNotHave(t *testing.T) {
	host := productionHost(t)
	if _, err := host.ProductionStartTimer("c-9999", "recording"); err == nil {
		t.Fatal("want an error for an unknown chapter")
	}
	if _, err := host.ProductionStartTimer("c-0001", "mastering"); err == nil {
		t.Fatal("want an error for a stage that is not one of the five")
	}
	if running := decodeAnswer(t)(host.ProductionOverview())["running"]; running != nil {
		t.Fatalf("running = %v, want nothing logged", running)
	}
}

func TestProductionBindingsNeedAProject(t *testing.T) {
	host := NewHost()
	if _, err := host.ProductionOverview(); err == nil {
		t.Fatal("overview: want an error with no project")
	}
	if _, err := host.ProductionStartTimer("c-0001", "recording"); err == nil {
		t.Fatal("start: want an error with no project")
	}
	if _, err := host.ProductionStopTimer(); err == nil {
		t.Fatal("stop: want an error with no project")
	}
}

// ProductionStartTimer's and ProductionStopTimer's answers (ADR 0069). The session id is random hex of 16 characters,
// which Stabilize leaves alone, so it is fixed here.
func TestContractProductionTimer(t *testing.T) {
	host := productionHost(t)
	pin := func(name, encoded string, err error) {
		t.Helper()
		answer := decodeAnswer(t)(encoded, err)
		if session, ok := answer["session"].(map[string]any); ok {
			session["id"] = "0000000000000000"
		}
		stable, err := contractfile.Stabilize(answer)
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, stable)
	}
	encoded, err := host.ProductionStopTimer()
	pin("production-timer-stop-none", encoded, err)
	encoded, err = host.ProductionStartTimer("c-0001", "recording")
	pin("production-timer-started", encoded, err)
	encoded, err = host.ProductionStartTimer("c-0001", "editing")
	pin("production-timer-refused", encoded, err)
	encoded, err = host.ProductionStopTimer()
	pin("production-timer-stopped", encoded, err)
}

// The overview reads the deadline and contracted amount Phase 3 stores on the manifest: the rate becomes defined once an
// amount and some logged time exist, and the deadline appears with the days left.
func TestProductionOverviewReadsThePlanSetOnTheManifest(t *testing.T) {
	host := productionHost(t)
	amount := 1200.0
	if _, err := host.ProductionSetDeadline("2099-01-01", &amount); err != nil {
		t.Fatal(err)
	}
	overview := decodeAnswer(t)(host.ProductionOverview())
	deadline, _ := overview["deadline"].(map[string]any)
	if deadline["date"] != "2099-01-01" || deadline["daysLeft"].(float64) <= 0 {
		t.Fatalf("deadline = %v", overview["deadline"])
	}
	totals := overview["totals"].(map[string]any)
	if totals["contractedAmount"] != 1200.0 || totals["effectiveRate"] != nil {
		t.Fatalf("totals = %v, want the amount set and no rate before any hour is logged", totals)
	}
}
