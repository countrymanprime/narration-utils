package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/retakelanes"
)

// newTestHostForRetakeLanes opens a project folder holding the S7 spike project (fixed-lanes.rpp) as its only .rpp,
// with a retake-lane service on a real bridge client.
func newTestHostForRetakeLanes(t *testing.T) (*Host, string) {
	t.Helper()
	folder := t.TempDir()
	copyTestFile(t, filepath.Join("internal", "tracks", "testdata", "reaper", "fixed-lanes.rpp"), filepath.Join(folder, "Book.rpp"))
	host := newTestHostForTracks(t, folder)
	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	host.retakeLanes = retakelanes.New(retakelanes.Config{SessionDir: session}, client, nil)
	return host, session
}

func TestRetakeLanesListReadsTheSavedProject(t *testing.T) {
	host, _ := newTestHostForRetakeLanes(t)
	raw, err := host.RetakeLanesList()
	if err != nil {
		t.Fatal(err)
	}
	var list retakelanes.List
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Lines) == 0 || list.Lines[0].LineID != "line-000004" || len(list.Lines[0].Retakes) != 3 {
		t.Fatalf("list = %#v", list)
	}
}

func TestRetakeLanesPickSendsOnlyAListedRetake(t *testing.T) {
	host, session := newTestHostForRetakeLanes(t)
	raw, err := host.RetakeLanesList()
	if err != nil {
		t.Fatal(err)
	}
	var list retakelanes.List
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		t.Fatal(err)
	}
	guid := list.Lines[0].Retakes[0].ItemGUID
	if _, err := host.RetakeLanesPick("line-000005", guid); err == nil || !strings.Contains(err.Error(), "not on a fixed-lane track") {
		t.Fatalf("a GUID under the wrong line was accepted: %v", err)
	}
	started, err := host.RetakeLanesPick("line-000004", guid)
	if err != nil || started != `{"status":"started"}` {
		t.Fatalf("started = %q, err = %v", started, err)
	}
	state, err := host.RetakeLanesState()
	if err != nil || !strings.Contains(state, `"phase":"picking"`) {
		t.Fatalf("state = %s, err = %v", state, err)
	}
	entries, err := os.ReadDir(filepath.Join(session, "commands"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("bridge commands = %d, err = %v; want exactly one", len(entries), err)
	}
}

func TestRetakeLanesBindingsWithoutAProjectOrService(t *testing.T) {
	host := &Host{}
	if _, err := host.RetakeLanesList(); err == nil {
		t.Fatal("listing without a project must fail")
	}
	if _, err := host.RetakeLanesPick("line-000004", "{00000000-0000-0000-0000-000000000000}"); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("err = %v", err)
	}
	state, err := host.RetakeLanesState()
	if err != nil || !strings.Contains(state, `"phase":"idle"`) {
		t.Fatalf("state = %s, err = %v", state, err)
	}
	withService, _ := newTestHostForRetakeLanes(t)
	withService.config.projectFolder = ""
	if _, err := withService.RetakeLanesPick("line-000004", "{00000000-0000-0000-0000-000000000000}"); err == nil || !strings.Contains(err.Error(), "open a project") {
		t.Fatalf("err = %v", err)
	}
}
