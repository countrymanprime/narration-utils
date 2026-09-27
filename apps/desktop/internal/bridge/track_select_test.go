package bridge

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestSelectTrackIsRefusedWhileTheExperimentalSettingIsOff(t *testing.T) {
	actions, client, dir := newActionsSession(t, false)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"TRACK_SELECTED", run(command), testTrack}}
	})
	if _, err := actions.SelectTrack(context.Background(), testTrack); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("err = %v, want ErrExperimentalOff", err)
	}
	time.Sleep(20 * time.Millisecond)
	if got := fake.commands(); len(got) != 0 {
		t.Fatalf("a command was written while the setting is off: %v", got)
	}
	if !Experimental("select_track") {
		t.Fatal("select_track must stay experimental until the verification pass has confirmed it")
	}
}

func TestSelectTrackWithANilGateIsOff(t *testing.T) {
	actions := NewActions(nil, nil)
	if _, err := actions.SelectTrack(context.Background(), testTrack); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("err = %v, want ErrExperimentalOff", err)
	}
}

func TestSelectTrackWithNoBridgeIsUnavailable(t *testing.T) {
	actions := NewActions(nil, switchGate(true))
	if _, err := actions.SelectTrack(context.Background(), testTrack); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestSelectTrackSendsTheTrackAndReadsItBack(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"TRACK_SELECTED", run(command), testTrack}}
	})
	got, err := actions.SelectTrack(context.Background(), testTrack)
	if err != nil {
		t.Fatal(err)
	}
	commands := fake.commands()
	if len(commands) != 1 || commands[0][1] != "select_track" || commands[0][3] != testTrack {
		t.Fatalf("commands = %v, want one select_track naming the track", commands)
	}
	if got != (SelectedTrack{TrackGUID: testTrack}) {
		t.Fatalf("got %+v", got)
	}
}

func TestSelectTrackReportsATrackThatIsGoneAsStale(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"TRACK_STALE", run(command), command[3]}}
	})
	_, err := actions.SelectTrack(context.Background(), "{FFFFFFFF-0000-4000-8000-00000000FFFF}")
	var stale *TrackStaleError
	if !errors.As(err, &stale) || stale.GUID != "{FFFFFFFF-0000-4000-8000-00000000FFFF}" || !errors.Is(err, ErrStale) {
		t.Fatalf("err = %v, want a TrackStaleError naming the GUID", err)
	}
}

func TestSelectTrackSaysWhenTheScriptIsOlderThanTheApp(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", run(command), "Unsupported workspace command"}}
	})
	if _, err := actions.SelectTrack(context.Background(), testTrack); !errors.Is(err, ErrScriptOutdated) {
		t.Fatalf("err = %v, want ErrScriptOutdated", err)
	}
}
