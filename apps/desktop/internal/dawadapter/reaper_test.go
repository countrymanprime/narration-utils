package dawadapter

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// newReaper returns a REAPER adapter over a fresh session directory, and that directory.
func newReaper(t *testing.T) (*Reaper, string) {
	t.Helper()
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	return NewReaper(client), session
}

// onlyCommand reads the single command file the adapter wrote: the adapter must write exactly one per call.
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

// The REAPER adapter is a behaviour-preserving extraction: every review operation must put the exact line on the bridge that
// transcript.Service used to send by hand (the Lua harness in integrations/reaper/tests pins what REAPER does with it).
func TestReaperAdapterSendsTheExactBridgeCommandForEachReviewOperation(t *testing.T) {
	cases := []struct {
		name string
		call func(*Reaper) error
		want string
	}{
		{"prepare", func(r *Reaper) error { return r.PrepareReview("run-1") }, "1|prepare_compare|run-1\n"},
		{"inspect", func(r *Reaper) error { return r.InspectFindings("run-1", `C:\p\out.tsv`) }, "1|inspect_compare_results|run-1|C%3A%5Cp%5Cout.tsv\n"},
		{"navigate", func(r *Reaper) error { return r.NavigateToFinding("run-1", "row 7") }, "1|jump_to_compare_marker|run-1|row%207\n"},
		{"export", func(r *Reaper) error {
			return r.ExportFindings("run-1", "/p/out.tsv", MarkerColors{Misread: "FF4040", Skipped: "FFC000", Extra: "40A0FF"})
		}, "1|export_compare_markers|run-1|%2Fp%2Fout.tsv|FF4040|FFC000|40A0FF\n"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			adapter, session := newReaper(t)
			if err := testCase.call(adapter); err != nil {
				t.Fatal(err)
			}
			if got := onlyCommand(t, session); got != testCase.want {
				t.Fatalf("command = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestReaperAdapterReportsACommandThatCannotBeWritten(t *testing.T) {
	adapter, session := newReaper(t)
	if err := os.RemoveAll(filepath.Join(session, "commands")); err != nil {
		t.Fatal(err)
	}
	if err := adapter.NavigateToFinding("run-1", "row-1"); err == nil {
		t.Fatal("a command the bridge could not write must be an error, not a silent success")
	}
}

// Events reach a subscriber through the adapter exactly as they do through the bridge client, and the adapter shares that client's
// cursor, so a consumer still holding the raw client (pickups, line identity) neither loses nor steals the adapter's events.
func TestReaperAdapterSharesTheBridgeFanOut(t *testing.T) {
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	adapter := NewReaper(client)
	var viaAdapter, viaClient []string
	adapter.Subscribe(Subscription{Tags: []string{"COMPARE_*"}, Handle: func(event Event) { viaAdapter = append(viaAdapter, event.Tag) }})
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

// A nil bridge client (a standalone launch, no REAPER session) must give a nil Review, not a non-nil interface holding a nil
// pointer: every caller tests the adapter against nil before using it.
func TestReviewForNoBridgeIsNoAdapter(t *testing.T) {
	if adapter := ReviewFor(nil); adapter != nil {
		t.Fatalf("no bridge client must give a nil Review, got %#v", adapter)
	}
	client, err := bridge.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if adapter := ReviewFor(client); adapter == nil {
		t.Fatal("a bridge client must give the REAPER adapter")
	}
}
