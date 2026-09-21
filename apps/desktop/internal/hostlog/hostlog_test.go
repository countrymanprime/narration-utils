package hostlog

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixedClock() func() time.Time {
	at := time.Date(2026, 9, 21, 10, 30, 0, 0, time.UTC)
	return func() time.Time { return at }
}

func newLog(t *testing.T, maxBytes int64) (*Log, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "logs", "host.log")
	log := New(path, maxBytes)
	log.now = fixedClock()
	return log, path
}

func read(t *testing.T, path string) string {
	t.Helper()
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}

func TestReportAppendsOneLinePerCallWithTimeKindAndMessage(t *testing.T) {
	log, path := newLog(t, 0)
	if err := log.Report("wire_invalid", "host.binding Bootstrap did not match its schema: projectName: expected string"); err != nil {
		t.Fatal(err)
	}
	if err := log.Report("window_error", "boom"); err != nil {
		t.Fatal(err)
	}
	want := "2026-09-21T10:30:00.000Z wire_invalid host.binding Bootstrap did not match its schema: projectName: expected string\n" +
		"2026-09-21T10:30:00.000Z window_error boom\n"
	if got := read(t, path); got != want {
		t.Fatalf("log = %q, want %q", got, want)
	}
}

func TestReportKeepsOneEntryOnOneLine(t *testing.T) {
	log, path := newLog(t, 0)
	// A message that carries line breaks (a stack trace) or control characters must not forge a second entry.
	if err := log.Report("unhandled_rejection", "first\r\n2026-01-01T00:00:00.000Z fake_kind forged\x00\x1b[31m"); err != nil {
		t.Fatal(err)
	}
	got := read(t, path)
	if strings.Count(got, "\n") != 1 || strings.ContainsAny(got[:len(got)-1], "\r\x00\x1b") {
		t.Fatalf("entry is not a single clean line: %q", got)
	}
}

func TestReportReplacesAKindThatIsNotASlug(t *testing.T) {
	log, path := newLog(t, 0)
	if err := log.Report("bad kind\nforged", "m"); err != nil {
		t.Fatal(err)
	}
	got := read(t, path)
	if !strings.Contains(got, " unknown_kind m\n") || strings.Count(got, "\n") != 1 {
		t.Fatalf("kind was not replaced: %q", got)
	}
}

func TestReportCapsALongMessage(t *testing.T) {
	log, path := newLog(t, 0)
	if err := log.Report("wire_invalid", strings.Repeat("é", MaxMessageRunes*3)); err != nil {
		t.Fatal(err)
	}
	line := strings.TrimSuffix(read(t, path), "\n")
	message := line[strings.Index(line, "wire_invalid ")+len("wire_invalid "):]
	if got := []rune(message); len(got) != MaxMessageRunes+1 || got[len(got)-1] != '…' {
		t.Fatalf("message length = %d runes, want %d plus an ellipsis", len(got), MaxMessageRunes)
	}
}

func TestLogRotatesToOneBackupAtTheSizeCap(t *testing.T) {
	log, path := newLog(t, 300)
	for i := 0; i < 20; i++ {
		if err := log.Report("wire_invalid", strings.Repeat("x", 40)); err != nil {
			t.Fatal(err)
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() > 300 {
		t.Fatalf("current log is %d bytes, over the 300 byte cap", info.Size())
	}
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("no backup after rotation: %v", err)
	}
	if _, err := os.Stat(path + ".2"); err == nil {
		t.Fatal("rotation must keep a single backup")
	}
}

func TestReportIsSafeForConcurrentCallers(t *testing.T) {
	log, path := newLog(t, 0)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = log.Report("wire_invalid", "concurrent")
		}()
	}
	wg.Wait()
	if lines := strings.Count(read(t, path), "\n"); lines != 20 {
		t.Fatalf("lines = %d, want 20", lines)
	}
}

func TestReportSurfacesAnUnwritableLocation(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	log := New(filepath.Join(blocker, "logs", "host.log"), 0)
	if err := log.Report("wire_invalid", "m"); err == nil {
		t.Fatal("expected an error when the log directory cannot be created")
	}
}

func TestNilLogIsANoOp(t *testing.T) {
	var log *Log
	if err := log.Report("wire_invalid", "m"); err != nil {
		t.Fatalf("nil log returned %v", err)
	}
	if log.Path() != "" {
		t.Fatal("nil log has no path")
	}
}

func TestDefaultPathSitsBesideTheOtherPerUserFiles(t *testing.T) {
	t.Setenv("APPDATA", filepath.Join("C:", "Users", "n", "AppData", "Roaming"))
	want := filepath.Join("C:", "Users", "n", "AppData", "Roaming", "narration-utils", "logs", "host.log")
	if got := DefaultPath(); got != want {
		t.Fatalf("DefaultPath = %q, want %q", got, want)
	}
}

func TestDefaultPathFallsBackToTheUserProfile(t *testing.T) {
	t.Setenv("APPDATA", "")
	t.Setenv("USERPROFILE", filepath.Join("C:", "Users", "n"))
	want := filepath.Join("C:", "Users", "n", "AppData", "Roaming", "narration-utils", "logs", "host.log")
	if got := DefaultPath(); got != want {
		t.Fatalf("DefaultPath = %q, want %q", got, want)
	}
}
