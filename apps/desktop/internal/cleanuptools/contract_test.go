package cleanuptools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The CleanupToolsState wire payloads apps/ui needs for its schema and mock (ADR 0069, reaper-automation-follow-
// through PRD Phase 23). "cleanup-tools-idle" is the answer before any launch; "cleanup-tools-launched" is a
// launch REAPER confirmed. runId is time-based (newRunID), so it is fixed here the way renderconfig's is.
func stable(state map[string]any) map[string]any {
	if state["runId"] != nil {
		state["runId"] = "1790000000000000"
	}
	return state
}

func TestContractCleanupToolsIdle(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	contractfile.Check(t, "cleanup-tools-idle", stable(service.Snapshot()))
}

func TestContractCleanupToolsLaunched(t *testing.T) {
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	service := New(Config{SessionDir: session}, client, nil)
	if err := service.Launch("repair_pops_clicks", nil); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	line := "CLEANUP_LAUNCHED|" + runID + "|repair_pops_clicks|" + bridge.PercentEncode("Item: Repair pops/clicks...")
	if err := os.WriteFile(filepath.Join(session, "events.log"), []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "cleanup-tools-launched", stable(service.Snapshot()))
}
