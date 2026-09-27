package main

import (
	"context"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/dawporttest"
)

// fakeRecorder stands in for bridge.Actions' Recorder role (its own tests drive a fake REAPER through the file
// protocol, and the Lua harness the command): it records what was asked and answers what the test set.
type fakeRecorder struct {
	armGUID string
	armed   bridge.Armed
	armErr  error

	startGUID string
	started   bridge.RecordStarted
	startErr  error

	stopCalls int
	stopped   bridge.RecordStopped
	stopErr   error

	ended func(bridge.RecordEnded)
}

var _ dawport.Recorder = (*fakeRecorder)(nil)

func (f *fakeRecorder) ArmOnly(_ context.Context, guid string) (bridge.Armed, error) {
	f.armGUID = guid
	if f.armErr != nil {
		return bridge.Armed{}, f.armErr
	}
	armed := f.armed
	armed.TrackGUID = guid
	return armed, nil
}

func (f *fakeRecorder) RecordStart(_ context.Context, guid string) (bridge.RecordStarted, error) {
	f.startGUID = guid
	if f.startErr != nil {
		return bridge.RecordStarted{}, f.startErr
	}
	started := f.started
	started.TrackGUID = guid
	return started, nil
}

func (f *fakeRecorder) RecordStop(context.Context) (bridge.RecordStopped, error) {
	f.stopCalls++
	return f.stopped, f.stopErr
}

func (f *fakeRecorder) OnRecordEnded(handler func(bridge.RecordEnded)) { f.ended = handler }

