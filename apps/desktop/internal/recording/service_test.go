package recording_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/recording"
	"github.com/countrymanprime/narration-utils/shell/internal/recording/recordingtest"
)

type recorder struct {
	t       *testing.T
	project string
	fake    *recordingtest.Fake
	service *recording.Service
	mu      sync.Mutex
	states  []recording.State
	levels  []recording.Level
}

func newRecorder(t *testing.T, fake *recordingtest.Fake) *recorder {
	t.Helper()
	r := &recorder{t: t, project: t.TempDir(), fake: fake}
	r.service = recording.New(recording.Config{Project: r.project, Grace: time.Second}, fake,
		func(state recording.State) { r.mu.Lock(); r.states = append(r.states, state); r.mu.Unlock() },
		func(level recording.Level) { r.mu.Lock(); r.levels = append(r.levels, level); r.mu.Unlock() })
	return r
}

func (r *recorder) folder() string { return filepath.Join(r.project, recording.FolderName) }

// waitIdle waits until the service reports no run.
func (r *recorder) waitIdle() recording.State {
	r.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if state := r.service.Snapshot(); state.Phase == recording.PhaseIdle {
			return state
		}
		time.Sleep(5 * time.Millisecond)
	}
	r.t.Fatal("the recorder never went idle")
	return recording.State{}
}

func files(t *testing.T, folder string) []string {
	t.Helper()
	entries, err := os.ReadDir(folder)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

func TestATakeRecordsToAPartialAndIsRenamedOnlyOnceFinished(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{Levels: []recording.Level{{Peak: -12.3, RMS: -24.1}}})

	if err := r.service.Start("Studio Mic"); err != nil {
		t.Fatal(err)
	}
	state := r.service.Snapshot()
	if state.Phase != recording.PhaseRecording || state.Take == nil || *state.Take != "Take 001" || state.StartedAt == nil {
		t.Fatalf("recording state = %+v", state)
	}
	if got := files(t, r.folder()); len(got) != 1 || got[0] != "Take 001.partial.wav" {
		t.Fatalf("while recording the folder holds %v, want only the partial", got)
	}
	if len(state.Takes) != 0 {
		t.Fatalf("the take being recorded is listed: %+v", state.Takes)
	}
	if r.fake.Last().Device != "Studio Mic" {
		t.Fatalf("recorded device %q", r.fake.Last().Device)
	}

	r.service.Stop()
	state = r.waitIdle()

	if got := files(t, r.folder()); len(got) != 1 || got[0] != "Take 001.wav" {
		t.Fatalf("after the take the folder holds %v", got)
	}
	if len(state.Takes) != 1 || state.Takes[0].Name != "Take 001" || state.Takes[0].Unfinished {
		t.Fatalf("takes = %+v", state.Takes)
	}
	take := state.Takes[0]
	if take.SampleRate != 48000 || take.Channels != 1 || take.Bits != 24 || take.Seconds != 1 {
		t.Fatalf("take format = %+v", take)
	}
	if state.Last == nil || state.Last.Name != "Take 001" || state.Last.Error != nil || state.Last.LatencyMs != 10 {
		t.Fatalf("last = %+v", state.Last)
	}
	if len(r.levels) != 1 || r.levels[0].Peak != -12.3 {
		t.Fatalf("levels = %+v", r.levels)
	}
	if state.Device != "Studio Mic" {
		t.Fatalf("the device is not remembered: %q", state.Device)
	}
}

func TestTakeNumbersNeverRepeatAndAPartialCountsAsTaken(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := os.MkdirAll(r.folder(), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Take 002.wav", "Take 005.partial.wav"} {
		if err := recordingtest.WriteWav(filepath.Join(r.folder(), name), 4800); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	r.service.Stop()
	state := r.waitIdle()

	names := []string{}
	for _, take := range state.Takes {
		names = append(names, take.Name+map[bool]string{true: " (unfinished)", false: ""}[take.Unfinished])
	}
	if strings.Join(names, ", ") != "Take 002, Take 005 (unfinished), Take 006" {
		t.Fatalf("takes = %v", names)
	}
}

func TestATakeTheDeviceEndsKeepsItsAudioAndSaysWhy(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{FailWith: "Studio Mic stopped delivering audio"})
	if err := r.service.Start("Studio Mic"); err != nil {
		t.Fatal(err)
	}
	state := r.waitIdle()

	if len(state.Takes) != 1 || state.Takes[0].Unfinished {
		t.Fatalf("takes = %+v", state.Takes)
	}
	if state.Message != "Studio Mic stopped delivering audio" || state.Last == nil || state.Last.Error == nil {
		t.Fatalf("state = %+v", state)
	}
}

func TestAnEngineThatDiesLeavesItsPartialListedAsUnfinished(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{CrashWith: "The recorder stopped unexpectedly."})
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	state := r.waitIdle()

	if got := files(t, r.folder()); len(got) != 1 || got[0] != "Take 001.partial.wav" {
		t.Fatalf("folder = %v", got)
	}
	if len(state.Takes) != 1 || !state.Takes[0].Unfinished || state.Takes[0].Seconds != 1 {
		t.Fatalf("takes = %+v", state.Takes)
	}
	if state.Last == nil || !state.Last.Unfinished || !strings.Contains(state.Message, "kept as Take 001.partial.wav") {
		t.Fatalf("state = %+v", state)
	}
}

func TestAPartialWithNoAudioIsRemovedAndNothingIsListed(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{Frames: -1, CrashWith: "The built-in recorder could not open Mic: busy"})
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	state := r.waitIdle()

	if got := files(t, r.folder()); len(got) != 0 {
		t.Fatalf("folder = %v, want the empty partial gone", got)
	}
	if state.Message != "The built-in recorder could not open Mic: busy" || state.Last != nil {
		t.Fatalf("state = %+v", state)
	}
}

