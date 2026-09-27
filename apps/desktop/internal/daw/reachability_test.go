package daw

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

func TestReachabilityWithNoHeartbeatIsUnreachable(t *testing.T) {
	reach := NewReachability(nil)
	if reach.Reachable() {
		t.Fatal("Reachable() = true, want false: no heartbeat ever arrived")
	}
	if reach.Matches("C:/p/Book.rpp") {
		t.Fatal("Matches() = true, want false: no heartbeat ever arrived")
	}
}

func TestReachabilityWithNilClientNeverBecomesReachable(t *testing.T) {
	reach := NewReachability(nil)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0"}})
	if !reach.Reachable() {
		t.Fatal("a nil client still lets a manually delivered event record a heartbeat")
	}
}

func TestReachabilityBecomesUnreachableAfterTheHeartbeatTimeout(t *testing.T) {
	reach := NewReachability(nil)
	clock := time.Now()
	reach.now = func() time.Time { return clock }
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0"}})
	if !reach.Reachable() {
		t.Fatal("Reachable() = false right after a heartbeat, want true")
	}
	clock = clock.Add(heartbeatTimeout + time.Second)
	if reach.Reachable() {
		t.Fatal("Reachable() = true after the heartbeat timeout elapsed, want false")
	}
}

func TestReachabilityCurrentProjectReflectsTheLastHeartbeat(t *testing.T) {
	reach := NewReachability(nil)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "", "1"}})
	rpp, unsaved := reach.CurrentProject()
	if rpp != "" || !unsaved {
		t.Fatalf("CurrentProject() = (%q, %v), want empty rpp and unsaved true", rpp, unsaved)
	}
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0"}})
	rpp, unsaved = reach.CurrentProject()
	if rpp != "C:/p/Book.rpp" || unsaved {
		t.Fatalf("CurrentProject() = (%q, %v), want the saved path and unsaved false", rpp, unsaved)
	}
}

func TestReachabilityMatchesIsCaseInsensitiveAndNormalizesSeparators(t *testing.T) {
	reach := NewReachability(nil)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", `C:\Projects\Book\Book.rpp`, "0"}})
	if !reach.Matches(`c:\projects\book\book.rpp`) {
		t.Fatal("Matches() = false, want true: same file, different case")
	}
	if reach.Matches(`C:\Projects\Other\Other.rpp`) {
		t.Fatal("Matches() = true, want false: a different linked file")
	}
}

func TestReachabilityDoesNotMatchAnUnsavedOpenProject(t *testing.T) {
	reach := NewReachability(nil)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "", "1"}})
	if reach.Matches("C:/p/Book.rpp") {
		t.Fatal("an unsaved open project must never match a linked file")
	}
}

func TestReachabilityMatchesIsFalseWithNoLinkedPath(t *testing.T) {
	reach := NewReachability(nil)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0"}})
	if reach.Matches("") {
		t.Fatal("an empty linked path must never match")
	}
}

// TestReachabilitySubscribesToARealBridgeClient is the integration path: a real bridge.Client dispatching a real
// events.log, the same wiring apps/desktop/app.go's configureLocked uses.
func TestReachabilitySubscribesToARealBridgeClient(t *testing.T) {
	dir := t.TempDir()
	client, err := bridge.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	reach := NewReachability(client)
	if reach.Reachable() {
		t.Fatal("Reachable() = true before any event was dispatched")
	}
	line := "PROJECT_STATUS||" + bridge.PercentEncode(filepath.Join(dir, "Book.rpp")) + "|0\n"
	if err := os.WriteFile(filepath.Join(dir, "events.log"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := client.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if !reach.Reachable() {
		t.Fatal("Reachable() = false after a real PROJECT_STATUS event was dispatched")
	}
	rpp, unsaved := reach.CurrentProject()
	if rpp != filepath.Join(dir, "Book.rpp") || unsaved {
		t.Fatalf("CurrentProject() = (%q, %v), want the dispatched path and unsaved false", rpp, unsaved)
	}
}

func TestReachabilityKeepsREAPERsEditCounterFromTheHeartbeat(t *testing.T) {
	reach := NewReachability(nil)
	if _, known := reach.ChangeCount(); known {
		t.Fatal("ChangeCount() is known before any heartbeat")
	}
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "41"}})
	if count, known := reach.ChangeCount(); !known || count != 41 {
		t.Fatalf("ChangeCount() = (%d, %v), want (41, true)", count, known)
	}
}

