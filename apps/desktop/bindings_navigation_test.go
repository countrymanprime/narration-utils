package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

const (
	navItem = "{A1B2C3D4-0000-4000-8000-000000000001}"
	navTake = "{A1B2C3D4-0000-4000-8000-0000000000A1}"
)

// fakeNavigator stands in for bridge.Navigator (whose own tests drive a fake REAPER through the file protocol): it
// records every request and answers with what the test set, so a binding test says what REAPER answered.
type fakeNavigator struct {
	mu       sync.Mutex
	requests []string
	targets  []bridge.Target
	err      error
	navigate bridge.Navigated
	loop     bridge.LoopStarted
	stop     bridge.LoopStopped
}

func (f *fakeNavigator) record(request string, target bridge.Target) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, request)
	f.targets = append(f.targets, target)
	return f.err
}

func (f *fakeNavigator) Navigate(_ context.Context, target bridge.Target) (bridge.Navigated, error) {
	return f.navigate, f.record("navigate", target)
}

func (f *fakeNavigator) Loop(_ context.Context, target bridge.Target) (bridge.LoopStarted, error) {
	return f.loop, f.record("loop", target)
}

func (f *fakeNavigator) StopLoop(context.Context) (bridge.LoopStopped, error) {
	return f.stop, f.record("stop", bridge.Target{})
}

func (f *fakeNavigator) sent() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.requests...)
}

// liveReachability is a tracker that has just heard REAPER's heartbeat, as a REAPER launch has.
func liveReachability() *daw.Reachability {
	reach := daw.NewReachability(nil)
	reach.Record(bridge.Event{Tag: "PROJECT_STATUS", Fields: []string{"PROJECT_STATUS", "", "C:/Projects/Alice/Alice.rpp", "0"}})
	return reach
}

func seconds(value float64) *float64 { return &value }

// audioFinding is a Transcript Compare finding as the adapter writes it since Phase 6: its item and take GUIDs and its
// time inside the take's audio.
func audioFinding(id, itemGUID string, sourceStart, sourceEnd *float64) findings.Finding {
	finding := reviewFinding(id, "transcript-compare", "chapter-1", findings.SeverityWarning, confidenceOf(0.9))
	finding.Source = findings.Source{File: "C:/Projects/Alice/media/ch1.wav", ItemGUID: itemGUID, TakeGUID: navTake, TrackGUID: "{T}"}
	finding.TimeRange = &findings.TimeRange{Start: 100, End: 101, SourceStart: sourceStart, SourceEnd: sourceEnd}
	return finding
}

// newNavigationHost is a host connected to REAPER (a live heartbeat) over fake, holding three findings: one with its
// item and a source range, one from an older comparison with no item GUID, and one with an item but no source time.
func newNavigationHost(t *testing.T, fake *fakeNavigator) *Host {
	t.Helper()
	folder := t.TempDir()
	store := findings.NewStore(folder)
	if _, err := store.SaveAnalyzerFindings("transcript-compare", "chapter-1", []findings.Finding{
		audioFinding("with-item", navItem, seconds(12.5), seconds(13)),
		audioFinding("no-item", "", seconds(12.5), seconds(13)),
		audioFinding("no-time", navItem, nil, nil),
	}); err != nil {
		t.Fatal(err)
	}
	host := &Host{findings: store, reachability: liveReachability(), navigation: &findingNavigation{navigator: fake}}
	host.config.projectFolder = folder
	return host
}

func TestGoToSendsTheFindingsItemTakeAndSourceTimeAndAnswersWhereREAPERWent(t *testing.T) {
	fake := &fakeNavigator{navigate: bridge.Navigated{ItemGUID: navItem, ProjectTime: 102.5}}
	host := newNavigationHost(t, fake)

	got := bindingAnswer[FindingNavigation](t)(host.FindingsGoTo("with-item"))

	if got.Outcome != "navigated" || got.ProjectTime == nil || *got.ProjectTime != 102.5 || got.Reason != "" {
		t.Fatalf("got %+v", got)
	}
	target := fake.targets[0]
	if target.ItemGUID != navItem || target.TakeGUID != navTake || *target.SourceStart != 12.5 || *target.SourceEnd != 13 {
		t.Fatalf("sent %+v", target)
	}
}

