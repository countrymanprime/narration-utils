package cleanuptools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

// decisionRecords reads path's JSON lines and returns the ones whose event field is want.
func decisionRecords(t *testing.T, path, want string) []map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var matches []map[string]any
	for _, line := range strings.Split(strings.TrimRight(string(data), "\n"), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("line %q is not valid JSON: %v", line, err)
		}
		if record["event"] == want {
			matches = append(matches, record)
		}
	}
	return matches
}

func TestLaunchRecordsWhichActionMatched(t *testing.T) {
	service, _ := testService(t)

	path := filepath.Join(t.TempDir(), "run.jsonl")
	logger := runlog.New(path, 0)
	logger.SetDebug(true)
	run := logger.Begin("cleanup_tool_launch")

	if err := service.Launch("magnolius_declick", run); err != nil {
		t.Fatal(err)
	}

	records := decisionRecords(t, path, "tool.matched")
	if len(records) != 1 {
		t.Fatalf("got %d tool.matched records, want 1: %v", len(records), records)
	}
	if record := records[0]; record["level"] != "debug" || record["tool_key"] != "magnolius_declick" {
		t.Fatalf("decision record = %v", record)
	}
}

func TestLaunchRecordsNothingForAnUnknownTool(t *testing.T) {
	service, _ := testService(t)

	path := filepath.Join(t.TempDir(), "run.jsonl")
	logger := runlog.New(path, 0)
	logger.SetDebug(true)
	run := logger.Begin("cleanup_tool_launch")

	if err := service.Launch("not_a_real_tool", run); err == nil {
		t.Fatal("expected an error for an unknown tool")
	}

	if records := decisionRecords(t, path, "tool.matched"); len(records) != 0 {
		t.Fatalf("got %d tool.matched records for an unknown tool, want 0: %v", len(records), records)
	}
}
