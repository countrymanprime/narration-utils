package reaper

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// onlyCommand reads the single command file the review session wrote: it must write exactly one per call.
func onlyCommand(t *testing.T, session string) string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(session, "commands"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("want exactly one command file, got %d (%v)", len(entries), err)
	}
	bytes, err := os.ReadFile(filepath.Join(session, "commands", entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}

// The review session is a behaviour-preserving extraction (ADR 0143's dawadapter.Reaper before DAW port PRD P8 retired that
// package): every review operation must put the exact line on the bridge that transcript.Service used to send by hand (the Lua
// harness in integrations/reaper/tests pins what REAPER does with it).
func TestReviewSendsTheExactBridgeCommandForEachOperation(t *testing.T) {
	cases := []struct {
		name string
		call func(dawport.ReviewSession) error
		want string
	}{
		{"prepare", func(r dawport.ReviewSession) error { return r.PrepareReview("run-1", "") }, "1|prepare_compare|run-1\n"},
		{"prepare in the app's folder", func(r dawport.ReviewSession) error { return r.PrepareReview("run-1", "C:/Books/Alice") }, "1|prepare_compare|run-1|C%3A%2FBooks%2FAlice\n"},
		{"inspect", func(r dawport.ReviewSession) error { return r.InspectFindings("run-1", `C:\p\out.tsv`) }, "1|inspect_compare_results|run-1|C%3A%5Cp%5Cout.tsv\n"},
		{"navigate", func(r dawport.ReviewSession) error { return r.NavigateToFinding("run-1", "row 7") }, "1|jump_to_compare_marker|run-1|row%207\n"},
		{"export", func(r dawport.ReviewSession) error {
			return r.ExportFindings("run-1", "/p/out.tsv", dawport.MarkerColors{Misread: "FF4040", Skipped: "FFC000", Extra: "40A0FF"})
		}, "1|export_compare_markers|run-1|%2Fp%2Fout.tsv|FF4040|FFC000|40A0FF\n"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			client, session := newClient(t)
			adapter := ReviewFor(client)
			if err := testCase.call(adapter); err != nil {
				t.Fatal(err)
			}
			if got := onlyCommand(t, session); got != testCase.want {
				t.Fatalf("command = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestReviewReportsACommandThatCannotBeWritten(t *testing.T) {
	client, session := newClient(t)
	adapter := ReviewFor(client)
	if err := os.RemoveAll(filepath.Join(session, "commands")); err != nil {
		t.Fatal(err)
	}
	if err := adapter.NavigateToFinding("run-1", "row-1"); err == nil {
		t.Fatal("a command the bridge could not write must be an error, not a silent success")
	}
}

// Events reach a subscriber through the review session exactly as they do through the bridge client, and the session shares
// that client's cursor, so a consumer still holding the raw client (pickups, line identity) neither loses nor steals the
// session's events.
func TestReviewSharesTheBridgeFanOut(t *testing.T) {
	client, session := newClient(t)
	adapter := ReviewFor(client)
	var viaAdapter, viaClient []string
	adapter.Subscribe(dawport.Subscription{Tags: []string{"COMPARE_*"}, Handle: func(event dawport.Event) { viaAdapter = append(viaAdapter, event.Tag) }})
	client.Subscribe(bridge.Subscription{Tags: []string{"PICKUPS_*"}, Handle: func(event bridge.Event) { viaClient = append(viaClient, event.Tag) }})
	if err := os.WriteFile(filepath.Join(session, "events.log"), []byte("COMPARE_EXPORTED|run-1|1|0\nPICKUPS_COUNTED|p|1|2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := adapter.Dispatch(); err != nil {
		t.Fatal(err)
	}
	if len(viaAdapter) != 1 || viaAdapter[0] != "COMPARE_EXPORTED" || len(viaClient) != 1 || viaClient[0] != "PICKUPS_COUNTED" {
		t.Fatalf("adapter got %v, client got %v", viaAdapter, viaClient)
	}
}

// A nil bridge client (a standalone launch, no REAPER session) must give a nil ReviewSession, not a non-nil interface holding a
// nil pointer: every caller tests the session against nil before using it.
func TestReviewForNoBridgeIsNoSession(t *testing.T) {
	if session := ReviewFor(nil); session != nil {
		t.Fatalf("no bridge client must give a nil ReviewSession, got %#v", session)
	}
	client, _ := newClient(t)
	if session := ReviewFor(client); session == nil {
		t.Fatal("a bridge client must give the REAPER review session")
	}
}
