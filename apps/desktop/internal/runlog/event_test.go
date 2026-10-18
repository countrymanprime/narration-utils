package runlog

import (
	"log/slog"
	"strings"
	"testing"
)

func TestScrubReplacesPathsAndCutsLongText(t *testing.T) {
	cases := map[string]string{
		`open C:\Users\Count\Documents\Book\Book.rpp failed`:  "open <path> failed",
		`open C:/Users/Count/Book.rpp failed`:                 "open <path> failed",
		"share \x5c\x5cserver\x5cshare\x5cBook\x5cx.wav gone": "share <path> gone",
		`cannot read "/home/ann/books/Novel.docx"`:            `cannot read "<path>`,
		`no path here, 12 ms`:                                 "no path here, 12 ms",
		`ratio 1/2 and a/b stay`:                              "ratio 1/2 and a/b stay",
	}
	for in, want := range cases {
		got := Scrub(in)
		if !strings.HasPrefix(got, want) {
			t.Errorf("Scrub(%q) = %q, want prefix %q", in, got, want)
		}
		if strings.Contains(got, "Count") || strings.Contains(got, "/home/ann") {
			t.Errorf("Scrub(%q) = %q kept the user's name", in, got)
		}
	}
	if got := Scrub(strings.Repeat("x", 1000)); len(got) > maxEventMessage+len("…") {
		t.Errorf("Scrub kept %d bytes", len(got))
	}
}

func TestAppRunEventsShareOneRunIDAndCarryTheEventName(t *testing.T) {
	logger, path := newLogger(t, 0)
	app := logger.App()
	app.Event(slog.LevelInfo, "ui.toast", `saved C:\Users\Count\Book.rpp`)
	app.Event(slog.LevelWarn, "ui.call", "DawLaunch failed")
	records := readLines(t, path)
	if len(records) != 3 { // run.start, then the two events
		t.Fatalf("records = %d, want 3: %v", len(records), records)
	}
	if records[1]["run"] != records[2]["run"] || records[1]["run"] == "" {
		t.Fatalf("events do not share a run id: %v", records)
	}
	if records[1]["event"] != "ui.toast" || records[1]["msg"] != "saved <path>" || records[2]["level"] != "warn" {
		t.Fatalf("records = %v", records)
	}
	if logger.App() != app {
		t.Fatal("App returned a second run")
	}
}

func TestNilLoggerAppRunDropsEvents(t *testing.T) {
	var logger *Logger
	logger.App().Event(slog.LevelInfo, "ui.toast", "x")
}
