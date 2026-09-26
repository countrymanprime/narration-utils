package runlog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func linesOf(t *testing.T, path string) []map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimRight(string(data), "\n"), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("line %q is not valid JSON: %v", line, err)
		}
		records = append(records, record)
	}
	return records
}

func TestLastRunIDReturnsTheMostRecentRunAndEmptyForAFreshLog(t *testing.T) {
	logger, _ := newLogger(t, 0)
	if id, err := logger.LastRunID(); err != nil || id != "" {
		t.Fatalf("LastRunID on a fresh log = %q, %v", id, err)
	}
	logger.Begin("guide").End("ok")
	second := logger.Begin("transcript_compare")
	second.End("ok")
	if id, err := logger.LastRunID(); err != nil || id != second.ID() {
		t.Fatalf("LastRunID = %q, %v, want %q", id, err, second.ID())
	}
}

func TestExportDiagnosticsByRunIDKeepsOnlyThatRunsRecordsAndItsStderr(t *testing.T) {
	logger, path := newLogger(t, 0)
	logger.SetDebug(true)
	other := logger.Begin("guide")
	other.Decision("entity.merge", "merged")
	other.End("ok")
	target := logger.Begin("transcript_compare")
	target.Decision("align.window", "chose a window")
	target.End("ok")

	if _, err := target.StderrWriter().Write([]byte("sidecar line one\n")); err != nil {
		t.Fatal(err)
	}

	dest := filepath.Join(t.TempDir(), "diagnostics.jsonl")
	written, err := logger.ExportDiagnostics(DiagnosticsScope{RunID: target.ID()}, dest)
	if err != nil {
		t.Fatal(err)
	}
	if written != 4 { // run.start, align.window, run.end, plus the one stderr line
		t.Fatalf("wrote %d lines, want 4", written)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("got %d lines, want 4: %q", len(lines), lines)
	}
	for _, line := range lines[:3] {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("line %q is not valid JSON: %v", line, err)
		}
		if run, ok := record["run"]; ok && run != target.ID() {
			t.Fatalf("record from another run leaked into the export: %v", record)
		}
	}
	if lines[3] != "sidecar line one" {
		t.Fatalf("last line = %q, want the run's own stderr line", lines[3])
	}

	_ = path
}

func TestExportDiagnosticsByWindowKeepsOnlyRecentRecords(t *testing.T) {
	logger, _ := newLogger(t, 0)
	base := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)

	logger.now = fixedClock(base.Add(-time.Hour))
	old := logger.Begin("guide")
	old.End("ok")

	logger.now = fixedClock(base)
	recent := logger.Begin("transcript_compare")
	recent.End("ok")

	dest := filepath.Join(t.TempDir(), "diagnostics.jsonl")
	written, err := logger.ExportDiagnostics(DiagnosticsScope{Since: 30 * time.Minute}, dest)
	if err != nil {
		t.Fatal(err)
	}
	if written != 2 {
		t.Fatalf("wrote %d lines, want 2 (the recent run's start and end)", written)
	}
	for _, record := range linesOf(t, dest) {
		if record["run"] != recent.ID() {
			t.Fatalf("an old record leaked into the window export: %v", record)
		}
	}
	_ = old
}

func TestExportDiagnosticsOnAFreshLogWritesAnEmptyFile(t *testing.T) {
	logger, _ := newLogger(t, 0)
	dest := filepath.Join(t.TempDir(), "diagnostics.jsonl")
	written, err := logger.ExportDiagnostics(DiagnosticsScope{RunID: "no-such-run"}, dest)
	if err != nil {
		t.Fatal(err)
	}
	if written != 0 {
		t.Fatalf("wrote %d lines for an unknown run, want 0", written)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Fatalf("expected the diagnostics file to exist even when empty: %v", err)
	}
}

func TestNilLoggerDiagnosticsAreNoOps(t *testing.T) {
	var logger *Logger
	if id, err := logger.LastRunID(); err != nil || id != "" {
		t.Fatalf("nil Logger LastRunID = %q, %v", id, err)
	}
	written, err := logger.ExportDiagnostics(DiagnosticsScope{}, filepath.Join(t.TempDir(), "d.jsonl"))
	if err != nil || written != 0 {
		t.Fatalf("nil Logger ExportDiagnostics = %d, %v", written, err)
	}
}
