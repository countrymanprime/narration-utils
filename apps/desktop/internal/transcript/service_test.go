package transcript

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

func testService(t *testing.T) (*Service, string) {
	t.Helper()
	project, session := t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, "narration-utils", "manuscript"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"), []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	return New(Config{Project: project, SessionDir: session}, client, settings.New(t.TempDir(), project), nil, nil), session
}

func TestStartWritesHintsAndUsesExactBridgeContract(t *testing.T) {
	service, session := testService(t)
	if err := service.Start(map[string]string{"hints": " Alice, Hatter "}); err != nil {
		t.Fatal(err)
	}
	state := service.Snapshot()
	if state["phase"] != "preparing" || state["runId"] == nil {
		t.Fatalf("unexpected start state: %#v", state)
	}
	commands, err := os.ReadDir(filepath.Join(session, "commands"))
	if err != nil || len(commands) != 1 {
		t.Fatalf("commands = %#v, %v", commands, err)
	}
	command, err := os.ReadFile(filepath.Join(session, "commands", commands[0].Name()))
	if err != nil || !strings.HasPrefix(string(command), "1|prepare_compare|") {
		t.Fatalf("command = %q, %v", command, err)
	}
	hints, err := os.ReadFile(filepath.Join(service.config.Project, "TranscriptCompare", "vocabulary_hints.txt"))
	if err != nil || string(hints) != "Alice, Hatter" {
		t.Fatalf("hints = %q, %v", hints, err)
	}
}

func TestEventsPreserveMarkerFieldsAndPersistCompletion(t *testing.T) {
	service, _ := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "inspecting"
	service.Handle([]string{"COMPARE_MARKER", "run-1", "row-1", "MISREAD", "Alice", "alice", "Alyss", "3.5", "2", "Chapter 1", "4", "script context", "audio context", "pending", "", "1.25"})
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "1 discrepancy found.", "1", "0"})
	state := service.Snapshot()
	rows := state["rows"].([]any)
	if state["phase"] != "success" || len(rows) != 1 || rows[0].(map[string]any)["projectTime"] != 3.5 {
		t.Fatalf("unexpected completion state: %#v", state)
	}
	if service.LastCompleted() == nil {
		t.Fatal("completion was not persisted")
	}
}

func TestExportRejectsNoPendingMarkersThenUsesBridge(t *testing.T) {
	service, session := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"], service.state["output"] = "run-2", "success", filepath.Join(session, "results.txt")
	service.state["rows"] = []map[string]any{{"id": "row-1", "markerState": "pending"}}
	if err := service.Export(); err != nil {
		t.Fatal(err)
	}
	commands, err := os.ReadDir(filepath.Join(session, "commands"))
	if err != nil || len(commands) != 1 {
		t.Fatalf("commands = %#v, %v", commands, err)
	}
	command, _ := os.ReadFile(filepath.Join(session, "commands", commands[0].Name()))
	if !strings.HasPrefix(string(command), "1|export_compare_markers|run-2|") {
		t.Fatalf("command = %q", command)
	}
}

func TestEquivalenceRejectsMultiwordAndHintsAreCanonicalized(t *testing.T) {
	service, _ := testService(t)
	service.state["rows"] = []map[string]any{{"id": "bad", "kind": "MISREAD", "docText": "two words", "audioText": "one"}, {"id": "good", "kind": "MISREAD", "docText": "Alice", "audioText": "Alyss"}}
	if _, err := service.AddEquivalence("bad"); err == nil {
		t.Fatal("multiword equivalence was accepted")
	}
	if message, err := service.AddEquivalence("good"); err != nil || message != "Added equivalence: Alice = Alyss" {
		t.Fatalf("equivalence = %q, %v", message, err)
	}
	if err := service.SaveHints([]string{" Alice ", "alice", "Hatter"}); err != nil {
		t.Fatal(err)
	}
	hints := service.Hints()
	if len(hints) != 2 || hints[0] != "Alice" || hints[1] != "Hatter" {
		t.Fatalf("hints = %#v", hints)
	}
}

// A missing file is an empty list, but a file that cannot be read or parsed is a load error the
// Proofing page can show; Hints() used to return an empty list for both.
func TestLoadHintsDistinguishesNoFileFromAnUnreadableOne(t *testing.T) {
	service, _ := testService(t)
	if hints, err := service.LoadHints(); err != nil || len(hints) != 0 {
		t.Fatalf("no file: hints = %#v, err = %v", hints, err)
	}
	path := filepath.Join(service.config.Project, "TranscriptCompare", "vocab_hints.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"not":"a list"`), 0o600); err != nil {
		t.Fatal(err)
	}
	hints, err := service.LoadHints()
	if err == nil || !strings.Contains(err.Error(), "vocabulary hints") {
		t.Fatalf("corrupt file: hints = %#v, err = %v, want a vocabulary hints error", hints, err)
	}
	if len(service.Hints()) != 0 {
		t.Fatal("Hints must stay best-effort: an unreadable file is an empty list")
	}
}

// The Proofing page tells the narrator that hints added now replace an unreadable saved list, so the
// replaced file is kept beside it instead of being destroyed.
func TestSaveHintsKeepsAnUnreadableFileAsCorruptBeforeReplacingIt(t *testing.T) {
	service, _ := testService(t)
	path := filepath.Join(service.config.Project, "TranscriptCompare", "vocab_hints.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`["Alice", `), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.SaveHints([]string{"Zeph"}); err != nil {
		t.Fatal(err)
	}
	if hints, err := service.LoadHints(); err != nil || len(hints) != 1 || hints[0] != "Zeph" {
		t.Fatalf("hints = %#v, err = %v", hints, err)
	}
	kept, err := os.ReadFile(path + ".corrupt")
	if err != nil || string(kept) != `["Alice", ` {
		t.Fatalf("the unreadable file was not kept: %q, %v", kept, err)
	}
}

