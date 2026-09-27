package production

import (
	"testing"
	"time"
)

func session(chapterID, start, end string) Session {
	startedAt, err := time.Parse(time.RFC3339, start)
	if err != nil {
		panic(err)
	}
	s := Session{ID: "x", ChapterID: chapterID, Stage: "recording", StartedAt: startedAt, Source: SourceManual}
	if end != "" {
		endedAt, err := time.Parse(time.RFC3339, end)
		if err != nil {
			panic(err)
		}
		s.EndedAt = &endedAt
	}
	return s
}

func TestBurndownIsEmptyWithNoStoppedSession(t *testing.T) {
	if got := Burndown(nil); len(got) != 0 {
		t.Fatalf("want no points, got %v", got)
	}
	running := []Session{session("c-1", "2026-09-01T09:00:00Z", "")}
	if got := Burndown(running); len(got) != 0 {
		t.Fatalf("a running session should log nothing yet, got %v", got)
	}
}

func TestBurndownAddsUpHoursByDayAndRunsCumulatively(t *testing.T) {
	sessions := []Session{
		session("c-1", "2026-09-01T09:00:00Z", "2026-09-01T10:30:00Z"), // 1.5h on day 1
		session("c-2", "2026-09-01T13:00:00Z", "2026-09-01T14:00:00Z"), // 1h on day 1
		session("c-1", "2026-09-03T09:00:00Z", "2026-09-03T11:00:00Z"), // 2h on day 3 (day 2 has none)
	}
	got := Burndown(sessions)
	want := []BurndownPoint{
		{Date: "2026-09-01", HoursLogged: 2.5},
		{Date: "2026-09-02", HoursLogged: 2.5},
		{Date: "2026-09-03", HoursLogged: 4.5},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d points, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("point %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestBurndownIgnoresARunningSessionButKeepsEarlierStoppedOnes(t *testing.T) {
	sessions := []Session{
		session("c-1", "2026-09-01T09:00:00Z", "2026-09-01T10:00:00Z"),
		session("c-1", "2026-09-02T09:00:00Z", ""),
	}
	got := Burndown(sessions)
	if len(got) != 1 || got[0] != (BurndownPoint{Date: "2026-09-01", HoursLogged: 1}) {
		t.Fatalf("want one point for the stopped session only, got %v", got)
	}
}
