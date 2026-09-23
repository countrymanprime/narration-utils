package renderconfig

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The two RenderConfigState wire payloads apps/ui needs for its schema and mock (ADR 0069, reaper-automation-
// follow-through PRD Phase 11). "render-config-idle" is what the state answers before any run; "render-config-
// success" is a completed configure, so the UI's confirmation ("N files, these names") can be built and reviewed
// against a real shape. runId is time-based (newRunID), so it is fixed here the way pickups/contract_test.go
// fixes its own.
func stable(state map[string]any) map[string]any {
	if state["runId"] != nil {
		state["runId"] = "1790000000000000"
	}
	return state
}

func TestContractRenderConfigIdle(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	contractfile.Check(t, "render-config-idle", stable(service.Snapshot()))
}

func TestContractRenderConfigSuccess(t *testing.T) {
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	service := New(Config{SessionDir: session}, client, nil)
	if err := service.Configure(`C:\Books\Alice\renders`); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	line := "RENDER_CONFIGURED|" + runID + `|C:\Books\Alice\renders|2|C:\Books\Alice\renders\Chapter 1.wav;C:\Books\Alice\renders\Chapter 2.wav`
	if err := os.WriteFile(filepath.Join(session, "events.log"), []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "render-config-success", stable(service.Snapshot()))
}
