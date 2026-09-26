package retakelanes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The RetakeLanesList and RetakeLanesState wire payloads apps/ui needs for its schemas and mock (ADR 0069,
// reaper-automation-follow-through PRD Phase 25). "retake-lanes-list" is the S7 spike project as the binding lists it
// (no paths in it, so nothing to make portable); "retake-lanes-idle" is the state before any pick and
// "retake-lanes-picked" a pick REAPER confirmed. runId is time-based (newRunID), so it is fixed here.
func stable(state map[string]any) map[string]any {
	if state["runId"] != nil {
		state["runId"] = "1790000000000000"
	}
	return state
}

func TestContractRetakeLanesList(t *testing.T) {
	contractfile.Check(t, "retake-lanes-list", Lines(fixture(t, "fixed-lanes.rpp")))
}

func TestContractRetakeLanesIdle(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	contractfile.Check(t, "retake-lanes-idle", stable(service.Snapshot()))
}

func TestContractRetakeLanesPicked(t *testing.T) {
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	service := New(Config{SessionDir: session}, client, nil)
	project := fixture(t, "fixed-lanes.rpp")
	retake := retakeB(t, project)
	if err := service.Pick(project, "line-000004", retake.ItemGUID, nil); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	line := "RETAKE_LANE_PICKED|" + runID + "|line-000004|" + bridge.PercentEncode(retake.ItemGUID) + "|1"
	if err := os.WriteFile(filepath.Join(session, "events.log"), []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "retake-lanes-picked", stable(service.Snapshot()))
}
