package takereview

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
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

func debugRunContext(t *testing.T) (context.Context, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "run.jsonl")
	logger := runlog.New(path, 0)
	logger.SetDebug(true)
	return runlog.WithRun(context.Background(), logger.Begin("take_review")), path
}

func TestScanRecordsItemsInScope(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: "SUMMARY|Found 0 repeated-span group(s) across 0 segment(s)\n"}
	scanner := &Scanner{Runner: runner, Store: store}
	ctx, path := debugRunContext(t)

	if _, err := scanner.Scan(ctx, Request{
		Project:        chapterTrackFixture(),
		ProjectPath:    "P",
		ManuscriptPath: "manuscript.json",
		ChapterID:      "c1",
		Scope:          Scope{ChapterTrackName: "Chapter 1"},
		Thresholds:     repeats.DefaultThresholds(),
	}); err != nil {
		t.Fatalf("Scan: %v", err)
	}

	records := decisionRecords(t, path, "scan.scope")
	if len(records) != 1 {
		t.Fatalf("got %d scan.scope records, want 1: %v", len(records), records)
	}
	if count, ok := records[0]["segment_count"].(float64); !ok || count < 1 {
		t.Fatalf("scan.scope record's segment_count = %v", records[0]["segment_count"])
	}
	if records := decisionRecords(t, path, "scan.skipped"); len(records) != 0 {
		t.Fatalf("got %d scan.skipped records for an in-scope scan, want 0: %v", len(records), records)
	}
}

func TestScanRecordsItemsSkippedWithTheReason(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: "should not be read"}
	scanner := &Scanner{Runner: runner, Store: store}
	ctx, path := debugRunContext(t)

	project := tracks.Project{Tracks: []tracks.Track{{Name: "Chapter 1", Items: []tracks.Item{
		{GUID: "{ITEM-1}", Length: 1, Takes: []tracks.Take{{GUID: "{T1}", SourceFile: "a.wav", PlayRate: 1}}},
	}}}}

	if _, err := scanner.Scan(ctx, Request{
		Project: project, ProjectPath: "P", ManuscriptPath: "m.json", ChapterID: "c1",
		Scope: Scope{ChapterTrackName: "Chapter 1"}, Thresholds: repeats.DefaultThresholds(),
	}); err != nil {
		t.Fatalf("Scan: %v", err)
	}

	records := decisionRecords(t, path, "scan.skipped")
	if len(records) != 1 {
		t.Fatalf("got %d scan.skipped records, want 1: %v", len(records), records)
	}
	record := records[0]
	if segments, ok := record["segment_count"].(float64); !ok || segments != 1 {
		t.Fatalf("scan.skipped record's segment_count = %v, want 1", record["segment_count"])
	}
	if minimum, ok := record["minimum"].(float64); !ok || minimum != float64(minRepeatableSegments) {
		t.Fatalf("scan.skipped record's minimum = %v, want %d", record["minimum"], minRepeatableSegments)
	}
}
