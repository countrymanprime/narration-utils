package retakelanes

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

func TestPickRecordsWhichLaneWasChosenAndWhy(t *testing.T) {
	service, _ := testService(t)
	project := fixture(t, "fixed-lanes.rpp")
	retake := retakeB(t, project)

	path := filepath.Join(t.TempDir(), "run.jsonl")
	logger := runlog.New(path, 0)
	logger.SetDebug(true)
	run := logger.Begin("retake_lane_pick")

	if err := service.Pick(project, "line-000004", retake.ItemGUID, run); err != nil {
		t.Fatal(err)
	}

	records := decisionRecords(t, path, "lane.chosen")
	if len(records) != 1 {
		t.Fatalf("got %d lane.chosen records, want 1: %v", len(records), records)
	}
	record := records[0]
	if record["level"] != "debug" || record["track_name"] != "B - retakes on lanes" || record["item_guid"] != retake.ItemGUID {
		t.Fatalf("decision record = %v", record)
	}
	if count, ok := record["candidate_count"].(float64); !ok || count < 1 {
		t.Fatalf("decision record's candidate_count = %v, want a positive count", record["candidate_count"])
	}
}

func TestPickRecordsNothingWhenDebugIsOff(t *testing.T) {
	service, _ := testService(t)
	project := fixture(t, "fixed-lanes.rpp")
	retake := retakeB(t, project)

	path := filepath.Join(t.TempDir(), "run.jsonl")
	logger := runlog.New(path, 0)
	run := logger.Begin("retake_lane_pick")

	if err := service.Pick(project, "line-000004", retake.ItemGUID, run); err != nil {
		t.Fatal(err)
	}

	if records := decisionRecords(t, path, "lane.chosen"); len(records) != 0 {
		t.Fatalf("got %d lane.chosen records with debug off, want 0: %v", len(records), records)
	}
}
