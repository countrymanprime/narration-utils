package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

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