func TestLoopAnswersTheWindowAndTheStatusNamesTheLoopingFindingUntilStop(t *testing.T) {
	fake := &fakeNavigator{loop: bridge.LoopStarted{ItemGUID: navItem, Start: 98.5, End: 103}, stop: bridge.LoopStopped{Restored: 2, Kept: 1}}
	host := newNavigationHost(t, fake)

	looping := bindingAnswer[FindingNavigation](t)(host.FindingsLoop("with-item"))
	if looping.Outcome != "looping" || *looping.LoopStart != 98.5 || *looping.LoopEnd != 103 {
		t.Fatalf("loop: %+v", looping)
	}
	if status := bindingAnswer[ReaperStatus](t)(host.FindingsReaperStatus()); status.Connection != "connected" || status.LoopingFindingID != "with-item" {
		t.Fatalf("status while looping: %+v", status)
	}

	stopped := bindingAnswer[FindingNavigation](t)(host.FindingsStopLoop())
	if stopped.Outcome != "stopped" || *stopped.Restored != 2 || *stopped.Kept != 1 {
		t.Fatalf("stop: %+v", stopped)
	}
	if status := bindingAnswer[ReaperStatus](t)(host.FindingsReaperStatus()); status.LoopingFindingID != "" {
		t.Fatalf("status after stop: %+v", status)
	}
}

func TestARefusedLoopLeavesTheLoopThatWasPlaying(t *testing.T) {
	fake := &fakeNavigator{loop: bridge.LoopStarted{ItemGUID: navItem, Start: 1, End: 2}}
	host := newNavigationHost(t, fake)
	bindingAnswer[FindingNavigation](t)(host.FindingsLoop("with-item"))
	fake.err = &bridge.StaleError{GUID: navItem, Reason: "range"}

	if got := bindingAnswer[FindingNavigation](t)(host.FindingsLoop("with-item")); got.Outcome != "refused" || got.Reason != "stale" {
		t.Fatalf("got %+v", got)
	}
	if status := bindingAnswer[ReaperStatus](t)(host.FindingsReaperStatus()); status.LoopingFindingID != "with-item" {
		t.Fatalf("a refused loop changed what is looping: %+v", status)
	}
}

// A finding the host cannot place is refused before anything is sent: a project time alone is never used (ADR 0121).
func TestAFindingWithoutAnItemOrATimeIsRefusedAndNothingIsSent(t *testing.T) {
	fake := &fakeNavigator{}
	host := newNavigationHost(t, fake)

	for _, check := range []struct {
		name, reason string
		call         func() (string, error)
	}{
		{"go to, no item", "no_item", func() (string, error) { return host.FindingsGoTo("no-item") }},
		{"loop, no item", "no_item", func() (string, error) { return host.FindingsLoop("no-item") }},
		{"loop, no source time", "no_source_time", func() (string, error) { return host.FindingsLoop("no-time") }},
	} {
		got := bindingAnswer[FindingNavigation](t)(check.call())
		if got.Outcome != "refused" || got.Reason != check.reason || got.Message == "" {
			t.Fatalf("%s: got %+v", check.name, got)
		}
	}
	if sent := fake.sent(); len(sent) != 0 {
		t.Fatalf("sent %v for findings that cannot be placed", sent)
	}
	// Go to with no source time goes to the item's start (the navigator's contract), so it is sent.
	if got := bindingAnswer[FindingNavigation](t)(host.FindingsGoTo("no-time")); got.Outcome != "navigated" || fake.targets[0].SourceStart != nil {
		t.Fatalf("go to with no time: %+v, %+v", got, fake.targets)
	}
}

// With no REAPER listening the request is refused before it is written, so a command never waits in the session folder
// for a REAPER that starts later and acts on it without the narrator.
func TestWithoutAListeningREAPERNothingIsSentAndTheRefusalSaysWhy(t *testing.T) {
	for _, check := range []struct {
		name, connection string
		host             func(*Host)
	}{
		{"standalone", "standalone", func(h *Host) { h.navigation.standalone = true; h.reachability = nil }},
		{"not running", "not_running", func(h *Host) { h.reachability = daw.NewReachability(nil) }},
		{"no tracker", "not_running", func(h *Host) { h.reachability = nil }},
	} {
		fake := &fakeNavigator{}
		host := newNavigationHost(t, fake)
		check.host(host)

		status := bindingAnswer[ReaperStatus](t)(host.FindingsReaperStatus())
		if status.Connection != check.connection || status.Message == "" {
			t.Fatalf("%s: status %+v", check.name, status)
		}
		for _, call := range []func() (string, error){
			func() (string, error) { return host.FindingsGoTo("with-item") },
			func() (string, error) { return host.FindingsLoop("with-item") },
			host.FindingsStopLoop,
		} {
			got := bindingAnswer[FindingNavigation](t)(call())
			if got.Outcome != "refused" || got.Reason != check.connection || got.Message != status.Message {
				t.Fatalf("%s: got %+v", check.name, got)
			}
		}
		if sent := fake.sent(); len(sent) != 0 {
			t.Fatalf("%s: sent %v", check.name, sent)
		}
	}
}

