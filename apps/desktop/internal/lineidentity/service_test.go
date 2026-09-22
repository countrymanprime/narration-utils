package lineidentity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
)

// writeManuscript writes a minimal, schema-valid manuscript.json a manuscript.Service can Load. sha is the
// recorded source checksum; pass "" to omit the source object entirely (an old or corrupt manuscript).
func writeManuscript(t *testing.T, project, sha string) {
	t.Helper()
	dir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	data := map[string]any{
		"schemaVersion": 1,
		"documentId":    "doc-1",
		"chapters":      []map[string]any{{"id": "c-0001", "title": "Chapter One"}},
		"paragraphs": []map[string]any{
			{"id": "p-000001", "chapterId": "c-0001", "text": "It was the best of times."},
			{"id": "p-000002", "chapterId": "c-0001", "text": "It was the worst of times."},
		},
	}
	if sha != "" {
		data["source"] = map[string]any{"fileName": "book.docx", "sha256": sha}
	}
	bytes, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manuscript.json"), bytes, 0o600); err != nil {
		t.Fatal(err)
	}
}

// testService builds a service over a fresh project and session. sha is the manuscript's recorded source
// checksum ("" omits the source object; "no-file" skips writing manuscript.json at all).
func testService(t *testing.T, sha string) (*Service, string) {
	t.Helper()
	project, session := t.TempDir(), t.TempDir()
	if sha != "no-file" {
		writeManuscript(t, project, sha)
	}
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	return New(Config{Project: project, SessionDir: session}, client, manuscript.New(project), nil), session
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

func TestStampWritesTheExactPayloadAndBridgeContract(t *testing.T) {
	service, session := testService(t, "sha-v1")
	rows := []Row{{ItemGUID: "{GUID-A}", LineID: "p-000001", Text: "It was the best of times."}}
	if err := service.Stamp(rows, false); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "stamping" || state["runId"] == nil {
		t.Fatalf("unexpected stamp state: %#v", state)
	}
	runID := state["runId"].(string)
	command := firstCommand(t, session)
	if !strings.HasPrefix(command, "1|stamp_item_lines|"+runID+"|") || !strings.HasSuffix(strings.TrimRight(command, "\n"), "|0") {
		t.Fatalf("command = %q", command)
	}
	payload, err := os.ReadFile(filepath.Join(session, "lines_stamp_"+runID+".txt"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "{GUID-A}|p-000001@sha-v1|It was the best of times.\n"; string(payload) != want {
		t.Fatalf("payload = %q, want %q", payload, want)
	}
}

func TestStampSendsTheOverwriteFlag(t *testing.T) {
	service, session := testService(t, "sha-v1")
	rows := []Row{{ItemGUID: "{GUID-A}", LineID: "p-000001", Text: "It was the best of times."}}
	if err := service.Stamp(rows, true); err != nil {
		t.Fatal(err)
	}
	if command := firstCommand(t, session); !strings.HasSuffix(strings.TrimRight(command, "\n"), "|1") {
		t.Fatalf("command = %q, want an overwrite flag of 1", command)
	}
}

func TestStampRejectsEmptyRows(t *testing.T) {
	service, _ := testService(t, "sha-v1")
	if err := service.Stamp(nil, false); err == nil || !strings.Contains(err.Error(), "select at least one item") {
		t.Fatalf("err = %v", err)
	}
}

func TestStampRejectsARowMissingAnItemOrLine(t *testing.T) {
	service, _ := testService(t, "sha-v1")
	if err := service.Stamp([]Row{{ItemGUID: "", LineID: "p-000001", Text: "x"}}, false); err == nil {
		t.Fatal("a row with no item GUID was accepted")
	}
}

func TestStampWithoutABridgeFails(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, "sha-v1")
	service := New(Config{Project: project, SessionDir: t.TempDir()}, nil, manuscript.New(project), nil)
	rows := []Row{{ItemGUID: "{GUID-A}", LineID: "p-000001", Text: "x"}}
	if err := service.Stamp(rows, false); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestStampWithNoRecordedSourceChecksumFails(t *testing.T) {
	service, _ := testService(t, "") // manuscript.json with no "source" object, like a very old import
	rows := []Row{{ItemGUID: "{GUID-A}", LineID: "p-000001", Text: "x"}}
	if err := service.Stamp(rows, false); err == nil || !strings.Contains(err.Error(), "source checksum") {
		t.Fatalf("err = %v", err)
	}
}

// appendEvents writes raw event lines to the session's events.log, the way REAPER's Lua does (mirrors
// transcript/service_test.go's helper of the same name).
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

func TestHandleStampedAggregatesStaleAndConflictGUIDsThenSucceeds(t *testing.T) {
	service, session := testService(t, "sha-v1")
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "stamping"
	appendEvents(t, session,
		"LINES_STALE|run-1|{GUID-MISSING}",
		"LINES_CONFLICT|run-1|{GUID-CONFLICT}",
		"LINES_STAMPED|run-1|2|1|1|1",
	)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	stamp := state["stamp"].(map[string]any)
	if state["phase"] != "success" {
		t.Fatalf("phase = %v, want success: %#v", state["phase"], state)
	}
	if stamp["applied"] != float64(2) || stamp["unchanged"] != float64(1) || stamp["missingCount"] != float64(1) || stamp["conflictsCount"] != float64(1) {
		t.Fatalf("stamp counts = %#v", stamp)
	}
	if !reflect.DeepEqual(stamp["missing"], []any{"{GUID-MISSING}"}) || !reflect.DeepEqual(stamp["conflicts"], []any{"{GUID-CONFLICT}"}) {
		t.Fatalf("stamp guids = %#v", stamp)
	}
}

func TestReadWritesTheExactBridgeContractThenParsesAndClassifiesEveryRow(t *testing.T) {
	service, session := testService(t, "sha-v1")
	if err := service.Read(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "reading" || state["runId"] == nil {
		t.Fatalf("unexpected read state: %#v", state)
	}
	runID := state["runId"].(string)
	command := firstCommand(t, session)
	if !strings.HasPrefix(command, "1|read_line_ids|"+runID+"|") {
		t.Fatalf("command = %q", command)
	}
	reportPath := filepath.Join(session, "lines_read_"+runID+".txt")
	report := strings.Join([]string{
		"{GUID-OK}|p-000001@sha-v1|1.000000|2.500000|It was the best of times.",
		"{GUID-DRIFT}|p-000002@sha-v1|4.000000|2.500000|It was the worst of times, once.", // stored text no longer matches
		"{GUID-REMOVED}|p-999999@sha-v1|7.000000|2.500000|A paragraph that got deleted.",
		"{GUID-STALE}|p-000001@old-sha|9.000000|2.500000|It was the best of times.", // manuscript re-imported since the stamp
		"{GUID-UNRECOGNIZED}|line-000004|11.000000|2.500000|An identity from an older stamp scheme.",
		"this line has too few fields",
		"",
	}, "\n")
	if err := os.WriteFile(reportPath, []byte(report), 0o600); err != nil {
		t.Fatal(err)
	}
	appendEvents(t, session, "LINES_READ|"+runID+"|"+bridge.PercentEncode(reportPath)+"|5")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state = service.Snapshot()
	if state["phase"] != "success" || state["linesRead"] != float64(5) {
		t.Fatalf("state = %#v", state)
	}
	lines, ok := state["lines"].([]any)
	if !ok || len(lines) != 5 {
		t.Fatalf("lines = %#v", state["lines"])
	}
	byGUID := map[string]map[string]any{}
	for _, raw := range lines {
		row := raw.(map[string]any)
		byGUID[row["itemGuid"].(string)] = row
	}
	cases := map[string]string{
		"{GUID-OK}": "ok", "{GUID-DRIFT}": "drift", "{GUID-REMOVED}": "removed",
		"{GUID-STALE}": "stale-source", "{GUID-UNRECOGNIZED}": "unrecognized",
	}
	for guid, want := range cases {
		row, found := byGUID[guid]
		if !found {
			t.Fatalf("row for %s was not parsed", guid)
		}
		if row["status"] != want {
			t.Fatalf("%s status = %v, want %v (%#v)", guid, row["status"], want, row)
		}
	}
	if drift := byGUID["{GUID-DRIFT}"]; drift["currentText"] != "It was the worst of times." {
		t.Fatalf("drift row currentText = %#v, want the manuscript's current text", drift["currentText"])
	}
}

func TestReadWithNoManuscriptReportsEveryComposedRowAsUnknown(t *testing.T) {
	service, session := testService(t, "no-file") // no manuscript.json at all
	if err := service.Read(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	reportPath := filepath.Join(session, "lines_read_"+runID+".txt")
	if err := os.WriteFile(reportPath, []byte("{GUID-A}|p-000001@sha-v1|1.000000|2.500000|Some text\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	appendEvents(t, session, "LINES_READ|"+runID+"|"+bridge.PercentEncode(reportPath)+"|1")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	lines := service.Snapshot()["lines"].([]any)
	if len(lines) != 1 || lines[0].(map[string]any)["status"] != "unknown" {
		t.Fatalf("lines = %#v", lines)
	}
}

func TestReadWithoutABridgeFails(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, "sha-v1")
	service := New(Config{Project: project, SessionDir: t.TempDir()}, nil, manuscript.New(project), nil)
	if err := service.Read(); err == nil || !strings.Contains(err.Error(), "REAPER bridge is unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestDrainSharesTheBridgeWithAnotherConsumerWithoutLosingOrStealingEvents(t *testing.T) {
	service, session := testService(t, "sha-v1")
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "stamping"
	var others []string
	service.bridge.Subscribe(bridge.Subscription{
		Tags:   []string{"COMPARE_*"},
		Owns:   func(runID string) bool { return runID == "compare-1" },
		Handle: func(event bridge.Event) { others = append(others, event.Tag+"|"+event.RunID) },
	})
	appendEvents(t, session,
		"LINES_STAMPED|run-1|1|0|0|0",
		"COMPARE_INSPECTED|compare-1|1%20discrepancy%20found.|1|0",
	)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "success" {
		t.Fatalf("this service must still get its own events: %#v", state)
	}
	if want := []string{"COMPARE_INSPECTED|compare-1"}; !reflect.DeepEqual(others, want) {
		t.Fatalf("the other consumer got %v, want %v", others, want)
	}
}

func TestAnErrorForTheRunInProgressReachesTheState(t *testing.T) {
	service, session := testService(t, "sha-v1")
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "stamping"
	appendEvents(t, session, "ERROR|run-1|The%20manuscript%20line%20list%20was%20not%20found.")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "error" || state["message"] != "The manuscript line list was not found." {
		t.Fatalf("state = %#v", state)
	}
}

func TestAnErrorForAnotherRunIsNotShownAsThisRunsError(t *testing.T) {
	service, session := testService(t, "sha-v1")
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-2", "reading"
	appendEvents(t, session, "ERROR|run-1|Some%20other%20runs%20problem.")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "reading" {
		t.Fatalf("a stale run's error changed the current run: %#v", state)
	}
}

func TestAnUnattributedErrorFailsARunInProgressAndIsIgnoredWhenIdle(t *testing.T) {
	service, session := testService(t, "sha-v1")
	appendEvents(t, session, "ERROR||Unsupported%20hub%20protocol")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "idle" {
		t.Fatalf("an idle service must ignore a session-level error, got %#v", state)
	}
	service.state["runId"], service.state["phase"] = "run-1", "stamping"
	appendEvents(t, session, "ERROR||Unsupported%20hub%20protocol")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "error" || state["message"] != "Unsupported hub protocol" {
		t.Fatalf("state = %#v", state)
	}
}

func TestDrainWithoutABridgeIsANoOp(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, "sha-v1")
	service := New(Config{Project: project}, nil, manuscript.New(project), nil)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
}

func TestComposeAndParseLineIDRoundTrip(t *testing.T) {
	id := ComposeLineID("p-000042", "abc123")
	entity, hash, ok := ParseLineID(id)
	if !ok || entity != "p-000042" || hash != "abc123" {
		t.Fatalf("round trip = %q, %q, %v", entity, hash, ok)
	}
}

func TestParseLineIDRejectsAnUncomposedOrEmptyValue(t *testing.T) {
	for _, value := range []string{"", "no-separator", "@abc123", "p-000042@"} {
		if _, _, ok := ParseLineID(value); ok {
			t.Fatalf("%q was accepted as a composed line ID", value)
		}
	}
}
