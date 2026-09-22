package pickups

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

func TestImportWritesTheExactPayloadAndBridgeContract(t *testing.T) {
	service, session := testService(t)
	rows := []Row{{Start: 1.5, Tag: "narrator", Note: "Mispronounced"}, {Start: 9.25, Note: "Second pickup"}}
	if err := service.Import(rows); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "importing" || state["runId"] == nil {
		t.Fatalf("unexpected import state: %#v", state)
	}
	runID := state["runId"].(string)
	command := firstCommand(t, session)
	if !strings.HasPrefix(command, "1|import_pickups|"+runID+"|") {
		t.Fatalf("command = %q", command)
	}
	payload, err := os.ReadFile(filepath.Join(session, "pickups_import_"+runID+".txt"))
	if err != nil {
		t.Fatal(err)
	}
	want := "1.500000|narrator|Mispronounced\n9.250000||Second pickup\n"
	if string(payload) != want {
		t.Fatalf("payload = %q, want %q", payload, want)
	}
}

func TestImportRejectsAnEmptyRowList(t *testing.T) {
	service, _ := testService(t)
	if err := service.Import(nil); err == nil || !strings.Contains(err.Error(), "select at least one pickup") {
		t.Fatalf("err = %v", err)
	}
}

func TestImportWithoutABridgeFails(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Import([]Row{{Start: 1, Note: "x"}}); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestHandleImportedReportsCountsThenSucceeds(t *testing.T) {
	service, session := testService(t)
	if err := service.Import([]Row{{Start: 1, Note: "x"}}); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "PICKUPS_IMPORTED|"+runID+"|2|1|0")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "success" {
		t.Fatalf("phase = %v, want success: %#v", state["phase"], state)
	}
	report := state["importReport"].(map[string]any)
	if report["added"] != float64(2) || report["existing"] != float64(1) || report["invalid"] != float64(0) {
		t.Fatalf("importReport = %#v", report)
	}
	if state["message"] != "Imported 2 pickups, 1 already there." {
		t.Fatalf("message = %v", state["message"])
	}
}

func TestExportWritesTheExactBridgeContractThenBuildsCSV(t *testing.T) {
	service, session := testService(t)
	if err := service.Export(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	runID := state["runId"].(string)
	command := firstCommand(t, session)
	if !strings.HasPrefix(command, "1|export_pickups|"+runID+"|") {
		t.Fatalf("command = %q", command)
	}
	path := filepath.Join(session, "pickups_export_"+runID+".txt")
	payload := "1.500000|narrator|Mispronounced\n9.250000||Second pickup, with a comma\n"
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	appendEvents(t, session, "PICKUPS_EXPORTED|"+runID+"|"+bridge.PercentEncode(path)+"|2")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state = service.Snapshot()
	if state["phase"] != "success" || state["message"] != "Exported 2 pickups." {
		t.Fatalf("state = %#v", state)
	}
	csvText := state["csv"].(string)
	if !strings.Contains(csvText, "start,note,tag") || !strings.Contains(csvText, "1.500000,Mispronounced,narrator") {
		t.Fatalf("csv = %q", csvText)
	}
	if !strings.Contains(csvText, `"Second pickup, with a comma"`) {
		t.Fatalf("csv did not quote a field containing a comma: %q", csvText)
	}
}

func TestNextWritesTheExactBridgeContractThenReportsThePosition(t *testing.T) {
	service, session := testService(t)
	if err := service.Next(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	command := firstCommand(t, session)
	if command != "1|next_pickup|"+runID+"\n" {
		t.Fatalf("command = %q", command)
	}
	appendEvents(t, session, "PICKUP_NEXT|"+runID+"|9.25|narrator|Mispronounced")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	next := state["next"].(map[string]any)
	if next["position"] != 9.25 || next["tag"] != "narrator" || next["note"] != "Mispronounced" {
		t.Fatalf("next = %#v", next)
	}
}

func TestResolveSendsThePositionThenReportsTheResolvedPickup(t *testing.T) {
	service, session := testService(t)
	if err := service.Resolve(9.25); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	command := firstCommand(t, session)
	if command != "1|resolve_pickup|"+runID+"|9.250000\n" {
		t.Fatalf("command = %q", command)
	}
	appendEvents(t, session, "PICKUP_RESOLVED|"+runID+"|9.25|narrator|Mispronounced")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	resolved := state["resolved"].(map[string]any)
	if resolved["position"] != 9.25 || resolved["note"] != "Mispronounced" {
		t.Fatalf("resolved = %#v", resolved)
	}
}

func TestCountReportsRemainingAndTotal(t *testing.T) {
	service, session := testService(t)
	if err := service.Count(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "PICKUPS_COUNTED|"+runID+"|3|5")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["remaining"] != float64(3) || state["total"] != float64(5) {
		t.Fatalf("state = %#v", state)
	}
}

func TestARunsCountsSurviveIntoTheNextRunUntilItReportsItsOwn(t *testing.T) {
	service, session := testService(t)
	if err := service.Count(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "PICKUPS_COUNTED|"+runID+"|3|5")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if err := service.Next(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["remaining"] != float64(3) || state["total"] != float64(5) {
		t.Fatalf("counts did not survive into the next run: %#v", state)
	}
}

func TestDrainSharesTheBridgeWithAnotherConsumerWithoutLosingOrStealingEvents(t *testing.T) {
	service, session := testService(t)
	if err := service.Count(); err != nil {
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
		"PICKUPS_COUNTED|"+runID+"|1|2",
		"COMPARE_INSPECTED|compare-1|1%20discrepancy%20found.|1|0",
	)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "success" {
		t.Fatalf("this service must still get its own events: %#v", state)
	}
	if want := []string{"COMPARE_INSPECTED|compare-1"}; len(others) != 1 || others[0] != want[0] {
		t.Fatalf("the other consumer got %v, want %v", others, want)
	}
}

func TestAnErrorForTheRunInProgressReachesTheState(t *testing.T) {
	service, session := testService(t)
	if err := service.Import([]Row{{Start: 1, Note: "x"}}); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	appendEvents(t, session, "ERROR|"+runID+"|This%20REAPER%20version%20cannot%20add%20markers.")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "error" || state["message"] != "This REAPER version cannot add markers." {
		t.Fatalf("state = %#v", state)
	}
}

func TestAnErrorForAnotherRunIsNotShownAsThisRunsError(t *testing.T) {
	service, session := testService(t)
	if err := service.Count(); err != nil {
		t.Fatal(err)
	}
	appendEvents(t, session, "ERROR|some-other-run|Some%20other%20runs%20problem.")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "counting" {
		t.Fatalf("a stale run's error changed the current run: %#v", state)
	}
}

func TestDrainWithoutABridgeIsANoOp(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
}
