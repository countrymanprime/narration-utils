package main

import (
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// newTestHostWithHeartbeat is a REAPER launch with a live bridge whose last heartbeat is fields (after the tag and the
// empty run: rpp, unsaved, changeCount, then the transport), or no heartbeat at all when fields is nil.
func newTestHostWithHeartbeat(t *testing.T, fields ...string) *Host {
	t.Helper()
	host := newTestHostForDawCapabilities(t, "REAPER")
	client, err := bridge.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	reach := daw.NewReachability(nil)
	if fields != nil {
		reach.Record(bridge.Event{Tag: "PROJECT_STATUS", Fields: append([]string{"PROJECT_STATUS", ""}, fields...)})
	}
	host.bridge, host.reachability = client, reach
	return host
}

func decodeTransport(t *testing.T, payload map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

// TestDawTransportGoldenIsCurrent pins daw_transport_changed's payload (DAW port PRD Phase 9): REAPER stopped (no position),
// playing and recording (with the play position). UPDATE_CONTRACTS=1 rewrites tests/fixtures/contracts/daw-transport-*.json.
func TestDawTransportGoldenIsCurrent(t *testing.T) {
	cases := []struct{ name, playState string }{
		{"daw-transport-stopped", "0"},
		{"daw-transport-playing", "1"},
		{"daw-transport-recording", "5"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			host := newTestHostWithHeartbeat(t, "C:/Projects/Alice/Alice.rpp", "0", "7", c.playState, "12.500000")
			contractfile.Check(t, c.name, decodeTransport(t, host.dawTransport()))
		})
	}
}

// TestDawTransportIsQuietWithoutAKnownTransport: with no heartbeat to read (standalone, Audacity, a REAPER not answering,
// or an older bridge script that does not send the transport), the payload says neither playing nor recording.
func TestDawTransportIsQuietWithoutAKnownTransport(t *testing.T) {
	cases := map[string]*Host{
		"standalone":        newTestHostForDawCapabilities(t, ""),
		"audacity":          newTestHostForDawCapabilities(t, "Audacity"),
		"reaper, no bridge": newTestHostForDawCapabilities(t, "REAPER"),
		"no heartbeat":      newTestHostWithHeartbeat(t),
		"older script":      newTestHostWithHeartbeat(t, "C:/Projects/Alice/Alice.rpp", "0", "7"),
	}
	for name, host := range cases {
		got := decodeTransport(t, host.dawTransport())
		if got["playing"] != false || got["recording"] != false {
			t.Errorf("%s: dawTransport() = %v, want neither playing nor recording", name, got)
		}
		if _, has := got["position"]; has {
			t.Errorf("%s: dawTransport() = %v, want no position", name, got)
		}
	}
}

// TestDawTransportHeartbeatTurnedOffIsQuiet: the transport is read through the heartbeat capability, so a narrator who
// turned that capability off gets no transport, the same as any other role the resolver refuses.
func TestDawTransportHeartbeatTurnedOffIsQuiet(t *testing.T) {
	host := newTestHostWithHeartbeat(t, "C:/Projects/Alice/Alice.rpp", "0", "7", "5", "12.500000")
	off := "off"
	if err := host.saveSettings("DAW", "global", map[string]*string{dawport.ToggleKey(dawport.CapHeartbeat): &off}); err != nil {
		t.Fatal(err)
	}
	if got := decodeTransport(t, host.dawTransport()); got["recording"] != false {
		t.Fatalf("dawTransport() = %v with the heartbeat capability turned off, want not recording", got)
	}
}

// TestDawTransportChangedOnlyWhenThePayloadChanges is the dedupe pollDawTransport relies on: the first read after launch
// and every real change report a change, and the same transport on the next tick does not.
func TestDawTransportChangedOnlyWhenThePayloadChanges(t *testing.T) {
	host := newTestHostWithHeartbeat(t, "C:/Projects/Alice/Alice.rpp", "0", "7", "0", "1.000000")
	if _, changed := host.dawTransportChanged(); !changed {
		t.Fatal("the first read must count as a change, so the UI hears the transport once")
	}
	if _, changed := host.dawTransportChanged(); changed {
		t.Fatal("an unchanged transport must not be pushed again on the next tick")
	}
	host.reachability.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/Projects/Alice/Alice.rpp", "0", "8", "5", "2.000000"}})
	payload, changed := host.dawTransportChanged()
	if !changed || decodeTransport(t, payload)["recording"] != true {
		t.Fatalf("a record start must be pushed: changed = %v, payload = %v", changed, payload)
	}
	// Only the edit counter moved: the transport payload is the same, so nothing is pushed.
	host.reachability.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/Projects/Alice/Alice.rpp", "0", "9", "5", "2.000000"}})
	if _, changed := host.dawTransportChanged(); changed {
		t.Fatal("a heartbeat whose transport did not change must not be pushed")
	}
}
