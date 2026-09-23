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
