package renderconfig

import (
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

func TestConfigureSendsTheExactBridgeCommand(t *testing.T) {
	service, session := testService(t)
	if err := service.Configure(`C:\project\renders`); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "configuring" || state["runId"] == nil {
		t.Fatalf("unexpected configure state: %#v", state)
	}
	runID := state["runId"].(string)
	command := firstCommand(t, session)
	wantPrefix := "1|configure_chapter_render|" + runID + "|"
	if !strings.HasPrefix(command, wantPrefix) {
		t.Fatalf("command = %q, want prefix %q", command, wantPrefix)
	}
	decoded, err := bridge.DecodeFields(strings.TrimSuffix(command, "\n"))
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"1", "configure_chapter_render", runID, `C:\project\renders`}; !equalFields(decoded, want) {
		t.Fatalf("decoded = %#v, want %#v", decoded, want)
	}
}

func TestConfigureRejectsAnEmptyFolder(t *testing.T) {
	service, _ := testService(t)
	if err := service.Configure("   "); err == nil || !strings.Contains(err.Error(), "output folder is required") {
		t.Fatalf("err = %v", err)
	}
}

func TestConfigureWithoutABridgeFails(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Configure("C:/renders"); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestHandleConfiguredReportsTheTargetsThenSucceeds(t *testing.T) {
	service, session := testService(t)
	if err := service.Configure("C:/project/renders"); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "RENDER_CONFIGURED|"+runID+"|C:/project/renders|2|C:/project/renders/Chapter 1.wav;C:/project/renders/Chapter 2.wav")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "success" {
		t.Fatalf("phase = %v, want success: %#v", state["phase"], state)
	}
	if state["folder"] != "C:/project/renders" || state["count"].(float64) != 2 {
		t.Fatalf("state = %#v", state)
	}
	targets := state["targets"].([]any)
	if len(targets) != 2 || targets[0] != "C:/project/renders/Chapter 1.wav" || targets[1] != "C:/project/renders/Chapter 2.wav" {
		t.Fatalf("targets = %#v", targets)
	}
}

func TestHandleConfiguredWithZeroRegionsReportsAnEmptyTargetList(t *testing.T) {
	service, session := testService(t)
	if err := service.Configure("C:/project/renders"); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "RENDER_CONFIGURED|"+runID+"|C:/project/renders|0|")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	targets := state["targets"].([]any)
	if len(targets) != 0 {
		t.Fatalf("targets = %#v, want empty", targets)
	}
	if !strings.Contains(state["message"].(string), "No chapter regions") {
		t.Fatalf("message = %v", state["message"])
	}
}

func TestHandleIgnoresAnEventForAnotherRun(t *testing.T) {
	service, session := testService(t)
	if err := service.Configure("C:/renders"); err != nil {
		t.Fatal(err)
	}
	appendEvents(t, session, "RENDER_CONFIGURED|not-this-run|C:/renders|1|C:/renders/Chapter 1.wav")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "configuring" {
		t.Fatalf("phase = %v, want configuring (unowned event must be ignored)", state["phase"])
	}
}

func TestHandleErrorReportsTheMessage(t *testing.T) {
	service, session := testService(t)
	if err := service.Configure("C:/renders"); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "ERROR|"+runID+"|This REAPER version cannot configure render settings.")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "error" || state["message"] != "This REAPER version cannot configure render settings." {
		t.Fatalf("state = %#v", state)
	}
}

// A fan-out sharing test (bridge.Client fans events out by tag and run, ADR 0068): a second subscriber on the
// same client must not steal or lose this service's event.
func TestDrainSharesTheBridgeWithAnotherConsumerWithoutLosingOrStealingEvents(t *testing.T) {
	service, session := testService(t)
	if err := service.Configure("C:/renders"); err != nil {
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
		"RENDER_CONFIGURED|"+runID+"|C:/renders|1|C:/renders/Chapter 1.wav",
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

func TestSuggestedFolder(t *testing.T) {
	if got := SuggestedFolder(""); got != "" {
		t.Fatalf("SuggestedFolder(\"\") = %q, want empty", got)
	}
	want := filepath.Join("C:/project", "renders")
	if got := SuggestedFolder("C:/project"); got != want {
		t.Fatalf("SuggestedFolder = %q, want %q", got, want)
	}
}
