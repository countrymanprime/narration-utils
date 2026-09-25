package bridge

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestTheTransportCommandsAreExperimentalAndRefusedWhileTheSettingIsOff(t *testing.T) {
	actions, client, dir := newActionsSession(t, false)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string { return nil })
	if _, err := actions.ArmOnly(context.Background(), testTrack); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("ArmOnly: %v", err)
	}
	if _, err := actions.RecordStart(context.Background(), testTrack); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("RecordStart: %v", err)
	}
	if _, err := actions.RecordStop(context.Background()); !errors.Is(err, ErrExperimentalOff) {
		t.Fatalf("RecordStop: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if len(fake.commands()) != 0 {
		t.Fatalf("commands were written: %v", fake.commands())
	}
	for _, command := range []string{"arm_only", "record_start", "record_stop"} {
		if !Experimental(command) {
			t.Errorf("%s must stay experimental until the verification pass", command)
		}
	}
}

func TestArmOnlySendsTheTrackAndReadsWhatChanged(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	fake := startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"ARMED", run(command), testTrack, "2", "1"}}
	})
	got, err := actions.ArmOnly(context.Background(), testTrack)
	if err != nil {
		t.Fatal(err)
	}
	if got != (Armed{TrackGUID: testTrack, Disarmed: 2, Changed: true}) {
		t.Fatalf("got %+v", got)
	}
	if command := fake.commands()[0]; command[1] != "arm_only" || command[3] != testTrack {
		t.Fatalf("command = %v", command)
	}
}

func TestArmOnlyRefusesATrackThatIsGoneAndWhileRecording(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	answer := [][]string{{"TRACK_STALE", "", testTrack}}
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		answer[0][1] = run(command)
		return answer
	})
	if _, err := actions.ArmOnly(context.Background(), testTrack); !errors.Is(err, ErrStale) {
		t.Fatalf("err = %v, want ErrStale", err)
	}
	answer = [][]string{{"ERROR", "", "REAPER is recording. Stop recording first."}}
	if _, err := actions.ArmOnly(context.Background(), testTrack); !errors.Is(err, ErrRecording) {
		t.Fatalf("err = %v, want ErrRecording", err)
	}
}

func TestRecordStartAnswersWhereRecordingBeganAndTellsTheRefusalsApart(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	reply := func(command []string) [][]string {
		return [][]string{{"RECORD_STARTED", run(command), testTrack, "42.500000"}}
	}
	var mu sync.Mutex
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		mu.Lock()
		defer mu.Unlock()
		return reply(command)
	})
	got, err := actions.RecordStart(context.Background(), testTrack)
	if err != nil || got != (RecordStarted{TrackGUID: testTrack, Position: 42.5}) {
		t.Fatalf("got %+v, %v", got, err)
	}
	for message, want := range map[string]error{
		"No track is armed.":                ErrNoTrackArmed,
		"More than one track is armed.":     ErrSeveralTracksArmed,
		"Another track is armed.":           ErrOtherTrackArmed,
		"REAPER is playing. Stop it first.": ErrPlaying,
		"REAPER is already recording.":      ErrAlreadyRecording,
		"REAPER did not start recording.":   ErrRecordingDidNotStart,
	} {
		mu.Lock()
		reply = func(command []string) [][]string { return [][]string{{"ERROR", run(command), message}} }
		mu.Unlock()
		if _, err := actions.RecordStart(context.Background(), testTrack); !errors.Is(err, want) {
			t.Errorf("%q: err = %v, want %v", message, err, want)
		}
	}
}

func TestRecordStartRefusesAnAnswerForAnotherTrack(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		return [][]string{{"RECORD_STARTED", run(command), "{00000002-0000-4000-8000-000000000002}", "0.000000"}}
	})
	if _, err := actions.RecordStart(context.Background(), testTrack); err == nil {
		t.Fatal("a recording on another track must be an error")
	}
}

func TestRecordStopReadsTheRestoredArmsAndNeverClaimsARecordingItDidNotStart(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	ours := true
	var mu sync.Mutex
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		mu.Lock()
		defer mu.Unlock()
		if ours {
			return [][]string{{"RECORD_STOPPED", run(command), "3", "1"}}
		}
		return [][]string{{"RECORD_NOT_OURS", run(command)}}
	})
	got, err := actions.RecordStop(context.Background())
	if err != nil || got != (RecordStopped{Restored: 3, Kept: 1}) {
		t.Fatalf("got %+v, %v", got, err)
	}
	mu.Lock()
	ours = false
	mu.Unlock()
	if _, err := actions.RecordStop(context.Background()); !errors.Is(err, ErrNotOurRecording) {
		t.Fatalf("err = %v, want ErrNotOurRecording", err)
	}
}

func TestARecordingTheNarratorStopsInREAPERIsReportedToTheHandler(t *testing.T) {
	actions, client, dir := newActionsSession(t, true)
	ended := make(chan RecordEnded, 1)
	actions.OnRecordEnded(func(event RecordEnded) { ended <- event })
	var startRun string
	var mu sync.Mutex
	startFakeReaper(t, client, dir, func(command []string) [][]string {
		mu.Lock()
		defer mu.Unlock()
		startRun = run(command)
		return [][]string{{"RECORD_STARTED", run(command), testTrack, "1.000000"}}
	})
	if _, err := actions.RecordStart(context.Background(), testTrack); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	appendEvents(t, dir, []string{"RECORD_ENDED", startRun, "2", "0"})
	mu.Unlock()
	select {
	case got := <-ended:
		if got != (RecordEnded{Restored: 2, Kept: 0}) {
			t.Fatalf("got %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RECORD_ENDED for the recording the app started was not reported")
	}
	// Another run's end is not ours.
	appendEvents(t, dir, []string{"RECORD_ENDED", "someone-else", "1", "0"})
	select {
	case got := <-ended:
		t.Fatalf("an end for another run was reported: %+v", got)
	case <-time.After(50 * time.Millisecond):
	}
}
