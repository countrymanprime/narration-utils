package teleprompter

import (
	"encoding/json"
	"strings"
	"testing"
)

// Pause (read-aloud-control-bar PRD Phase 5, ADR 0248): a `pause`/`resume` line on the control file, a `paused` flag on the
// state, and no auto-stop while paused.

func paused(s *Service) bool {
	value, _ := s.Snapshot()["paused"].(bool)
	return value
}

func controlCommands(t *testing.T, f *fixture) []string {
	t.Helper()
	var commands []string
	for _, line := range strings.Split(strings.TrimRight(controlFileContent(t, f.session), "\n"), "\n") {
		var command map[string]any
		if err := json.Unmarshal([]byte(line), &command); err != nil {
			t.Fatal(err)
		}
		commands = append(commands, command["cmd"].(string))
	}
	return commands
}

func TestPauseAndResumeWriteTheirCommandsAndFlagTheState(t *testing.T) {
	f := newFixture(t, "stream")
	startAndWaitForPosition(t, f)

	if err := f.service.Pause(true); err != nil {
		t.Fatal(err)
	}
	if !paused(f.service) || phase(f.service) != "running" || message(f.service) != pausedMessage {
		t.Fatalf("state after pause = %v", f.service.Snapshot())
	}
	if err := f.service.Pause(false); err != nil {
		t.Fatal(err)
	}

	if paused(f.service) || message(f.service) != listeningMessage {
		t.Fatalf("state after resume = %v", f.service.Snapshot())
	}
	if got := controlCommands(t, f); strings.Join(got, ",") != "pause,resume" {
		t.Fatalf("control commands = %v", got)
	}
}

func TestPausingTwiceWritesOneCommand(t *testing.T) {
	f := newFixture(t, "stream")
	startAndWaitForPosition(t, f)

	for range 2 {
		if err := f.service.Pause(true); err != nil {
			t.Fatal(err)
		}
	}

	if got := controlCommands(t, f); len(got) != 1 {
		t.Fatalf("control commands = %v", got)
	}
}

func TestPauseIsRefusedWithNoSessionRunning(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Pause(true); err == nil {
		t.Fatal("paused with no session")
	}
	if paused(f.service) {
		t.Fatal("the idle state says paused")
	}
}

func TestTheStateIsNotPausedWhenTheSessionEnds(t *testing.T) {
	f := newFixture(t, "stream")
	startAndWaitForPosition(t, f)
	if err := f.service.Pause(true); err != nil {
		t.Fatal(err)
	}

	f.service.Stop()

	waitFor(t, "stopped", func() bool { return phase(f.service) == "stopped" })
	if paused(f.service) {
		t.Fatalf("a stopped session is still paused: %v", f.service.Snapshot())
	}
}

func TestPauseCancelsAPendingAutoStopAndResumeArmsItAgainAtDone(t *testing.T) {
	f, clock := newAutoStopFixture(t, "done")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the auto-stop timer", func() bool { return len(clock.pending()) == 1 })

	if err := f.service.Pause(true); err != nil {
		t.Fatal(err)
	}
	if len(clock.pending()) != 0 {
		t.Fatal("the auto-stop is still armed while paused")
	}
	f.service.onLine(donePosition)
	if len(clock.pending()) != 0 || message(f.service) != pausedMessage {
		t.Fatalf("a done position armed the auto-stop while paused: %q", message(f.service))
	}

	if err := f.service.Pause(false); err != nil {
		t.Fatal(err)
	}
	if len(clock.pending()) != 1 || !strings.Contains(message(f.service), "end of the chapter") {
		t.Fatalf("resuming at done did not arm the auto-stop: %q", message(f.service))
	}
}

func TestStartingASessionIsNeverPaused(t *testing.T) {
	f := newFixture(t, "stream")
	startAndWaitForPosition(t, f)
	if err := f.service.Pause(true); err != nil {
		t.Fatal(err)
	}
	f.service.Stop()
	waitFor(t, "stopped", func() bool { return phase(f.service) == "stopped" })

	startAndWaitForPosition(t, f)

	if paused(f.service) {
		t.Fatal("a new session starts paused")
	}
}
