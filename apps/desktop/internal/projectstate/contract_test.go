package projectstate

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The ProjectStateState wire payloads apps/ui needs for its schema and mock (ADR 0069, reaper-automation-follow-
// through PRD Phase 13): "project-state-idle" before any check, "project-state-checked" once REAPER answered a
// change count for a saved project. runId is time-based and the project path a temp folder, so both are fixed here,
// and the saved file's modification time is set.
func stable(t *testing.T, state map[string]any, folder string) any {
	t.Helper()
	if state["runId"] != nil {
		state["runId"] = "1790000000000000"
	}
	portable, err := contractfile.PortablePaths(state, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	return portable
}

func TestContractProjectStateIdle(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	contractfile.Check(t, "project-state-idle", stable(t, service.Snapshot(), t.TempDir()))
}

func TestContractProjectStateChecked(t *testing.T) {
	session, folder := t.TempDir(), t.TempDir()
	rpp := filepath.Join(folder, "Alice.rpp")
	if err := os.WriteFile(rpp, []byte("<REAPER_PROJECT\n>\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	saved := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	if err := os.Chtimes(rpp, saved, saved); err != nil {
		t.Fatal(err)
	}
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	service := New(Config{SessionDir: session}, client, nil)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	line := "PROJECT_STATE|" + runID + "|42|" + bridge.PercentEncode(rpp)
	if err := os.WriteFile(filepath.Join(session, "events.log"), []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "project-state-checked", stable(t, service.Snapshot(), folder))
}
