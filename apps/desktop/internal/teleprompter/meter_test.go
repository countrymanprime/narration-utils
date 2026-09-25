package teleprompter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// runFakeMeter stands in for `live_asr.py --meter`: it writes its arguments beside its stop file (so a test can read them
// without their being relayed), prints a level, a line that is not a level and another level, then waits for the stop file.
// Mode "meter-crash" fails the way a microphone that will not open does.
func runFakeMeter(mode string) bool {
	args := os.Args[1:]
	if !containsArg(args, "--meter") {
		return false
	}
	stopFile := flagValue(args, "--stop-file")
	encoded, _ := json.Marshal(args)
	_ = os.WriteFile(stopFile+".args", encoded, 0o600)
	if mode == "meter-crash" {
		fmt.Fprintln(os.Stderr, "Could not open the microphone: device not found")
		os.Exit(3)
	}
	fmt.Println(`{"type":"level","peak":-12.5,"rms":-20}`)
	fmt.Println(`{"type":"position","read":1,"committed":0,"status":"listening","jump":null,"skipped":null}`)
	fmt.Println(`{"type":"level","peak":-6,"rms":-9}`)
	for {
		if _, err := os.Stat(stopFile); err == nil {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}

func meterArgs(t *testing.T, f *fixture) []string {
	t.Helper()
	var found string
	waitFor(t, "the meter's args", func() bool {
		matches, _ := filepath.Glob(filepath.Join(f.session, "*.args"))
		if len(matches) == 0 {
			return false
		}
		found = matches[0]
		return true
	})
	raw, err := os.ReadFile(found)
	if err != nil {
		t.Fatal(err)
	}
	var args []string
	if err := json.Unmarshal(raw, &args); err != nil {
		t.Fatal(err)
	}
	return args
}

func (r *recorder) count(kind string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	total := 0
	for _, event := range r.events {
		if event["type"] == kind {
			total++
		}
	}
	return total
}

func TestMeterStartLaunchesTheSidecarInMeterModeOnTheChosenMicrophone(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.MeterStart("Microphone Array"); err != nil {
		t.Fatal(err)
	}

	args := meterArgs(t, f)

	if args[0] != "--meter" || flagValue(args, "--mic") != "Microphone Array" || !strings.HasPrefix(flagValue(args, "--stop-file"), f.session) {
		t.Fatalf("meter args = %v", args)
	}
	for _, sessionOnly := range []string{"--manuscript", "--model", "--engine", "--control-file"} {
		if containsArg(args, sessionOnly) {
			t.Fatalf("the meter was given %s: %v", sessionOnly, args)
		}
	}
}

func TestTheMeterRelaysOnlyLevelEvents(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.MeterStart("Microphone Array"); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "two levels", func() bool { return f.recorder.count("level") == 2 })

	if f.recorder.count("position") != 0 {
		t.Fatalf("the meter relayed a session event: %v", f.recorder.eventTypes())
	}
	if f.service.Snapshot()["phase"] != "idle" {
		t.Fatalf("the meter changed the session phase: %v", f.service.Snapshot())
	}
}

func TestMeterStopEndsTheMeterAndSaysSoWithoutAnError(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.MeterStart("Microphone Array"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a level", func() bool { return f.recorder.count("level") > 0 })

	f.service.MeterStop()

	waitFor(t, "meter_stopped", func() bool { return f.recorder.firstEvent("meter_stopped") != nil })
	if stopped := f.recorder.firstEvent("meter_stopped"); stopped["error"] != nil {
		t.Fatalf("a requested stop reported an error: %v", stopped)
	}
	if f.service.Metering() {
		t.Fatal("the meter still runs after MeterStop")
	}
}

func TestAMeterThatCannotOpenTheMicrophoneSaysWhy(t *testing.T) {
	f := newFixture(t, "meter-crash")
	if err := f.service.MeterStart("Gone"); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "meter_stopped", func() bool { return f.recorder.firstEvent("meter_stopped") != nil })

	if got := f.recorder.firstEvent("meter_stopped")["error"]; got != "Could not open the microphone: device not found" {
		t.Fatalf("meter_stopped error = %v", got)
	}
}

func TestAtMostOneMeterRuns(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.MeterStart("First"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a level", func() bool { return f.recorder.count("level") > 0 })

	if err := f.service.MeterStart("Second"); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "the first meter to stop", func() bool { return f.recorder.count("meter_stopped") == 1 })
	if !f.service.Metering() {
		t.Fatal("the second meter is not running")
	}
}

func TestTheMeterIsRefusedWhileASessionRuns(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "running", func() bool { return phase(f.service) == "running" })

	if err := f.service.MeterStart("Microphone Array"); err == nil {
		t.Fatal("a meter started while a session was running")
	}
	if f.service.Metering() {
		t.Fatal("a meter runs beside the session")
	}
}

func TestStartingASessionStopsTheMeterFirst(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.MeterStart("Microphone Array"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a level", func() bool { return f.recorder.count("level") > 0 })

	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}

	if f.service.Metering() {
		t.Fatal("the meter still runs once the session has started")
	}
	waitFor(t, "running", func() bool { return phase(f.service) == "running" })
	if f.recorder.count("meter_stopped") != 1 {
		t.Fatalf("events = %v", f.recorder.eventTypes())
	}
}

func TestTheMeterNeedsAMicrophoneAndAConfiguredSidecar(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.MeterStart("  "); err == nil {
		t.Fatal("a meter started with no microphone")
	}
	unconfigured := New(Config{SessionDir: t.TempDir()}, nil, nil, nil)
	if err := unconfigured.MeterStart("Microphone Array"); err == nil {
		t.Fatal("a meter started with no sidecar")
	}
}

func TestCloseStopsTheMeter(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.MeterStart("Microphone Array"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a level", func() bool { return f.recorder.count("level") > 0 })

	if err := f.service.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	if f.service.Metering() {
		t.Fatal("the meter outlived Close")
	}
	if matches, _ := filepath.Glob(filepath.Join(f.session, "*.stop")); len(matches) != 0 {
		t.Fatalf("the meter left its stop file: %v", matches)
	}
}
