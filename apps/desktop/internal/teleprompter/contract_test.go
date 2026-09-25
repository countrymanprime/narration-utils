package teleprompter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The `teleprompter:state` snapshot the host builds (ADR 0069), pinned for the UI's contract tests. The running snapshot is
// built by relaying the events the Python sidecar's own test pins (teleprompter-events.json) through the real onLine, so
// the two halves of the stream are tied to the same file.
func TestContractIdleState(t *testing.T) {
	service := New(Config{}, nil, nil, nil)
	contractfile.Check(t, "teleprompter-state-idle", service.Snapshot())
}

func TestContractRunningStateFromTheSidecarsOwnEvents(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "teleprompter-events.json"))
	if err != nil {
		t.Fatalf("the sidecar's event file is missing (run the Python contract test with UPDATE_CONTRACTS=1): %v", err)
	}
	var events []json.RawMessage
	if err := json.Unmarshal(bytes, &events); err != nil {
		t.Fatal(err)
	}
	var relayed int
	service := New(Config{}, nil, func(json.RawMessage) { relayed++ }, nil)
	service.state = map[string]any{"phase": "running", "message": "Listening…", "engine": "whisper", "chapter": "c1"}
	for _, event := range events {
		service.onLine(string(event))
	}
	if relayed != len(events) || service.Dropped() != 0 {
		t.Fatalf("relayed %d of %d events, dropped %d: the host must relay every event the sidecar produces", relayed, len(events), service.Dropped())
	}
	contractfile.Check(t, "teleprompter-state-running", service.Snapshot())
}

// The meter's stream (read-aloud-control-bar PRD Phase 4): every `level` the Python sidecar's own test pins
// (teleprompter-level.json) passes the meter's filter unchanged, and the `meter_stopped` events the host adds when a meter
// ends by request and on a failure are pinned for the UI's schema.
func TestContractMeterRelaysTheSidecarsLevelsAndEndsWithMeterStopped(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "teleprompter-level.json"))
	if err != nil {
		t.Fatalf("the sidecar's level file is missing (run the Python contract test with UPDATE_CONTRACTS=1): %v", err)
	}
	var levels []json.RawMessage
	if err := json.Unmarshal(bytes, &levels); err != nil {
		t.Fatal(err)
	}
	var relayed []json.RawMessage
	service := New(Config{}, nil, func(raw json.RawMessage) { relayed = append(relayed, raw) }, nil)
	for _, level := range levels {
		service.onMeterLine(string(level))
	}
	if len(relayed) != len(levels) {
		t.Fatalf("the meter relayed %d of %d levels", len(relayed), len(levels))
	}
	stopped := []map[string]any{
		{"type": meterStoppedType, "error": nil},
		{"type": meterStoppedType, "error": "Could not open the microphone: device not found"},
	}
	contractfile.Check(t, "teleprompter-meter-stopped", stopped)
}