func TestLoadHintsWithNoProjectIsEmptyNotACwdRead(t *testing.T) {
	service := New(Config{}, nil, nil, nil, nil)
	if hints, err := service.LoadHints(); err != nil || len(hints) != 0 {
		t.Fatalf("hints = %#v, err = %v", hints, err)
	}
}

// appendEvents writes raw event lines to the session's events.log, the way REAPER's Lua does.
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

func TestDrainSharesTheBridgeWithAnotherConsumerWithoutLosingOrStealingEvents(t *testing.T) {
	service, session := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "inspecting"
	var others []string
	service.bridge.Subscribe(bridge.Subscription{
		Tags:   []string{"LINES_*", "ERROR"},
		Owns:   func(runID string) bool { return runID == "lines-9" },
		Handle: func(event bridge.Event) { others = append(others, event.Tag+"|"+event.RunID) },
	})
	appendEvents(t, session,
		"LINES_STAMPED|lines-9|2|0|0|0",
		"COMPARE_MARKER|run-1|row-1|MISREAD|Alice|alice|Alyss|3.5|2|Chapter%201|4|script|audio|pending||1.25",
		"ERROR|lines-9|The%20manuscript%20line%20list%20was%20not%20found.",
		"COMPARE_INSPECTED|run-1|1%20discrepancy%20found.|1|0",
	)

	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}

	state := service.Snapshot()
	if state["phase"] != "success" || len(state["rows"].([]any)) != 1 {
		t.Fatalf("the transcript service must still get its own events, got %#v", state)
	}
	if want := []string{"LINES_STAMPED|lines-9", "ERROR|lines-9"}; !reflect.DeepEqual(others, want) {
		t.Fatalf("the other consumer got %v, want %v", others, want)
	}
}

func TestABridgeErrorForTheRunReachesTheState(t *testing.T) {
	service, session := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "preparing"
	appendEvents(t, session, "ERROR|run-1|Save%20the%20REAPER%20project%20before%20starting%20Transcript%20Compare.")

	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}

	state := service.Snapshot()
	if state["phase"] != "error" || state["message"] != "Save the REAPER project before starting Transcript Compare." {
		t.Fatalf("state = %#v", state)
	}
}

func TestABridgeErrorDuringAnExportReachesTheExportNotThePhase(t *testing.T) {
	service, session := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "success"
	service.state["markerExport"] = map[string]any{"phase": "exporting", "message": "", "added": 0, "skipped": 0}
	appendEvents(t, session, "ERROR|run-1|Transcript%20results%20were%20not%20found.")

	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}

	state := service.Snapshot()
	export, _ := state["markerExport"].(map[string]any)
	if state["phase"] != "success" || export["phase"] != "error" || export["message"] != "Transcript results were not found." {
		t.Fatalf("state = %#v", state)
	}
}

func TestAnErrorForAnotherRunIsNotShownAsThisRunsError(t *testing.T) {
	service, session := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-2", "inspecting"
	appendEvents(t, session, "ERROR|run-1|Transcript%20Compare%20context%20expired%3B%20prepare%20a%20new%20comparison.")

	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}

	if state := service.Snapshot(); state["phase"] != "inspecting" {
		t.Fatalf("a stale run's error changed the current run: %#v", state)
	}
}

func TestAnUnattributedBridgeErrorFailsARunInProgressAndIsIgnoredWhenIdle(t *testing.T) {
	service, session := testService(t)
	service.state = empty()
	appendEvents(t, session, "ERROR||Unsupported%20hub%20protocol")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "idle" {
		t.Fatalf("an idle service must ignore a session-level error, got %#v", state)
	}

	service.state["runId"], service.state["phase"] = "run-1", "preparing"
	appendEvents(t, session, "ERROR||Unsupported%20hub%20protocol")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	if state := service.Snapshot(); state["phase"] != "error" || state["message"] != "Unsupported hub protocol" {
		t.Fatalf("state = %#v", state)
	}
}

func TestDrainWithoutABridgeIsANoOp(t *testing.T) {
	service := New(Config{Project: t.TempDir()}, nil, settings.New(t.TempDir(), t.TempDir()), nil, nil)
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
}

// The comparison's baseline for the "changed since comparison" label (follow-through PRD Phase 13): the change count
// REAPER appends to COMPARE_PREPARED is kept in the state, and an older script's six-field answer leaves it null.
func TestPreparedKeepsREAPERsChangeCountAsTheComparisonBaseline(t *testing.T) {
	for _, c := range []struct {
		name   string
		fields []string
		want   any
	}{
		{"a current script", []string{"COMPARE_PREPARED", "run-1", "m.txt", "manuscript.json", "Narrator", "d.diff", "2", "41"}, 41.0},
		{"an older script", []string{"COMPARE_PREPARED", "run-1", "m.txt", "manuscript.json", "Narrator", "d.diff", "2"}, nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			service, _ := testService(t)
			service.state = empty()
			service.state["runId"], service.state["phase"] = "run-1", "preparing"
			service.Handle(c.fields)
			if got := service.Snapshot()["projectChangeCount"]; got != c.want {
				t.Fatalf("projectChangeCount = %#v, want %#v", got, c.want)
			}
		})
	}
}