func TestAFinishedNameThatAppearsIsNeverReplaced(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	// Something else writes the finished name while the take records: the take keeps its partial name.
	if err := os.WriteFile(filepath.Join(r.folder(), "Take 001.wav"), []byte("someone else's"), 0o644); err != nil {
		t.Fatal(err)
	}
	r.service.Stop()
	state := r.waitIdle()

	if data, _ := os.ReadFile(filepath.Join(r.folder(), "Take 001.wav")); string(data) != "someone else's" {
		t.Fatal("the other file was replaced")
	}
	if state.Last == nil || !state.Last.Unfinished || !strings.Contains(state.Message, "already exists") {
		t.Fatalf("state = %+v", state)
	}
}

func TestStartIsRefusedWithoutAProjectADeviceOrAnEngineAndWhileRecording(t *testing.T) {
	noProject := recording.New(recording.Config{}, &recordingtest.Fake{}, nil, nil)
	if err := noProject.Start("Mic"); err == nil || !strings.Contains(err.Error(), "open a project") {
		t.Fatalf("no project: %v", err)
	}
	if err := recording.New(recording.Config{Project: t.TempDir()}, nil, nil, nil).Start("Mic"); err == nil {
		t.Fatal("no engine: started")
	}
	r := newRecorder(t, &recordingtest.Fake{})
	if err := r.service.Start("  "); err == nil || !strings.Contains(err.Error(), "choose a microphone") {
		t.Fatalf("no device: %v", err)
	}
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	if err := r.service.Start("Mic"); err == nil {
		t.Fatal("a second take started over the first")
	}
	if err := r.service.Meter("Mic"); err == nil {
		t.Fatal("the meter started over a take")
	}
	if !r.service.Busy() {
		t.Fatal("not busy while recording")
	}
	r.service.Stop()
	r.waitIdle()
	if r.service.Busy() {
		t.Fatal("still busy")
	}
}

func TestAnEngineThatWillNotOpenIsTheStartError(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{OpenError: errors.New("configure the teleprompter executable before recording")})
	if err := r.service.Start("Mic"); err == nil || !strings.Contains(err.Error(), "teleprompter executable") {
		t.Fatalf("err = %v", err)
	}
	if r.service.Snapshot().Phase != recording.PhaseIdle {
		t.Fatal("not idle")
	}
}

func TestTheMeterRunsBeforeATakeAndTheTakeReplacesIt(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{Levels: []recording.Level{{Peak: -20, RMS: -30}}})
	if err := r.service.Meter("Mic"); err != nil {
		t.Fatal(err)
	}
	if state := r.service.Snapshot(); state.Phase != recording.PhaseMetering || state.Take != nil {
		t.Fatalf("state = %+v", state)
	}
	if r.service.Busy() {
		t.Fatal("a meter is not busy work")
	}
	meter := r.fake.Last()
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-meter.Done():
	default:
		t.Fatal("the meter still runs under the take")
	}
	if r.fake.Last().Kind != "take" {
		t.Fatal("no take started")
	}
	r.service.StopMeter() // does nothing to a take
	if r.service.Snapshot().Phase != recording.PhaseRecording {
		t.Fatal("StopMeter stopped the take")
	}
	r.service.Stop()
	r.waitIdle()
	if len(files(t, r.folder())) != 1 {
		t.Fatal("the meter wrote a file")
	}
}

func TestCloseStopsATakeAndFinishesIt(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := r.service.Close(ctx); err != nil {
		t.Fatal(err)
	}
	if got := files(t, r.folder()); len(got) != 1 || got[0] != "Take 001.wav" {
		t.Fatalf("folder = %v", got)
	}
}

func TestTakePathAuthorizesOnlyAListedTake(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := r.service.Start("Mic"); err != nil {
		t.Fatal(err)
	}
	partial := filepath.Join(r.folder(), "Take 001.partial.wav")
	if _, ok := r.service.TakePath(partial); ok {
		t.Fatal("the take being recorded is playable")
	}
	r.service.Stop()
	r.waitIdle()
	take := filepath.Join(r.folder(), "Take 001.wav")
	if got, ok := r.service.TakePath(take); !ok || got != take {
		t.Fatalf("TakePath(%q) = %q, %v", take, got, ok)
	}
	for _, other := range []string{filepath.Join(r.folder(), "..", "secret.wav"), filepath.Join(r.project, "Take 001.wav"), filepath.Join(r.folder(), "notes.txt")} {
		if _, ok := r.service.TakePath(other); ok {
			t.Fatalf("TakePath(%q) authorized", other)
		}
	}
}

func TestSnapshotWithoutAProjectHasNoFolderAndNoTakes(t *testing.T) {
	state := recording.New(recording.Config{}, nil, nil, nil).Snapshot()
	if state.Folder != "" || state.Phase != recording.PhaseIdle || state.Takes == nil || len(state.Takes) != 0 {
		t.Fatalf("state = %+v", state)
	}
}

func TestDevicesComeFromTheEngine(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{DeviceList: []recording.Device{{Name: "Studio Mic"}}, DeviceMessage: ""})
	devices, message, err := r.service.Devices(context.Background())
	if err != nil || message != "" || len(devices) != 1 || devices[0].Name != "Studio Mic" {
		t.Fatalf("devices = %v, %q, %v", devices, message, err)
	}
	empty, _, _ := newRecorder(t, &recordingtest.Fake{}).service.Devices(context.Background())
	if empty == nil {
		t.Fatal("no devices must be an empty list, not nil")
	}
}
