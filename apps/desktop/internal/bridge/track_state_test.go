package bridge

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

const testTrack = "{00000001-0000-4000-8000-000000000001}"

func newActionsSession(t *testing.T, enabled bool) (*Actions, *Client, string) {
	t.Helper()
	dir := t.TempDir()
	client, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	actions := NewActions(client, switchGate(enabled))
	actions.SetTimeout(2 * time.Second)
	return actions, client, dir
}

// trackStateAnswer is what track_state_test.lua pins for a track with two items, the second trimmed and faster.
func trackStateAnswer(command []string) [][]string {
	return [][]string{
		{"TRACK_STATE", run(command), testTrack, "5", "2.500000", "12.345678", "C:/p/Book.rpp", "0", "7", "1", "2", "1024", "Focusrite USB ASIO"},
		{"TRACK_ITEM", run(command), testItem, testTake, "0.000000", "4.000000", "0.000000", "1.000000", "C:/Audio/ch1|take 1.wav"},
		{"TRACK_ITEM", run(command), "{AAAAAAAA-0000-4000-8000-000000000002}", "", "10.000000", "3.000000", "1.500000", "1.250000", ""},
		{"TRACK_STATE_END", run(command), "2", "3"},
	}
}

func TestChapterTrackStateIsRefusedWhileTheExperimentalSettingIsOff(t *testing.T) {
	actions, client, dir := newActionsSession(t, false)
	fake := startFakeReaper(t, client, dir, trackStateAnswer)
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("err = %v, want ErrExperimentalOff", err)
	}
	time.Sleep(20 * time.Millisecond)
	if got := fake.commands(); len(got) != 0 {
		t.Fatalf("a command was written while the setting is off: %v", got)
	}
	if !Experimental("chapter_track_state") {
		t.Fatal("chapter_track_state must stay experimental until the verification pass has confirmed it")
	}
}

func TestChapterTrackStateWithANilGateIsOff(t *testing.T) {
	actions := NewActions(nil, nil)
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("err = %v, want ErrExperimentalOff", err)
	}
}

func TestChapterTrackStateWithNoBridgeIsUnavailable(t *testing.T) {
	actions := NewActions(nil, switchGate(true))
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestChapterTrackStateSendsTheTrackAndReadsTheTransportArmsAndItems(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, trackStateAnswer)
	got, err := actions.ChapterTrackState(context.Background(), testTrack)
	if err != nil {
		t.Fatal(err)
	}
	commands := fake.commands()
	if len(commands) != 1 || commands[0][1] != "chapter_track_state" || commands[0][3] != testTrack {
		t.Fatalf("commands = %v, want one chapter_track_state naming the track", commands)
	}
	input := 1024
	want := TrackState{
		TrackGUID: testTrack, PlayState: 5, Playing: true, Recording: true,
		EditCursor: 2.5, PlayPosition: 12.345678, ProjectPath: "C:/p/Book.rpp", ChangeCount: 7,
		TrackArmed: true, ArmedCount: 2, RecordInput: &input, InputDevice: "Focusrite USB ASIO",
		Items: []TrackItem{
			{ItemGUID: testItem, TakeGUID: testTake, Position: 0, Length: 4, SourceOffset: 0, PlayRate: 1, SourceFile: "C:/Audio/ch1|take 1.wav"},
			{ItemGUID: "{AAAAAAAA-0000-4000-8000-000000000002}", Position: 10, Length: 3, SourceOffset: 1.5, PlayRate: 1.25},
		},
		ItemsTotal: 3,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
}

func TestChapterTrackStateWithNoTrackReadsTheTransportOnly(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{
			{"TRACK_STATE", run(command), "", "2", "0.000000", "0.000000", "", "1", "0", "0", "1", "", ""},
			{"TRACK_STATE_END", run(command), "0", "0"},
		}
	})
	got, err := actions.ChapterTrackState(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if got.TrackGUID != "" || !got.Paused || got.Playing || !got.Unsaved || got.ArmedCount != 1 || got.RecordInput != nil || len(got.Items) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestChapterTrackStateReportsATrackThatIsGoneAsStale(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"TRACK_STALE", run(command), command[3]}}
	})
	_, err := actions.ChapterTrackState(context.Background(), "{FFFFFFFF-0000-4000-8000-00000000FFFF}")
	var stale *TrackStaleError
	if !errors.As(err, &stale) || stale.GUID != "{FFFFFFFF-0000-4000-8000-00000000FFFF}" || !errors.Is(err, ErrStale) {
		t.Fatalf("err = %v, want a TrackStaleError naming the GUID", err)
	}
}

func TestChapterTrackStateRefusesAnAnswerForAnotherTrack(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{
			{"TRACK_STATE", run(command), "{00000002-0000-4000-8000-000000000002}", "0", "0", "0", "", "1", "0", "0", "0", "0", ""},
			{"TRACK_STATE_END", run(command), "0", "0"},
		}
	})
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); err == nil {
		t.Fatal("an answer naming another track must be an error, never another track's state")
	}
}

func TestChapterTrackStateSaysWhenTheScriptIsOlderThanTheApp(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ERROR", run(command), "Unsupported workspace command"}}
	})
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); !errors.Is(err, ErrScriptOutdated) {
		t.Fatalf("err = %v, want ErrScriptOutdated", err)
	}
}

func TestChapterTrackStateRejectsAnAnswerThatDoesNotReadAndTimesOutWithoutOne(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"TRACK_STATE", run(command), testTrack, "playing"}}
	})
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); err == nil || errors.Is(err, ErrNoAnswer) {
		t.Fatalf("err = %v, want the invalid answer reported", err)
	}

	quiet, _, _ := newActionsSession(t, true)
	quiet.SetTimeout(30 * time.Millisecond)
	if _, err := quiet.ChapterTrackState(context.Background(), testTrack); !errors.Is(err, ErrNoAnswer) {
		t.Fatalf("err = %v, want ErrNoAnswer", err)
	}
}

func TestASessionLevelErrorAnswersEveryActionInFlight(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func([]string) [][]string {
		return [][]string{{"ERROR", "", "Unsupported hub protocol"}}
	})
	if _, err := actions.ChapterTrackState(context.Background(), testTrack); err == nil || err.Error() != "Unsupported hub protocol" {
		t.Fatalf("err = %v, want the session-level error", err)
	}
}
