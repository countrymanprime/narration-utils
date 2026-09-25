package bridge

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Punch and roll (teleprompter-manuscript-integration PRD Phase 12, narration_punch.lua): the answers as
// integrations/reaper/tests/punch_test.lua pins them.

func TestPlayPositionAndPunchToAreExperimentalAndRefusedWhileTheSettingIsOff(t *testing.T) {
	actions, client, dir := newActionsSession(t, false)
	fake := startFakeReaper(t, client, dir, func([]string) [][]string { return nil })
	if _, err := actions.PlayPosition(context.Background()); !errors.Is(err, ErrExperimentalOff) {
		t.Errorf("PlayPosition: %v", err)
	}
	if _, err := actions.PunchTo(context.Background(), 42, 3); !errors.Is(err, ErrExperimentalOff) {
		t.Errorf("PunchTo: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if len(fake.commands()) != 0 {
		t.Fatalf("commands were written: %v", fake.commands())
	}
	for _, command := range []string{"play_position", "punch_to"} {
		if !Experimental(command) {
			t.Errorf("%s must stay experimental until the verification pass", command)
		}
	}
}

func TestPlayPositionReadsTheStateBothPositionsAndTheCursor(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"PLAY_POSITION", run(command), "5", "12.500000", "12.375000", "3.000000"}}
	})
	got, err := actions.PlayPosition(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := PlayPosition{Playing: true, Recording: true, Heard: 12.5, Processed: 12.375, Cursor: 3}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if command := fake.commands()[0]; command[1] != "play_position" || len(command) != 3 {
		t.Fatalf("command = %v", command)
	}
}

func TestPunchToSendsTheWordTimeAndPreRollAndReadsWhereTheCursorLanded(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"PUNCHED", run(command), "39.500000"}}
	})
	got, err := actions.PunchTo(context.Background(), 42.5, 3)
	if err != nil || got != 39.5 {
		t.Fatalf("got %v, %v", got, err)
	}
	if command := fake.commands()[0]; command[1] != "punch_to" || command[3] != "42.500000" || command[4] != "3.000000" {
		t.Fatalf("command = %v", command)
	}
}

func TestPunchToRefusesATimeOrPreRollREAPERWouldRefuseWithoutSendingIt(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func([]string) [][]string { return nil })
	for _, c := range [][2]float64{{-1, 3}, {10, -1}, {10, 10.5}} {
		if _, err := actions.PunchTo(context.Background(), c[0], c[1]); !errors.Is(err, ErrBadPunch) {
			t.Errorf("PunchTo(%v, %v): %v, want ErrBadPunch", c[0], c[1], err)
		}
	}
	time.Sleep(20 * time.Millisecond)
	if len(fake.commands()) != 0 {
		t.Fatalf("commands were written: %v", fake.commands())
	}
}

func TestPunchToWhileRecordingIsTheRecordingRefusal(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", run(command), "REAPER is recording. Stop it before moving to a word."}}
	})
	if _, err := actions.PunchTo(context.Background(), 42, 3); !errors.Is(err, ErrPunchWhileRecording) {
		t.Fatalf("err = %v, want ErrPunchWhileRecording", err)
	}
}