func TestReachabilityForgetsTheEditCounterWhenAHeartbeatDoesNotCarryOne(t *testing.T) {
	reach := NewReachability(nil)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "41"}})
	// An older script (three fields) and a REAPER without GetProjectStateChangeCount (an empty fourth field).
	for _, fields := range [][]string{{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0"}, {"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", ""}} {
		reach.Record(bridge.Event{Fields: fields})
		if _, known := reach.ChangeCount(); known {
			t.Fatalf("ChangeCount() is still known after %v", fields)
		}
	}
}

func TestReachabilityChangeCountIsUnknownOnceTheHeartbeatIsStale(t *testing.T) {
	reach := NewReachability(nil)
	clock := time.Now()
	reach.now = func() time.Time { return clock }
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "3"}})
	clock = clock.Add(heartbeatTimeout + time.Second)
	if _, known := reach.ChangeCount(); known {
		t.Fatal("ChangeCount() is known from a stale heartbeat")
	}
}

// DAW port PRD Phase 9 (ADR 0305): the heartbeat's fifth and sixth fields are the transport, GetPlayState's bit field and
// GetPlayPosition, so the host knows REAPER is playing or recording without asking it.
func TestReachabilityTransportFollowsTheHeartbeat(t *testing.T) {
	cases := []struct {
		name      string
		playState string
		want      Transport
	}{
		{"stopped", "0", Transport{Position: 12.5}},
		{"playing", "1", Transport{Playing: true, Position: 12.5}},
		{"paused", "2", Transport{Position: 12.5}},
		{"recording", "5", Transport{Playing: true, Recording: true, Position: 12.5}},
		// A paused recording still has its take open: the booth keeps quiet until it is stopped.
		{"recording paused", "6", Transport{Recording: true, Position: 12.5}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			reach := NewReachability(nil)
			reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "3", c.playState, "12.500000"}})
			got, ok := reach.Transport()
			if !ok || got != c.want {
				t.Fatalf("Transport() = (%+v, %v), want (%+v, true)", got, ok, c.want)
			}
		})
	}
}

func TestReachabilityTransportIsUnknownWithoutTheFields(t *testing.T) {
	reach := NewReachability(nil)
	if _, ok := reach.Transport(); ok {
		t.Fatal("Transport() ok with no heartbeat at all")
	}
	// An older bridge script's heartbeat, with no transport fields.
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "3"}})
	if _, ok := reach.Transport(); ok {
		t.Fatal("Transport() ok from a heartbeat that carried no transport")
	}
	// A later heartbeat that carries one, then an older-shaped one again: the stale transport is not kept.
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "3", "5", "1.000000"}})
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "3"}})
	if _, ok := reach.Transport(); ok {
		t.Fatal("Transport() kept a transport the last heartbeat did not carry")
	}
}

func TestReachabilityTransportIsUnknownOnceTheHeartbeatIsStale(t *testing.T) {
	reach := NewReachability(nil)
	clock := time.Now()
	reach.now = func() time.Time { return clock }
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", "C:/p/Book.rpp", "0", "3", "5", "1.000000"}})
	clock = clock.Add(heartbeatTimeout + time.Second)
	if got, ok := reach.Transport(); ok {
		t.Fatalf("Transport() = (%+v, true) after the heartbeat timed out: a closed REAPER is not still recording", got)
	}
}
