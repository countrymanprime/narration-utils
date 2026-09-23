package projectstate

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

func testService(t *testing.T) (*Service, string) {
	t.Helper()
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	return New(Config{SessionDir: session}, client, nil), session
}

func firstCommand(t *testing.T, session string) string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(session, "commands"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("commands = %#v, %v", entries, err)
	}
	bytes, err := os.ReadFile(filepath.Join(session, "commands", entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}

func appendEvents(t *testing.T, session string, lines ...string) {
	t.Helper()
	file, err := os.OpenFile(filepath.Join(session, "events.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	if _, err := file.WriteString(strings.Join(lines, "\n") + "\n"); err != nil {
		t.Fatal(err)
	}
}

func equalFields(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestCheckSendsTheExactBridgeCommand(t *testing.T) {
	service, session := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "checking" || state["runId"] == nil {
		t.Fatalf("unexpected checking state: %#v", state)
	}
	runID := state["runId"].(string)
	command := firstCommand(t, session)
	wantPrefix := "1|project_state|" + runID
	if !strings.HasPrefix(command, wantPrefix) {
		t.Fatalf("command = %q, want prefix %q", command, wantPrefix)
	}
	decoded, err := bridge.DecodeFields(strings.TrimSuffix(command, "\n"))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"1", "project_state", runID}; !equalFields(decoded, want) {
		t.Fatalf("decoded = %#v, want %#v", decoded, want)
	}
}

func TestCheckWithoutABridgeFails(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Check(); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestHandleProjectStateReportsTheCountAndStatsTheSavedFile(t *testing.T) {
	service, session := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)

	project := filepath.Join(t.TempDir(), "Book.rpp")
	if err := os.WriteFile(project, []byte("saved"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(project)
	if err != nil {
		t.Fatal(err)
	}

	appendEvents(t, session, "PROJECT_STATE|"+runID+"|7|"+project)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "success" {
		t.Fatalf("phase = %v, want success: %#v", state["phase"], state)
	}
	if state["changeCount"].(float64) != 7 || state["projectFile"] != project {
		t.Fatalf("state = %#v", state)
	}
	gotMillis := int64(state["savedModifiedAt"].(float64))
	if gotMillis != info.ModTime().UnixMilli() {
		t.Fatalf("savedModifiedAt = %v, want %v", gotMillis, info.ModTime().UnixMilli())
	}
}

func TestHandleProjectStateWithNoSavedFileLeavesModifiedAtNil(t *testing.T) {
	service, session := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "PROJECT_STATE|"+runID+"|0|")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["savedModifiedAt"] != nil {
		t.Fatalf("savedModifiedAt = %v, want nil for a never-saved project", state["savedModifiedAt"])
	}
	if state["projectFile"] != "" {
		t.Fatalf("projectFile = %v, want empty", state["projectFile"])
	}
}

func TestHandleProjectStateWithAMissingFileLeavesModifiedAtNil(t *testing.T) {
	service, session := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	missing := filepath.Join(t.TempDir(), "gone.rpp")
	appendEvents(t, session, "PROJECT_STATE|"+runID+"|1|"+missing)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["savedModifiedAt"] != nil {
		t.Fatalf("savedModifiedAt = %v, want nil for a file that does not exist", state["savedModifiedAt"])
	}
}

func TestHandleIgnoresAnEventForAnotherRun(t *testing.T) {
	service, session := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	appendEvents(t, session, "PROJECT_STATE|not-this-run|9|C:/Book.rpp")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "checking" {
		t.Fatalf("phase = %v, want checking (unowned event must be ignored)", state["phase"])
	}
}

func TestHandleErrorReportsTheMessage(t *testing.T) {
	service, session := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "ERROR|"+runID+"|This REAPER version cannot report the project change count.")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "error" || state["message"] != "This REAPER version cannot report the project change count." {
		t.Fatalf("state = %#v", state)
	}
}

// A fan-out sharing test (bridge.Client fans events out by tag and run, ADR 0068): a second subscriber on the
// same client must not steal or lose this service's event.
func TestDrainSharesTheBridgeWithAnotherConsumerWithoutLosingOrStealingEvents(t *testing.T) {
	service, session := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	var others []string
	service.bridge.Subscribe(bridge.Subscription{
		Tags:   []string{"COMPARE_*"},
		Owns:   func(id string) bool { return id == "compare-1" },
		Handle: func(event bridge.Event) { others = append(others, event.Tag+"|"+event.RunID) },
	})
	appendEvents(t, session,
		"PROJECT_STATE|"+runID+"|3|C:/Book.rpp",
		"COMPARE_INSPECTED|compare-1|1 discrepancy found.|1|0",
	)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "success" {
		t.Fatalf("this service must still get its own events: %#v", state)
	}
	if want := []string{"COMPARE_INSPECTED|compare-1"}; len(others) != 1 || others[0] != want[0] {
		t.Fatalf("the other consumer got %v, want %v", others, want)
	}
}

func TestChangedSince(t *testing.T) {
	cases := []struct {
		current, baseline int
		want              bool
	}{
		{5, 5, false},
		{6, 5, true},
		{0, 0, false},
		{0, 1, true},
	}
	for _, tc := range cases {
		if got := ChangedSince(tc.current, tc.baseline); got != tc.want {
			t.Errorf("ChangedSince(%d, %d) = %v, want %v", tc.current, tc.baseline, got, tc.want)
		}
	}
}

func TestSnapshotOfAServiceWithNoBridgeIsIdle(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	state := service.Snapshot()
	if state["phase"] != "idle" || state["runId"] != nil || state["changeCount"] != nil {
		t.Fatalf("state = %#v, want idle", state)
	}
}

func TestDrainWithNoBridgeIsANoOp(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Drain(); err != nil {
		t.Fatalf("Drain() = %v, want nil for a service with no bridge", err)
	}
}

// Check reports the same failure Send would (a session directory that vanished after the client was built), and
// notifies the changed callback with the error state (fail's other branch, not exercised by the happy path above).
func TestCheckReportsAndNotifiesWhenSendFails(t *testing.T) {
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(session); err != nil {
		t.Fatal(err)
	}
	var notified []map[string]any
	service := New(Config{SessionDir: session}, client, func(state map[string]any) { notified = append(notified, state) })
	if err := service.Check(); err == nil {
		t.Fatal("Check() = nil, want an error once the session directory is gone")
	}
	state := service.Snapshot()
	if state["phase"] != "error" {
		t.Fatalf("phase = %v, want error", state["phase"])
	}
	if len(notified) == 0 || notified[len(notified)-1]["phase"] != "error" {
		t.Fatalf("notified = %#v, want a final error state", notified)
	}
}

func TestHandleInvalidReportsWhileChecking(t *testing.T) {
	service, _ := testService(t)
	if err := service.Check(); err != nil {
		t.Fatal(err)
	}
	var notified []map[string]any
	service.changed = func(state map[string]any) { notified = append(notified, state) }
	service.handleInvalid(bridge.Event{Tag: "PROJECT_STATE"}, errors.New("too few fields"))
	state := service.Snapshot()
	if state["phase"] != "error" || !strings.Contains(state["message"].(string), "too few fields") {
		t.Fatalf("state = %#v", state)
	}
	if len(notified) != 1 {
		t.Fatalf("notified = %#v, want exactly one notification", notified)
	}
}

func TestHandleInvalidIgnoredOutsideChecking(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	before := service.Snapshot()
	service.handleInvalid(bridge.Event{Tag: "PROJECT_STATE"}, errors.New("boom"))
	if after := service.Snapshot(); after["phase"] != before["phase"] {
		t.Fatalf("handleInvalid changed an idle service's phase: %#v", after)
	}
}
