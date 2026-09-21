package transcript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func TestACorruptLastComparisonIsLoggedAndTreatedAsNone(t *testing.T) {
	service, _ := testService(t)
	var logs []string
	service.SetPersist(&persist.Reporter{Log: func(kind, message string) { logs = append(logs, kind+" "+message) }})
	if err := os.WriteFile(filepath.Join(service.config.Project, ".narration-last-comparison.json"), []byte(`{"rows": [`), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := service.LastCompleted(); got != nil {
		t.Fatalf("LastCompleted = %v, want nil for a file that cannot be read", got)
	}
	if len(logs) != 1 || !strings.Contains(logs[0], ".narration-last-comparison.json") {
		t.Fatalf("logs = %v", logs)
	}
}

func TestARunEndsInAnErrorWhenREAPERSendsAnEventItsTableRejects(t *testing.T) {
	service, session := testService(t)
	if err := service.Start(map[string]string{}); err != nil {
		t.Fatal(err)
	}
	runID, _ := service.Snapshot()["runId"].(string)
	service.mu.Lock()
	service.state["phase"] = "inspecting"
	service.mu.Unlock()

	// A marker cut after the audio text: the old code would have added a row of zeros.
	line := "COMPARE_MARKER|" + runID + "|row-1|MISREAD|Alice|alice|Alyss\n"
	if err := os.WriteFile(filepath.Join(session, "events.log"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}

	state := service.Snapshot()
	message, _ := state["message"].(string)
	if state["phase"] != "error" || !strings.Contains(message, "COMPARE_MARKER") || !strings.Contains(message, "Import the script") {
		t.Fatalf("phase %v, message %q", state["phase"], message)
	}
	if rows, _ := state["rows"].([]any); len(rows) != 0 {
		t.Fatalf("rows = %v: a truncated marker must not add a zero-filled row", rows)
	}
	if strings.Contains(message, "Alyss") {
		t.Fatal("the message must not carry the row's text")
	}
}

func TestAnInvalidEventOutsideARunIsIgnoredByTheRunState(t *testing.T) {
	service, _ := testService(t)
	service.handleInvalid(bridge.Event{Tag: "COMPARE_MARKER", RunID: "x"}, errFake("bad"))
	if service.Snapshot()["phase"] != "idle" {
		t.Fatal("an idle service has no run to end")
	}
}

type errFake string

func (e errFake) Error() string { return string(e) }
