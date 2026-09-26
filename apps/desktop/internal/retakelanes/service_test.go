package retakelanes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
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

// retakeB is the second retake of line-000004 on track B of the S7 fixture (lane 1, silent in the saved file).
func retakeB(t *testing.T, project tracks.Project) Retake {
	t.Helper()
	return Lines(project).Lines[0].Retakes[1]
}

func pick(t *testing.T, service *Service, project tracks.Project, guid string) string {
	t.Helper()
	if err := service.Pick(project, "line-000004", guid, nil); err != nil {
		t.Fatal(err)
	}
	return service.Snapshot()["runId"].(string)
}

func TestPickSendsTheExactBridgeCommand(t *testing.T) {
	service, session := testService(t)
	project := fixture(t, "fixed-lanes.rpp")
	retake := retakeB(t, project)
	runID := pick(t, service, project, retake.ItemGUID)
	state := service.Snapshot()
	if state["phase"] != "picking" || state["itemGuid"] != retake.ItemGUID || state["trackName"] != "B - retakes on lanes" || state["lane"] != nil {
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
	want := []string{"1", "pick_retake_lane", runID, "line-000004", retake.ItemGUID}
	if strings.Join(decoded, "|") != strings.Join(want, "|") {
		t.Fatalf("decoded = %#v, want %#v", decoded, want)
	}
}

func TestPickRefusesARetakeTheSavedProjectDoesNotListAndSendsNothing(t *testing.T) {
	project := fixture(t, "fixed-lanes.rpp")
	lines := Lines(project)
	cases := []struct{ line, guid, want string }{
		{"", retakeB(t, project).ItemGUID, "choose a retake"},
		{"line-000004", "", "choose a retake"},
		{"line-000004", "40209", "choose a retake"},
		{"line-000004", retakeB(t, project).ItemGUID + "|x", "choose a retake"},
		{"line-000004", "{00000000-0000-0000-0000-000000000000}", "not on a fixed-lane track"},
		// Right GUID, wrong line: the pair names the retake, not the GUID alone.
		{"line-000010", retakeB(t, project).ItemGUID, "not on a fixed-lane track"},
		// A2's items are on a lane track but share lane 0, so they are not listed and cannot be picked.
		{"line-000002", "{5BFE533C-6CC5-4CFB-B47C-4BEF702C4601}", "not on a fixed-lane track"},
	}
	if len(lines.Lines) == 0 {
		t.Fatal("fixture lists no lines")
	}
	for _, c := range cases {
		service, session := testService(t)
		err := service.Pick(project, c.line, c.guid, nil)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Fatalf("%q %q: err = %v, want %q", c.line, c.guid, err, c.want)
		}
		if commands := commandFiles(t, session); len(commands) != 0 {
			t.Fatalf("%q %q: a refused pick still sent %#v", c.line, c.guid, commands)
		}
		if service.Snapshot()["phase"] != "idle" {
			t.Fatalf("%q %q: a refused pick changed the state", c.line, c.guid)
		}
	}
}

