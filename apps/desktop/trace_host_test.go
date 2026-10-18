package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// traceRecords is what the host's tracer holds in its in-memory ring, one decoded record per line.
func traceRecords(t *testing.T, host *Host, event string) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range host.tracer.Snapshot() {
		var record map[string]any
		if err := json.Unmarshal(line, &record); err != nil {
			t.Fatalf("trace line is not JSON: %q: %v", line, err)
		}
		if area, name, _ := strings.Cut(event, "."); record["area"] == area && record["event"] == name {
			records = append(records, record)
		}
	}
	return records
}

func TestTheCapabilityPollTracesReachabilityFlipsOnce(t *testing.T) {
	host, reach := newTestHostWithHeartbeat(t)
	host.pollDawCapabilities()
	host.pollDawCapabilities()
	flips := traceRecords(t, host, "daw.reachable_changed")
	if len(flips) != 1 {
		t.Fatalf("two polls of an unchanged state wrote %d reachability records, want 1", len(flips))
	}
	first := flips[0]
	if first["kind"] != "reaper" || first["reachable"] != false || first["heard"] != false || first["age_ms"] != float64(-1) || first["timeout_ms"] != float64(5000) {
		t.Errorf("first look = %v, want REAPER unreachable, never heard, age -1, timeout 5000", first)
	}

	reach.Record(bridge.Event{Tag: "PROJECT_STATUS", Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0"}})
	host.pollDawCapabilities()
	flips = traceRecords(t, host, "daw.reachable_changed")
	if len(flips) != 2 || flips[1]["reachable"] != true || flips[1]["heard"] != true {
		t.Fatalf("after a heartbeat the records are %v, want a second one saying reachable and heard", flips)
	}
}

func TestTheCapabilityPollTracesEachUnavailableCapabilityWithItsReason(t *testing.T) {
	host, _ := newTestHostWithHeartbeat(t)
	host.pollDawCapabilities()
	summary := traceRecords(t, host, "daw.caps_changed")
	if len(summary) != 1 {
		t.Fatalf("got %d capability summaries, want 1", len(summary))
	}
	unavailable := traceRecords(t, host, "daw.cap_unavailable")
	if float64(len(unavailable)) != summary[0]["unavailable"] || len(unavailable) == 0 {
		t.Fatalf("summary says %v unavailable, %d records follow", summary[0]["unavailable"], len(unavailable))
	}
	for _, record := range unavailable {
		if record["capability"] == nil || record["reason"] == nil {
			t.Errorf("an unavailable capability without its reason: %v", record)
		}
	}
	host.pollDawCapabilities()
	if again := traceRecords(t, host, "daw.caps_changed"); len(again) != 1 {
		t.Errorf("an unchanged report was written again: %d summaries", len(again))
	}
}

func TestStartTraceIsOnOnlyForADevelopmentBuild(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "")
	host.version = "0.5.1"
	host.startTrace()
	if host.tracer.Enabled() {
		t.Error("a stamped version turned the trace on")
	}
	if started := traceRecords(t, host, "app.start"); len(started) != 1 || started[0]["dev"] != false || started[0]["version"] != "0.5.1" {
		t.Errorf("app.start = %v, want one record for 0.5.1 with dev false", started)
	}
	host.version = developmentVersion
	host.startTrace()
	if !host.tracer.Enabled() {
		t.Error("a build run from source left the trace off")
	}
	host.tracer.Close()
}

func TestTheBridgeReaderIsTracedOnlyWhenItsErrorClassChanges(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "")
	host.traceDrain(nil)
	host.traceDrain(os.ErrPermission)
	host.traceDrain(os.ErrPermission)
	host.traceDrain(nil)
	host.traceDrain(nil)
	var classes []any
	for _, record := range traceRecords(t, host, "daw.dispatch_error") {
		classes = append(classes, record["err"])
	}
	if len(classes) != 2 || classes[0] != "permission" || classes[1] != "none" {
		t.Errorf("classes = %v, want [permission none]", classes)
	}
}

func TestARejectedReaperEventIsTraced(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "")
	host.traceBridgeLog("reaper_event_invalid")
	host.traceBridgeLog("some_other_kind")
	if rejected := traceRecords(t, host, "daw.event_rejected"); len(rejected) != 1 {
		t.Errorf("got %d rejected-event records, want 1", len(rejected))
	}
}

func TestTheBridgeSetupIsTracedWithTheReasonItWasNotOpened(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "")
	host.traceDawBridge(dawport.KindREAPER, "", false, nil)
	host.traceDawBridge(dawport.KindAudacity, "S", false, nil)
	host.traceDawBridge(dawport.KindREAPER, "S", false, errors.New("mkdir failed"))
	host.traceDawBridge(dawport.KindREAPER, "S", true, nil)
	var reasons []any
	for _, record := range traceRecords(t, host, "daw.client") {
		reasons = append(reasons, record["reason"])
	}
	want := []any{"no_session_dir", "audacity_project", "bridge_new_failed", "ok"}
	if len(reasons) != len(want) {
		t.Fatalf("reasons = %v, want %v", reasons, want)
	}
	for i := range want {
		if reasons[i] != want[i] {
			t.Errorf("reason %d = %v, want %v", i, reasons[i], want[i])
		}
	}
}

func TestTheLinkFactsTraceNamesWhyThereIsNoMatch(t *testing.T) {
	host, reach := newTestHostWithHeartbeat(t, "C:/p/Book.rpp", "0")
	host.traceDawLink(t.TempDir(), reach, false, true, false)
	host.traceDawLink(t.TempDir(), nil, false, false, false)
	facts := traceRecords(t, host, "daw.link_facts")
	if len(facts) != 2 || facts[0]["reason"] != "no_link" || facts[1]["reason"] != "no_heartbeat" {
		t.Errorf("link facts = %v, want reasons no_link then no_heartbeat", facts)
	}
}

// TestNoCanaryReachesTheHostTrace runs the host's DAW events with a session folder and a project path that hold names a
// narrator would not want in a log, and checks neither appears in anything the tracer kept.
func TestNoCanaryReachesTheHostTrace(t *testing.T) {
	host, reach := newTestHostWithHeartbeat(t, `C:\Users\CANARYUSER\Books\CANARY_Novel\Book.rpp`, "0")
	host.tracer.SetProjectRoot(`C:\Users\CANARYUSER\Books\CANARY_Novel`)
	host.traceDawBridge(dawport.KindREAPER, `C:\Users\CANARYUSER\AppData\REAPER\NarrationUtils\sessions\hub_CANARY`, true, errors.New(`open C:\Users\CANARYUSER\x: denied`))
	host.pollDawCapabilities()
	host.traceDawLink(`C:\Users\CANARYUSER\Books\CANARY_Novel`, reach, true, true, true)
	host.traceDrain(errors.New(`read C:\Users\CANARYUSER\events.log: CANARY_TEXT`))
	for _, line := range host.tracer.Snapshot() {
		if strings.Contains(strings.ToUpper(string(line)), "CANARY") {
			t.Errorf("the trace holds a canary: %s", line)
		}
	}
}
