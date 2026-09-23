package cleanuptools

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

func commandFiles(t *testing.T, session string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(session, "commands"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	var out []string
	for _, entry := range entries {
		bytes, err := os.ReadFile(filepath.Join(session, "commands", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, string(bytes))
	}
	return out
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

func launch(t *testing.T, service *Service, tool string) string {
	t.Helper()
	if err := service.Launch(tool); err != nil {
		t.Fatal(err)
	}
	return service.Snapshot()["runId"].(string)
}

func TestLaunchSendsTheExactBridgeCommand(t *testing.T) {
	service, session := testService(t)
	runID := launch(t, service, "repair_pops_clicks")
	state := service.Snapshot()
	if state["phase"] != "launching" || state["tool"] != "repair_pops_clicks" {
		t.Fatalf("state = %#v", state)
	}
	commands := commandFiles(t, session)
	if len(commands) != 1 {
		t.Fatalf("commands = %#v", commands)
	}
	decoded, err := bridge.DecodeFields(strings.TrimSuffix(commands[0], "\n"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"1", "launch_cleanup_tool", runID, "repair_pops_clicks"}
	if strings.Join(decoded, "|") != strings.Join(want, "|") {
		t.Fatalf("decoded = %#v, want %#v", decoded, want)
	}
}

func TestLaunchRefusesAToolOffTheAllowListAndSendsNothing(t *testing.T) {
	for _, tool := range []string{"", "40209", "_RS1234", "Item: Apply track/take FX to items", "Repair_Pops_Clicks", "repair_pops_clicks|40209"} {
		service, session := testService(t)
		if err := service.Launch(tool); err == nil || !strings.Contains(err.Error(), "unknown cleanup tool") {
			t.Fatalf("%q: err = %v", tool, err)
		}
		if commands := commandFiles(t, session); len(commands) != 0 {
			t.Fatalf("%q: a refused tool still sent %#v", tool, commands)
		}
		if service.Snapshot()["phase"] != "idle" {
			t.Fatalf("%q: a refused tool changed the state: %#v", tool, service.Snapshot())
		}
	}
}

func TestEveryAllowListedToolIsLaunchable(t *testing.T) {
	for _, tool := range Tools {
		service, _ := testService(t)
		if err := service.Launch(tool.Key); err != nil {
			t.Fatalf("%s: %v", tool.Key, err)
		}
	}
	if len(Tools) != 2 || Tools[0].Key != "repair_pops_clicks" || Tools[1].Key != "magnolius_declick" {
		t.Fatalf("the allow-list changed without its Lua twin: %#v", Tools)
	}
}

func TestLaunchWithoutABridgeFails(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Launch("repair_pops_clicks"); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestLaunchedReportsTheOpenedAction(t *testing.T) {
	service, session := testService(t)
	runID := launch(t, service, "repair_pops_clicks")
	appendEvents(t, session, "CLEANUP_LAUNCHED|"+runID+"|repair_pops_clicks|Item%3A Repair pops%2Fclicks...")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "launched" || state["action"] != "Item: Repair pops/clicks..." {
		t.Fatalf("state = %#v", state)
	}
	if message, _ := state["message"].(string); !strings.Contains(message, "Repair Pops/Clicks is open in REAPER") {
		t.Fatalf("message = %q", message)
	}
}

func TestAnErrorForThisRunIsReported(t *testing.T) {
	service, session := testService(t)
	runID := launch(t, service, "magnolius_declick")
	appendEvents(t, session, "ERROR|"+runID+"|Magnolius DeClick is not installed in REAPER.")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "error" || state["message"] != "Magnolius DeClick is not installed in REAPER." {
		t.Fatalf("state = %#v", state)
	}
}

func TestEventsForAnotherRunAreIgnored(t *testing.T) {
	service, session := testService(t)
	launch(t, service, "repair_pops_clicks")
	appendEvents(t, session, "CLEANUP_LAUNCHED|not-this-run|repair_pops_clicks|Repair pops/clicks...", "ERROR|not-this-run|nope")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "launching" {
		t.Fatalf("state = %#v", state)
	}
}

func TestALaunchedEventForAnotherToolIsIgnored(t *testing.T) {
	service, session := testService(t)
	runID := launch(t, service, "repair_pops_clicks")
	appendEvents(t, session, "CLEANUP_LAUNCHED|"+runID+"|magnolius_declick|Script: Magnolius_DeClick.lua")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "launching" {
		t.Fatalf("state = %#v", state)
	}
}

func TestChangedIsCalledOnLaunchAndOnTheResult(t *testing.T) {
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	var phases []string
	service := New(Config{SessionDir: session}, client, func(state map[string]any) { phases = append(phases, state["phase"].(string)) })
	runID := launch(t, service, "repair_pops_clicks")
	appendEvents(t, session, "CLEANUP_LAUNCHED|"+runID+"|repair_pops_clicks|Repair pops/clicks...")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(phases, ",") != "launching,launched" {
		t.Fatalf("phases = %v", phases)
	}
}

func TestARunlessErrorFailsTheLaunchInFlightOnly(t *testing.T) {
	service, session := testService(t)
	appendEvents(t, session, "ERROR||Unsupported hub protocol")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "idle" {
		t.Fatalf("an idle service took a session-level error: %#v", state)
	}
	launch(t, service, "repair_pops_clicks")
	appendEvents(t, session, "ERROR||")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "error" || state["message"] != "REAPER integration failed." {
		t.Fatalf("state = %#v", state)
	}
}

func TestDrainWithoutABridgeIsANoOp(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
}

func TestAnUnreadableEventFailsTheLaunchInFlight(t *testing.T) {
	service, session := testService(t)
	runID := launch(t, service, "repair_pops_clicks")
	appendEvents(t, session, "CLEANUP_LAUNCHED|"+runID)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if message, _ := state["message"].(string); state["phase"] != "error" || !strings.Contains(message, "could not read") {
		t.Fatalf("state = %#v", state)
	}
}
