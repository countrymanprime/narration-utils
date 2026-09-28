package recording_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/recording"
	"github.com/countrymanprime/narration-utils/shell/internal/recording/recordingtest"
)

// The test binary stands in for the teleprompter sidecar: with fakeSidecarEnv set it behaves like `live_asr.py` in
// the mode named, reading the arguments the adapter passed.
const fakeSidecarEnv = "NARRATION_FAKE_RECORDER_SIDECAR"

func TestMain(m *testing.M) {
	if mode := os.Getenv(fakeSidecarEnv); mode != "" {
		runFakeSidecar(mode, os.Args[1:])
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func flag(args []string, name string) string {
	if i := slices.Index(args, name); i >= 0 && i+1 < len(args) {
		return args[i+1]
	}
	return ""
}

func runFakeSidecar(mode string, args []string) {
	if flag(args, "--capture") != "wasapi" {
		fmt.Fprintln(os.Stderr, "no --capture wasapi")
		os.Exit(2)
	}
	switch {
	case slices.Contains(args, "--list-devices"):
		if mode == "list-crash" {
			fmt.Fprintln(os.Stderr, "The built-in recorder cannot list devices here: no PortAudio")
			os.Exit(3)
		}
		fmt.Println(`{"type":"devices","devices":[{"name":"Studio Mic"},{"name":"Studio Mic [2]"}],"error":null}`)
	case slices.Contains(args, "--record"):
		if mode == "record-refused" {
			fmt.Fprintln(os.Stderr, "Recording Gone...")
			fmt.Fprintln(os.Stderr, "The built-in recorder could not open Gone: no such device")
			os.Exit(1)
		}
		path, stop := flag(args, "--record"), flag(args, "--stop-file")
		if err := recordingtest.WriteWav(path, 0); err != nil {
			os.Exit(4)
		}
		fmt.Println(`{"type":"level","peak":-12.3,"rms":-24.1}`)
		fmt.Println(`{"type":"partial","text":"not the recorder's"}`)
		for {
			if _, err := os.Stat(stop); err == nil {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		_ = os.Remove(path)
		_ = recordingtest.WriteWav(path, 48000)
		fmt.Printf(`{"type":"recorded","path":%q,"sampleRate":48000,"channels":1,"bits":24,"frames":48000,"seconds":1.0,"overflows":1,"droppedBlocks":2,"droppedFrames":960,"clipped":3,"latencyMs":10.5,"error":null}`+"\n", path)
	case slices.Contains(args, "--meter"):
		fmt.Println(`{"type":"level","peak":-40,"rms":-50}`)
		stop := flag(args, "--stop-file")
		for {
			if _, err := os.Stat(stop); err == nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func sidecarEngine(t *testing.T, mode string) *recording.Sidecar {
	t.Helper()
	t.Setenv(fakeSidecarEnv, mode)
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	return recording.NewSidecar(recordingtest.Backend{}, recording.SidecarConfig{Program: os.Args[0], SessionDir: t.TempDir()}, supervisor)
}

func TestTheSidecarListsTheRowsDevices(t *testing.T) {
	devices, message, err := sidecarEngine(t, "ok").Devices(context.Background())
	if err != nil || message != "" || len(devices) != 2 || devices[1].Name != "Studio Mic [2]" {
		t.Fatalf("devices = %v, %q, %v", devices, message, err)
	}
}

func TestASidecarThatCannotListSaysWhyInTheMessage(t *testing.T) {
	devices, message, err := sidecarEngine(t, "list-crash").Devices(context.Background())
	if err != nil || len(devices) != 0 || !strings.Contains(message, "no PortAudio") {
		t.Fatalf("devices = %v, %q, %v", devices, message, err)
	}
}

func TestTheSidecarRecordsATakeAndRelaysItsLevelAndResult(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Take 001.partial.wav")
	var mu sync.Mutex
	var levels []recording.Level
	var results []recording.Result
	run, err := sidecarEngine(t, "ok").Record("Studio Mic", path, recording.Events{
		Level:    func(level recording.Level) { mu.Lock(); levels = append(levels, level); mu.Unlock() },
		Recorded: func(result recording.Result) { mu.Lock(); results = append(results, result); mu.Unlock() },
	})
	if err != nil {
		t.Fatal(err)
	}
	run.Stop()
	select {
	case <-run.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("the take never ended")
	}
	mu.Lock()
	defer mu.Unlock()
	if run.Failure() != "" {
		t.Fatalf("failure = %q", run.Failure())
	}
	if len(levels) != 1 || levels[0].RMS != -24.1 {
		t.Fatalf("levels = %+v", levels)
	}
	if len(results) != 1 || results[0].Frames != 48000 || results[0].Dropouts() != 3 || results[0].LatencyMs != 10.5 {
		t.Fatalf("results = %+v", results)
	}
}

func TestATakeTheSidecarRefusesFailsWithItsSentence(t *testing.T) {
	run, err := sidecarEngine(t, "record-refused").Record("Gone", filepath.Join(t.TempDir(), "t.wav"), recording.Events{})
	if err != nil {
		t.Fatal(err)
	}
	<-run.Done()
	if got := run.Failure(); got != "The built-in recorder could not open Gone: no such device" {
		t.Fatalf("failure = %q", got)
	}
}

func TestTheSidecarMetersUntilStopped(t *testing.T) {
	levels := make(chan recording.Level, 4)
	run, err := sidecarEngine(t, "ok").Meter("Studio Mic", recording.Events{Level: func(level recording.Level) { levels <- level }})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case level := <-levels:
		if level.Peak != -40 {
			t.Fatalf("level = %+v", level)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no level")
	}
	run.Stop()
	<-run.Done()
	if run.Failure() != "" {
		t.Fatalf("failure = %q", run.Failure())
	}
}

func TestAnUnconfiguredSidecarRefusesToStart(t *testing.T) {
	engine := recording.NewSidecar(recordingtest.Backend{}, recording.SidecarConfig{}, nil)
	if _, err := engine.Record("Mic", "t.wav", recording.Events{}); err == nil {
		t.Fatal("started")
	}
	if _, _, err := engine.Devices(context.Background()); err == nil {
		t.Fatal("listed")
	}
	if engine.Backend().Name() != "wasapi" {
		t.Fatal("backend")
	}
}

// The service over the real adapter: a take through the fake sidecar lands as Take 001.wav.
func TestTheServiceRecordsThroughTheSidecar(t *testing.T) {
	project := t.TempDir()
	service := recording.New(recording.Config{Project: project}, sidecarEngine(t, "ok"), nil, nil)
	if err := service.Start("Studio Mic"); err != nil {
		t.Fatal(err)
	}
	service.Stop()
	deadline := time.Now().Add(10 * time.Second)
	for service.Snapshot().Phase != recording.PhaseIdle && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	state := service.Snapshot()
	if len(state.Takes) != 1 || state.Takes[0].Name != "Take 001" || state.Takes[0].Unfinished || state.Last == nil || state.Last.Dropouts != 3 {
		t.Fatalf("state = %+v", state)
	}
}