func TestReadAloudArmOnlyArmsTheChaptersLinkedTrack(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	fake := &fakeRecorder{armed: bridge.Armed{Disarmed: 1, Changed: true}}

	result, err := readAloudArmOnlyIn(context.Background(), host.services(), fake, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if fake.armGUID != readAloudTrack {
		t.Fatalf("armed %q, want the chapter's linked track %q", fake.armGUID, readAloudTrack)
	}
	if result.Outcome != "armed" || result.TrackGUID != readAloudTrack || result.Disarmed == nil || *result.Disarmed != 1 || result.Changed == nil || !*result.Changed {
		t.Fatalf("result = %+v", result)
	}
}

func TestReadAloudArmOnlyRefusesWhileRecording(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	fake := &fakeRecorder{armErr: bridge.ErrAlreadyRecording}

	result, err := readAloudArmOnlyIn(context.Background(), host.services(), fake, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != "already_recording" {
		t.Fatalf("result = %+v, want a refusal for already recording", result)
	}
}

func TestReadAloudArmOnlyWithNoLinkedTrackIsRefused(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	fake := &fakeRecorder{}

	result, err := readAloudArmOnlyIn(context.Background(), host.services(), fake, ids[1])
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != readAloudUnlinked || fake.armGUID != "" {
		t.Fatalf("result = %+v, armGUID = %q, want a no_link refusal and nothing sent", result, fake.armGUID)
	}
}

func TestReadAloudArmOnlyWithNoRecorderIsExperimentalOff(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)

	result, err := readAloudArmOnlyIn(context.Background(), host.services(), nil, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != readAloudExperimentalOff {
		t.Fatalf("result = %+v", result)
	}
}

func TestReadAloudArmOnlyWithAChapterTheManuscriptDoesNotHaveIsAnError(t *testing.T) {
	host, _ := newReadAloudReaperHost(t)
	if _, err := readAloudArmOnlyIn(context.Background(), host.services(), &fakeRecorder{}, "no-such-chapter"); err == nil {
		t.Fatal("answered for a chapter the manuscript does not have")
	}
}

func TestReadAloudArmOnlyIsStandaloneWithoutAReaperSession(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	linkChapter(t, host, ids[0], readAloudTrack)
	// No host.reachability set: newTestHostForChapterMatch's host is standalone (bindings_navigation.go's reaperStatus).

	result, err := readAloudArmOnlyIn(context.Background(), host.services(), &fakeRecorder{}, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != reaperStandalone {
		t.Fatalf("result = %+v, want a standalone refusal", result)
	}
}

func TestReadAloudRecordStartStartsOnTheArmedTrack(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	fake := &fakeRecorder{started: bridge.RecordStarted{Position: 12.5}}

	result, err := readAloudRecordStartIn(context.Background(), host.services(), fake, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if fake.startGUID != readAloudTrack {
		t.Fatalf("started on %q, want %q", fake.startGUID, readAloudTrack)
	}
	if result.Outcome != "started" || result.TrackGUID != readAloudTrack || result.Position == nil || *result.Position != 12.5 {
		t.Fatalf("result = %+v", result)
	}
}

func TestReadAloudRecordStartRefusals(t *testing.T) {
	for name, tc := range map[string]struct {
		err    error
		reason string
	}{
		"no track armed":        {bridge.ErrNoTrackArmed, "not_armed"},
		"several tracks armed":  {bridge.ErrSeveralTracksArmed, "several_armed"},
		"another track armed":   {bridge.ErrOtherTrackArmed, "other_armed"},
		"REAPER is playing":     {bridge.ErrPlaying, "playing"},
		"already recording":     {bridge.ErrAlreadyRecording, "already_recording"},
		"did not start":         {bridge.ErrRecordingDidNotStart, "did_not_start"},
		"a timeout":             {context.DeadlineExceeded, "timeout"},
		"the track is stale":    {&bridge.TrackStaleError{GUID: readAloudTrack}, readAloudTrackMissing},
		"the bridge is offline": {bridge.ErrUnavailable, reaperStandalone},
		"REAPER is not running": {bridge.ErrNoAnswer, reaperNotRunning},
	} {
		t.Run(name, func(t *testing.T) {
			host, ids := newReadAloudReaperHost(t)
			fake := &fakeRecorder{startErr: tc.err}
			result, err := readAloudRecordStartIn(context.Background(), host.services(), fake, ids[0])
			if err != nil {
				t.Fatal(err)
			}
			if result.Outcome != "refused" || result.Reason != tc.reason {
				t.Fatalf("result = %+v, want reason %q", result, tc.reason)
			}
		})
	}
}

func TestReadAloudRecordStartWithNoRecorderIsExperimentalOff(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	result, err := readAloudRecordStartIn(context.Background(), host.services(), nil, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != readAloudExperimentalOff {
		t.Fatalf("result = %+v", result)
	}
}

func TestReadAloudRecordStopStopsAndRestoresArms(t *testing.T) {
	fake := &fakeRecorder{stopped: bridge.RecordStopped{Restored: 2, Kept: 1}}
	result, err := readAloudRecordStopIn(context.Background(), fake)
	if err != nil {
		t.Fatal(err)
	}
	if fake.stopCalls != 1 {
		t.Fatalf("stopCalls = %d, want 1", fake.stopCalls)
	}
	if result.Outcome != "stopped" || result.Restored == nil || *result.Restored != 2 || result.Kept == nil || *result.Kept != 1 {
		t.Fatalf("result = %+v", result)
	}
}

func TestReadAloudRecordStopLeavesARecordingItDidNotStartAlone(t *testing.T) {
	fake := &fakeRecorder{stopErr: bridge.ErrNotOurRecording}
	result, err := readAloudRecordStopIn(context.Background(), fake)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != "not_our_recording" {
		t.Fatalf("result = %+v", result)
	}
}

func TestReadAloudRecordStopWithNoRecorderIsExperimentalOff(t *testing.T) {
	result, err := readAloudRecordStopIn(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != readAloudExperimentalOff {
		t.Fatalf("result = %+v", result)
	}
}

// The bindings answer JSON, and a successful start remembers the chapter so ServiceShutdown (and OnRecordEnded) can
// clear it again; a standalone host (no bridge.Actions) refuses every one.
func TestReadAloudRecordBindingsAnswerJSON(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	for _, raw := range []func() (string, error){
		func() (string, error) { return host.ReadAloudArmOnly(ids[0]) },
		func() (string, error) { return host.ReadAloudRecordStart(ids[0]) },
		func() (string, error) { return host.ReadAloudRecordStop() },
	} {
		out, err := raw()
		if err != nil {
			t.Fatal(err)
		}
		if out == "" {
			t.Fatal("empty binding answer")
		}
	}
}

// stopReadAloudRecordingOnShutdown reads recorderFrom(h.services()) fresh, not the recorder setReadAloudRecording was
// given, so on a test host with no dawPortResolver it finds none and only clears the flag; a resolver wired to a fake
// is exactly TestRecorderFromComesFromTheResolver's own case, not repeated here.
func TestServiceShutdownClearsAReadAloudRecordingItStarted(t *testing.T) {
	host, _ := newReadAloudReaperHost(t)
	host.setReadAloudRecording("chapter-1", &fakeRecorder{})

	host.stopReadAloudRecordingOnShutdown()

	host.mu.RLock()
	chapter := host.readAloudRecordingChapter
	host.mu.RUnlock()
	if chapter != "" {
		t.Fatalf("readAloudRecordingChapter = %q after shutdown, want cleared", chapter)
	}
}

func TestServiceShutdownWithNoRecordingIsANoOp(t *testing.T) {
	host, _ := newReadAloudReaperHost(t)
	host.stopReadAloudRecordingOnShutdown() // must not panic with nothing recording
}

func TestOnRecordEndedClearsTheChapter(t *testing.T) {
	host, _ := newReadAloudReaperHost(t)
	fake := &fakeRecorder{}
	host.setReadAloudRecording("chapter-1", fake)

	fake.ended(bridge.RecordEnded{Restored: 1})

	host.mu.RLock()
	chapter := host.readAloudRecordingChapter
	host.mu.RUnlock()
	if chapter != "" {
		t.Fatalf("readAloudRecordingChapter = %q after OnRecordEnded, want cleared", chapter)
	}
}

// TestRecorderFromComesFromTheResolver is the "role comes from the resolver" test the DAW port PRD's migration risk
// table calls for (P5a, ADR 0300): the Record bindings source their recorder through recorderFrom, which asks
// svc.dawPortResolver for the Record role instead of holding a bridge client directly.
func TestRecorderFromComesFromTheResolver(t *testing.T) {
	fake := dawporttest.NewFake(dawport.KindREAPER, dawporttest.Levels(dawport.Supported))
	resolver := dawport.NewResolver(dawport.ResolverConfig{
		Adapter: fake,
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
	})

	recorder := recorderFrom(hostServices{dawPortResolver: resolver})
	if recorder == nil {
		t.Fatal("no recorder from a resolver with a live adapter")
	}
	if _, err := recorder.ArmOnly(context.Background(), "guid"); err != nil {
		t.Fatalf("ArmOnly: %v", err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "record.ArmOnly" {
		t.Fatalf("the recorder did not come from the resolver: calls = %v", calls)
	}
}

func TestRecorderFromIsNilWithoutAResolver(t *testing.T) {
	if recorder := recorderFrom(hostServices{}); recorder != nil {
		t.Fatalf("recorder = %v, want nil with no resolver", recorder)
	}
}

// The binding's answers, pinned for the UI's schema (ADR 0069): one arm, record start and record stop per REAPER
// state the mock (`?mockReaper=`) can put a chapter in, plus the stale-track and no-link cases only the host can
// reach. wireContracts.test.ts cross-checks every mock seed but "unavailable" (its own reason, standalone, differs
// from experimental_off's here on purpose - the read-aloud-reaper-states golden the same way).
func TestContractReadAloudRecordings(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	answers := map[string]ReadAloudRecording{}
	record := func(name string, fake *fakeRecorder, chapterID string) {
		t.Helper()
		// A nil *fakeRecorder must reach readAloudArmOnlyIn as a true nil dawport.Recorder, not a typed nil in a non-nil
		// interface (which would pass its `recorder == nil` check and then panic on the fake's nil receiver).
		var recorder dawport.Recorder
		if fake != nil {
			recorder = fake
		}
		armed, err := readAloudArmOnlyIn(context.Background(), host.services(), recorder, chapterID)
		if err != nil {
			t.Fatal(err)
		}
		answers[name+".arm"] = armed
		started, err := readAloudRecordStartIn(context.Background(), host.services(), recorder, chapterID)
		if err != nil {
			t.Fatal(err)
		}
		answers[name+".start"] = started
		stopped, err := readAloudRecordStopIn(context.Background(), recorder)
		if err != nil {
			t.Fatal(err)
		}
		answers[name+".stop"] = stopped
	}
	record("ready", &fakeRecorder{started: bridge.RecordStarted{Position: 0}}, ids[0])
	record("not_armed", &fakeRecorder{startErr: bridge.ErrNoTrackArmed}, ids[0])
	record("other_armed", &fakeRecorder{armed: bridge.Armed{Disarmed: 1, Changed: true}, startErr: bridge.ErrOtherTrackArmed}, ids[0])
	record("several_armed", &fakeRecorder{armed: bridge.Armed{Disarmed: 3, Changed: true}, startErr: bridge.ErrSeveralTracksArmed}, ids[0])
	record("recording_elsewhere", &fakeRecorder{armErr: bridge.ErrAlreadyRecording, startErr: bridge.ErrAlreadyRecording}, ids[0])
	record("track_missing", &fakeRecorder{armErr: &bridge.TrackStaleError{GUID: readAloudTrack}, startErr: &bridge.TrackStaleError{GUID: readAloudTrack}}, ids[0])
	record("experimental_off", nil, ids[0])
	record("no_link", &fakeRecorder{}, ids[1])
	contractfile.Check(t, "read-aloud-recordings", answers)
}
