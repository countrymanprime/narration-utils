package runlog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixedClock(start time.Time) func() time.Time {
	at := start
	return func() time.Time { return at }
}

func newLogger(t *testing.T, maxBytes int64) (*Logger, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "logs", "run.jsonl")
	logger := New(path, maxBytes)
	logger.now = fixedClock(time.Date(2026, 9, 26, 10, 30, 0, 0, time.UTC))
	id := 0
	logger.newID = func() string {
		id++
		return "run-" + strconv.Itoa(id)
	}
	return logger, path
}

func readLines(t *testing.T, path string) []map[string]any {
	t.Helper()
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimRight(string(bytes), "\n"), "\n") {
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

func TestBeginAndEndWriteStartAndEndRecords(t *testing.T) {
	logger, path := newLogger(t, 0)
	run := logger.Begin("transcript_compare", "chapter", "c-0001")
	run.End("ok", "misreads", 3)

	records := readLines(t, path)
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2", len(records))
	}
	start, end := records[0], records[1]

	for _, field := range []string{"ts", "level", "run", "tool", "event", "msg"} {
		if _, ok := start[field]; !ok {
			t.Fatalf("run.start record is missing field %q: %v", field, start)
		}
	}
	if start["event"] != "run.start" || start["run"] != "run-1" || start["tool"] != "transcript_compare" || start["level"] != "info" {
		t.Fatalf("run.start record = %v", start)
	}
	if start["chapter"] != "c-0001" {
		t.Fatalf("run.start record did not carry its attrs: %v", start)
	}
	if end["event"] != "run.end" || end["run"] != "run-1" || end["outcome"] != "ok" || end["misreads"] != float64(3) {
		t.Fatalf("run.end record = %v", end)
	}
	if _, ok := end["duration_ms"]; !ok {
		t.Fatalf("run.end record has no duration: %v", end)
	}
}

func TestDecisionIsDroppedWhenDebugIsOff(t *testing.T) {
	logger, path := newLogger(t, 0)
	run := logger.Begin("guide")
	run.Decision("entity.merge", "merged an entity", "count", 2)
	run.End("ok")

	records := readLines(t, path)
	if len(records) != 2 {
		t.Fatalf("got %d records with debug off, want 2 (start, end): %v", len(records), records)
	}
}

func TestDecisionIsWrittenWhenDebugIsOn(t *testing.T) {
	logger, path := newLogger(t, 0)
	logger.SetDebug(true)
	run := logger.Begin("guide")
	run.Decision("entity.merge", "merged an entity", "count", 2)
	run.End("ok")

	records := readLines(t, path)
	if len(records) != 3 {
		t.Fatalf("got %d records with debug on, want 3: %v", len(records), records)
	}
	decision := records[1]
	if decision["level"] != "debug" || decision["event"] != "entity.merge" || decision["count"] != float64(2) {
		t.Fatalf("decision record = %v", decision)
	}
}

func TestSetDebugTogglesTheLevelWithoutRebuildingTheLogger(t *testing.T) {
	logger, path := newLogger(t, 0)
	run := logger.Begin("guide")
	run.Decision("before", "should be dropped")

	logger.SetDebug(true)
	run.Decision("after", "should be kept")

	logger.SetDebug(false)
	run.Decision("later", "should be dropped again")

	records := readLines(t, path)
	// start + "after"
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2 (start, after): %v", len(records), records)
	}
	if records[1]["event"] != "after" {
		t.Fatalf("kept record = %v, want the one written while debug was on", records[1])
	}
}

func TestNarrationDebugEnvVarForcesDebugAndCannotBeTurnedOff(t *testing.T) {
	t.Setenv("NARRATION_DEBUG", "1")
	path := filepath.Join(t.TempDir(), "logs", "run.jsonl")
	logger := New(path, 0)
	if !logger.DebugEnabled() {
		t.Fatal("NARRATION_DEBUG=1 did not turn debug on")
	}
	logger.SetDebug(false)
	if !logger.DebugEnabled() {
		t.Fatal("SetDebug(false) turned off a debug level forced by NARRATION_DEBUG=1")
	}
}

func TestNilLoggerBeginReturnsANilRunThatDropsEverything(t *testing.T) {
	var logger *Logger
	run := logger.Begin("guide")
	if run != nil {
		t.Fatal("nil Logger.Begin did not return a nil Run")
	}
	run.Decision("event", "msg")
	run.End("ok")
	if run.ID() != "" {
		t.Fatal("nil Run has no id")
	}
}

func TestLogRotatesKeepingTwoBackups(t *testing.T) {
	logger, path := newLogger(t, 400)
	for i := 0; i < 40; i++ {
		run := logger.Begin("tool")
		run.End("ok", "pad", strings.Repeat("x", 20))
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() > 400 {
		t.Fatalf("current log is %d bytes, over the 400 byte cap", info.Size())
	}
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("no first backup after rotation: %v", err)
	}
	if _, err := os.Stat(path + ".2"); err != nil {
		t.Fatalf("no second backup after rotation: %v", err)
	}
	if _, err := os.Stat(path + ".3"); err == nil {
		t.Fatal("rotation must keep only two backups")
	}
}

func TestConcurrentRunsDoNotInterleaveLines(t *testing.T) {
	// A plain New(), not newLogger's test double: newLogger's fake newID/now closures are shared, unsynchronized
	// state, fine for the single-goroutine tests above but not safe to call from 20 goroutines at once. The real
	// newRunID (crypto/rand) has no such state, so this exercises the actual concurrency guarantee (Logger.mu around
	// each write) instead of a race in the test's own fake.
	path := filepath.Join(t.TempDir(), "logs", "run.jsonl")
	logger := New(path, 0)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			run := logger.Begin("tool")
			run.End("ok")
		}()
	}
	wg.Wait()
	records := readLines(t, path)
	if len(records) != 40 {
		t.Fatalf("got %d well-formed records, want 40 (each line parsed as clean JSON, so nothing interleaved)", len(records))
	}
}

func TestDefaultPathSitsBesideHostLog(t *testing.T) {
	t.Setenv("APPDATA", filepath.Join("C:", "Users", "n", "AppData", "Roaming"))
	want := filepath.Join("C:", "Users", "n", "AppData", "Roaming", "narration-utils", "logs", "run.jsonl")
	if got := DefaultPath(); got != want {
		t.Fatalf("DefaultPath = %q, want %q", got, want)
	}
}
