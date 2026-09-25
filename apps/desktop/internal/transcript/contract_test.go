package transcript

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The payloads the host sends to the UI as `Bootstrap.transcript` and the `transcript:state` event (ADR 0069). The UI's
// contract tests validate these files against its schemas. Volatile values (time, run id) are fixed so the file is stable.
func stable(state map[string]any) map[string]any {
	state["elapsed"] = 12.5
	if state["completedAt"] != nil {
		state["completedAt"] = "2026-09-21T10:00:00Z"
	}
	if state["runId"] != nil {
		state["runId"] = "1789000000000000"
	}
	return state
}

func TestContractIdleState(t *testing.T) {
	service, _ := testService(t)
	contractfile.Check(t, "transcript-idle", stable(service.Snapshot()))
}

func TestContractCompletedStateWithRowsAndAMarkerExport(t *testing.T) {
	service, _ := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"], service.state["projectChangeCount"] = "run-1", "inspecting", 41
	service.Handle([]string{"COMPARE_MARKER", "run-1", "row-1", "MISREAD", "Alice", "alice", "Alyss", "3.5", "2", "Chapter 1", "4", "script context", "audio context", "pending", "", "1.25"})
	service.Handle([]string{"COMPARE_MARKER", "run-1", "row-2", "EXTRA", "Hatter", "hatter", "", "9.25", "3", "Chapter 1", "6", "", "", "existing", "Hatter (marker)", "8.5"})
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "2 discrepancies found.", "2", "0"})
	contractfile.Check(t, "transcript-success", stable(service.Snapshot()))
}
