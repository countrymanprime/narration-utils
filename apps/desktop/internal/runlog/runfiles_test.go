package runlog

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestStderrWriterAppendsToTheRunsOwnFile(t *testing.T) {
	logger, path := newLogger(t, 0)
	run := logger.Begin("transcript_compare")
	writer := run.StderrWriter()
	if _, err := writer.Write([]byte("line one\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("line two\n")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	stderrPath := filepath.Join(filepath.Dir(path), "runs", run.ID()+".stderr.jsonl")
	got, err := os.ReadFile(stderrPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "line one\nline two\n" {
		t.Fatalf("stderr file = %q", got)
	}
}

func TestNilRunStderrWriterDiscardsSilently(t *testing.T) {
	var run *Run
	writer := run.StderrWriter()
	if _, err := writer.Write([]byte("dropped")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestLevelReadsLiveFromTheSharedLevelVar(t *testing.T) {
	logger, _ := newLogger(t, 0)
	run := logger.Begin("guide")
	if got := run.Level(); got != "info" {
		t.Fatalf("Level() = %q before SetDebug, want info", got)
	}
	logger.SetDebug(true)
	if got := run.Level(); got != "debug" {
		t.Fatalf("Level() = %q after SetDebug(true), want debug", got)
	}
	if got := (*Run)(nil).Level(); got != "info" {
		t.Fatalf("nil Run Level() = %q, want info", got)
	}
}

func TestPruneRunFilesKeepsTheNewestUpToTheCountLimit(t *testing.T) {
	logger, path := newLogger(t, 0)
	runsDir := filepath.Join(filepath.Dir(path), "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < maxRunFiles+5; i++ {
		name := filepath.Join(runsDir, "run-"+strconv.Itoa(i)+".stderr.jsonl")
		if err := os.WriteFile(name, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		modTime := base.Add(time.Duration(i) * time.Minute)
		if err := os.Chtimes(name, modTime, modTime); err != nil {
			t.Fatal(err)
		}
	}
	// All files land within minutes of each other, so fixing "now" just after the last one keeps every file well
	// inside the 7-day age limit — this test is only exercising the count limit, not the age one.
	logger.now = fixedClock(base.Add(time.Duration(maxRunFiles+5) * time.Minute))

	logger.pruneRunFiles(runsDir)

	entries, err := os.ReadDir(runsDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != maxRunFiles {
		t.Fatalf("got %d files after pruning, want %d", len(entries), maxRunFiles)
	}
	// The oldest 5 (run-0 .. run-4) must be gone; the newest maxRunFiles must remain.
	if _, err := os.Stat(filepath.Join(runsDir, "run-0.stderr.jsonl")); err == nil {
		t.Fatal("the oldest run file should have been pruned by count")
	}
	if _, err := os.Stat(filepath.Join(runsDir, "run-"+strconv.Itoa(maxRunFiles+4)+".stderr.jsonl")); err != nil {
		t.Fatal("the newest run file should have survived pruning")
	}
}

func TestPruneRunFilesDropsFilesOlderThanTheAgeLimitEvenUnderTheCountLimit(t *testing.T) {
	logger, path := newLogger(t, 0)
	runsDir := filepath.Join(filepath.Dir(path), "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fresh := filepath.Join(runsDir, "fresh.stderr.jsonl")
	stale := filepath.Join(runsDir, "stale.stderr.jsonl")
	for _, name := range []string{fresh, stale} {
		if err := os.WriteFile(name, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	if err := os.Chtimes(fresh, now.Add(-time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(stale, now.Add(-8*24*time.Hour), now.Add(-8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	logger.now = fixedClock(now)

	logger.pruneRunFiles(runsDir)

	if _, err := os.Stat(fresh); err != nil {
		t.Fatal("a file within 7 days should survive even though only two files exist")
	}
	if _, err := os.Stat(stale); err == nil {
		t.Fatal("a file older than 7 days should be pruned even though the count limit was not reached")
	}
}

func TestWithRunAndFromContextRoundTrip(t *testing.T) {
	logger, _ := newLogger(t, 0)
	run := logger.Begin("guide")
	ctx := WithRun(context.Background(), run)
	if got := FromContext(ctx); got != run {
		t.Fatalf("FromContext returned %v, want the same run", got)
	}
	if got := FromContext(context.Background()); got != nil {
		t.Fatalf("FromContext on a plain context = %v, want nil", got)
	}
}