func TestWhatREAPERRefusesIsAPlainReasonAndMessage(t *testing.T) {
	for _, check := range []struct {
		err     error
		reason  string
		message string
	}{
		{&bridge.StaleError{GUID: navItem, Reason: "item"}, "stale", "no longer in the REAPER project"},
		{&bridge.StaleError{GUID: navItem, Reason: "take"}, "stale", "no longer has the take"},
		{&bridge.StaleError{GUID: navItem, Reason: "range"}, "stale", "trimmed or moved"},
		{bridge.ErrRecording, "recording", "REAPER is recording"},
		{bridge.ErrScriptOutdated, "script_outdated", "older than this app"},
		{bridge.ErrNoAnswer, "not_running", "not answering"},
		{bridge.ErrUnavailable, "standalone", "not connected"},
		{bridge.ErrNoSourceTime, "no_source_time", "no time"},
		{errors.New("the disk is full"), "failed", "the disk is full"},
	} {
		fake := &fakeNavigator{err: check.err}
		host := newNavigationHost(t, fake)
		got := bindingAnswer[FindingNavigation](t)(host.FindingsGoTo("with-item"))
		if got.Outcome != "refused" || got.Reason != check.reason || !strings.Contains(got.Message, check.message) {
			t.Fatalf("%v: got %+v", check.err, got)
		}
		if got.ProjectTime != nil {
			t.Fatalf("%v: a refusal carries a position: %+v", check.err, got)
		}
	}
}

func TestAFailedStopKeepsTheLoopToStopAgain(t *testing.T) {
	fake := &fakeNavigator{loop: bridge.LoopStarted{ItemGUID: navItem, Start: 1, End: 2}}
	host := newNavigationHost(t, fake)
	bindingAnswer[FindingNavigation](t)(host.FindingsLoop("with-item"))
	fake.err = bridge.ErrNoAnswer

	if got := bindingAnswer[FindingNavigation](t)(host.FindingsStopLoop()); got.Outcome != "refused" || got.Reason != "not_running" {
		t.Fatalf("got %+v", got)
	}
	if status := bindingAnswer[ReaperStatus](t)(host.FindingsReaperStatus()); status.LoopingFindingID != "with-item" {
		t.Fatalf("status %+v", status)
	}
}

func TestNavigatingAFindingTheProjectDoesNotHaveIsAnError(t *testing.T) {
	host := newNavigationHost(t, &fakeNavigator{})
	for _, call := range []func(string) (string, error){host.FindingsGoTo, host.FindingsLoop} {
		if _, err := call("missing"); !errors.Is(err, errFindingGone) {
			t.Fatalf("got %v", err)
		}
	}
	empty := &Host{navigation: &findingNavigation{navigator: &fakeNavigator{}}, reachability: liveReachability()}
	if _, err := empty.FindingsGoTo("with-item"); err == nil || !strings.Contains(err.Error(), "no project") {
		t.Fatalf("got %v", err)
	}
}

// configureLocked builds the navigator on the session's bridge client, next to the Transcript service, and a launch
// with no session directory (the app opened on its own) is standalone.
func TestConfigureBuildsTheNavigatorOnTheSessionsBridge(t *testing.T) {
	for _, check := range []struct {
		name       string
		sessionDir string
		standalone bool
	}{
		{"REAPER launch", t.TempDir(), false},
		{"standalone launch", "", true},
	} {
		host := newStressHost(t)
		next := host.config
		next.sessionDir = check.sessionDir
		host.mu.Lock()
		host.configureLocked(next)
		host.mu.Unlock()

		navigation := host.services().navigation
		if navigation == nil {
			t.Fatalf("%s: no navigation", check.name)
		}
		if _, ok := navigation.navigator.(*bridge.Navigator); !ok || navigation.standalone != check.standalone {
			t.Fatalf("%s: navigator %T, standalone %v", check.name, navigation.navigator, navigation.standalone)
		}
	}
}
