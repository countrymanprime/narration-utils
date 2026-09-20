package transcript

import (
	"os"
	"path/filepath"
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