func TestPickWithoutABridgeFails(t *testing.T) {
	project := fixture(t, "fixed-lanes.rpp")
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Pick(project, "line-000004", retakeB(t, project).ItemGUID, nil); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestPickedReportsTheLaneREAPERPlays(t *testing.T) {
	service, session := testService(t)
	project := fixture(t, "fixed-lanes.rpp")
	retake := retakeB(t, project)
	runID := pick(t, service, project, retake.ItemGUID)
	appendEvents(t, session, "RETAKE_LANE_PICKED|"+runID+"|line-000004|"+bridge.PercentEncode(strings.ToLower(retake.ItemGUID))+"|1")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "picked" || state["lane"] != float64(1) {
		t.Fatalf("state = %#v", state)
	}
	if message, _ := state["message"].(string); !strings.Contains(message, "Lane 2 is now the only lane playing on B - retakes on lanes") || !strings.Contains(message, "Undo in REAPER") {
		t.Fatalf("message = %q", message)
	}
}

func TestAPickedEventForAnotherRetakeOrAnUnreadableLaneIsIgnored(t *testing.T) {
	service, session := testService(t)
	project := fixture(t, "fixed-lanes.rpp")
	retake := retakeB(t, project)
	runID := pick(t, service, project, retake.ItemGUID)
	appendEvents(t, session,
		"RETAKE_LANE_PICKED|"+runID+"|line-000004|"+bridge.PercentEncode("{00000000-0000-0000-0000-000000000000}")+"|1",
		"RETAKE_LANE_PICKED|"+runID+"|line-000009|"+bridge.PercentEncode(retake.ItemGUID)+"|1",
		"RETAKE_LANE_PICKED|"+runID+"|line-000004|"+bridge.PercentEncode(retake.ItemGUID)+"|-1",
	)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "picking" {
		t.Fatalf("state = %#v", state)
	}
}

func TestAnErrorForThisRunIsReportedAndOtherRunsAreIgnored(t *testing.T) {
	service, session := testService(t)
	project := fixture(t, "fixed-lanes.rpp")
	runID := pick(t, service, project, retakeB(t, project).ItemGUID)
	appendEvents(t, session, "ERROR|not-this-run|nope", "RETAKE_LANE_PICKED|not-this-run|line-000004|x|1")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "picking" {
		t.Fatalf("another run changed the state: %#v", state)
	}
	appendEvents(t, session, "ERROR|"+runID+"|"+bridge.PercentEncode(`The track "B" is not in fixed item lane mode`))
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "error" || state["message"] != `The track "B" is not in fixed item lane mode` {
		t.Fatalf("state = %#v", state)
	}
}

func TestARunlessErrorFailsThePickInFlightOnly(t *testing.T) {
	service, session := testService(t)
	appendEvents(t, session, "ERROR||Unsupported hub protocol")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "idle" {
		t.Fatalf("an idle service took a session-level error: %#v", state)
	}
	project := fixture(t, "fixed-lanes.rpp")
	pick(t, service, project, retakeB(t, project).ItemGUID)
	appendEvents(t, session, "ERROR||")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "error" || state["message"] != "REAPER integration failed." {
		t.Fatalf("state = %#v", state)
	}
}

func TestChangedIsCalledOnPickAndOnTheResult(t *testing.T) {
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	var phases []string
	service := New(Config{SessionDir: session}, client, func(state map[string]any) { phases = append(phases, state["phase"].(string)) })
	project := fixture(t, "fixed-lanes.rpp")
	retake := retakeB(t, project)
	runID := pick(t, service, project, retake.ItemGUID)
	appendEvents(t, session, "RETAKE_LANE_PICKED|"+runID+"|line-000004|"+bridge.PercentEncode(retake.ItemGUID)+"|1")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(phases, ",") != "picking,picked" {
		t.Fatalf("phases = %v", phases)
	}
}

func TestAnUnreadableEventFailsThePickInFlight(t *testing.T) {
	service, session := testService(t)
	project := fixture(t, "fixed-lanes.rpp")
	runID := pick(t, service, project, retakeB(t, project).ItemGUID)
	appendEvents(t, session, "RETAKE_LANE_PICKED|"+runID+"|line-000004")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if message, _ := state["message"].(string); state["phase"] != "error" || !strings.Contains(message, "could not read") {
		t.Fatalf("state = %#v", state)
	}
}

func TestAnUnreadableEventWhileIdleIsIgnored(t *testing.T) {
	service, session := testService(t)
	appendEvents(t, session, "RETAKE_LANE_PICKED|someone|line-000004")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "idle" {
		t.Fatalf("state = %#v", state)
	}
}

func TestDrainWithoutABridgeIsANoOp(t *testing.T) {
	service := New(Config{SessionDir: t.TempDir()}, nil, nil)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	service.Handle(nil)
}
