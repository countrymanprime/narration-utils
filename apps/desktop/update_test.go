package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/update"
)

const updateTestRepository = "countrymanprime/narration-utils"

// fakeReleaseServer answers the release list the way GitHub does and counts the requests, so a test can say "no request was made".
type fakeReleaseServer struct {
	server   *httptest.Server
	requests atomic.Int32
}

func newFakeReleaseServer(t *testing.T, tags ...string) *fakeReleaseServer {
	t.Helper()
	type asset struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
	}
	type release struct {
		Tag         string  `json:"tag_name"`
		Prerelease  bool    `json:"prerelease"`
		PublishedAt string  `json:"published_at"`
		Assets      []asset `json:"assets"`
	}
	var releases []release
	for _, tag := range tags {
		releases = append(releases, release{Tag: tag, Prerelease: strings.HasSuffix(tag, "-rc"), PublishedAt: "2026-09-20T10:00:00Z", Assets: []asset{
			{Name: "narration-utils-windows-x64.zip", Size: 400 << 20}, {Name: "narration-utils-windows-x64.zip.sha256", Size: 100},
			{Name: "narration-utils-linux-x64.tar.gz", Size: 200 << 20}, {Name: "narration-utils-macos-arm64.zip", Size: 100 << 20},
		}})
	}
	body, err := json.Marshal(releases)
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeReleaseServer{}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fake.requests.Add(1)
		_, _ = w.Write(body)
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

// updateHost is a Host whose update checker talks to the fake server, as a Windows build of version current, with the narrator's
// settings in a temporary folder.
func updateHost(t *testing.T, fake *fakeReleaseServer, current string) *Host {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := NewHost()
	host.version = current
	installDir := t.TempDir()
	host.executable = func() (string, error) { return filepath.Join(installDir, "narration-utils.exe"), nil }
	host.pendingPath = filepath.Join(t.TempDir(), "pending.json")
	platform, _ := update.PlatformFor("windows", "amd64")
	host.updates = &update.Checker{
		Client: fake.server.Client(), APIBase: fake.server.URL, Repository: updateTestRepository, Platform: platform,
		CachePath: filepath.Join(t.TempDir(), "check.json"), Current: current, Now: func() time.Time { return time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC) },
	}
	return host
}

func saveUpdateSetting(t *testing.T, host *Host, key, value string) {
	t.Helper()
	if err := host.saveSettings("Updates", "global", map[string]*string{key: &value}); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateSettingsDefaultToACheckOnStartupOnTheCandidateChannel(t *testing.T) {
	host := updateHost(t, newFakeReleaseServer(t), "0.2.6")
	enabled, channel := host.updateSettings()
	if !enabled || channel != update.ChannelCandidates {
		t.Fatalf("defaults = %v, %q", enabled, channel)
	}
	saveUpdateSetting(t, host, "check_on_startup", "false")
	saveUpdateSetting(t, host, "channel", "stable")
	if enabled, channel = host.updateSettings(); enabled || channel != update.ChannelStable {
		t.Fatalf("after saving = %v, %q", enabled, channel)
	}
}

func TestUpdateSettingsAreGlobalOnlyAndValidated(t *testing.T) {
	host := updateHost(t, newFakeReleaseServer(t), "0.2.6")
	value := "false"
	if err := host.saveSettings("Updates", "project", map[string]*string{"check_on_startup": &value}); err == nil || !strings.Contains(err.Error(), "global") {
		t.Fatalf("a project-scope save must be refused: %v", err)
	}
	for key, bad := range map[string]string{"check_on_startup": "yes", "channel": "beta"} {
		if err := host.saveSettings("Updates", "global", map[string]*string{key: &bad}); err == nil {
			t.Errorf("%s=%q must be refused", key, bad)
		}
	}
}

func TestUpdateStatusIsAnAnswerFromTheCacheAndMakesNoRequest(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc")
	host := updateHost(t, fake, "0.2.6")
	text, err := host.UpdateStatus()
	if err != nil || fake.requests.Load() != 0 {
		t.Fatalf("err %v requests %d", err, fake.requests.Load())
	}
	var status update.Status
	if err := json.Unmarshal([]byte(text), &status); err != nil || status.Version != "0.2.6" || status.Available != nil || status.LastChecked != "" {
		t.Fatalf("status %+v err %v", status, err)
	}
}

func TestUpdateCheckAsksOnceAndReportsTheNewerRelease(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc", "v0.2.6-rc")
	host := updateHost(t, fake, "0.2.6")
	text, err := host.UpdateCheck()
	if err != nil || fake.requests.Load() != 1 {
		t.Fatalf("err %v requests %d", err, fake.requests.Load())
	}
	var status update.Status
	if err := json.Unmarshal([]byte(text), &status); err != nil {
		t.Fatal(err)
	}
	if status.Available == nil || status.Available.Tag != "v0.2.7-rc" || status.Failure != "" || status.LastChecked == "" {
		t.Fatalf("status %+v", status)
	}
	// The answer is now the cached one: asking for the status does not ask GitHub again.
	if _, err := host.UpdateStatus(); err != nil || fake.requests.Load() != 1 {
		t.Fatalf("err %v requests %d", err, fake.requests.Load())
	}
}

func TestAFailedExplicitCheckIsAStatusTheNarratorCanReadNotAnException(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc")
	host := updateHost(t, fake, "0.2.6")
	fake.server.Close()
	text, err := host.UpdateCheck()
	if err != nil {
		t.Fatalf("a failed check is reported in the status: %v", err)
	}
	var status update.Status
	if err := json.Unmarshal([]byte(text), &status); err != nil || !strings.Contains(status.Failure, "reach GitHub") {
		t.Fatalf("status %+v err %v", status, err)
	}
}

func TestADevelopmentBuildIsToldItHasNothingToCompareWith(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc")
	host := updateHost(t, fake, "0.0.0-dev")
	text, _ := host.UpdateCheck()
	var status update.Status
	if err := json.Unmarshal([]byte(text), &status); err != nil || !status.Development || status.Available != nil {
		t.Fatalf("status %+v err %v", status, err)
	}
}

func TestTheStartupCheckRunsOnlyWhenSwitchedOnAndDue(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc")
	host := updateHost(t, fake, "0.2.6")
	var events []updateStatus
	host.updateEvents = func(status updateStatus) { events = append(events, status) }

	saveUpdateSetting(t, host, "check_on_startup", "false")
	host.autoCheckForUpdate(context.Background())
	if fake.requests.Load() != 0 || len(events) != 0 {
		t.Fatalf("switched off: %d requests, %d events", fake.requests.Load(), len(events))
	}

	saveUpdateSetting(t, host, "check_on_startup", "true")
	host.autoCheckForUpdate(context.Background())
	if fake.requests.Load() != 1 || len(events) != 1 || events[0].Available == nil || events[0].Available.Version != "0.2.7" {
		t.Fatalf("due: %d requests, events %+v", fake.requests.Load(), events)
	}

	host.autoCheckForUpdate(context.Background())
	if fake.requests.Load() != 1 || len(events) != 1 {
		t.Fatalf("a check within the day asks nothing and says nothing: %d requests, %d events", fake.requests.Load(), len(events))
	}
}

func TestTheStartupCheckSaysNothingWhenThereIsNothingNewOrItFails(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.6-rc")
	host := updateHost(t, fake, "0.2.6")
	var events []updateStatus
	host.updateEvents = func(status updateStatus) { events = append(events, status) }
	host.autoCheckForUpdate(context.Background())
	if fake.requests.Load() != 1 || len(events) != 0 {
		t.Fatalf("nothing newer: %d requests, %d events", fake.requests.Load(), len(events))
	}

	offline := newFakeReleaseServer(t, "v0.2.7-rc")
	failing := updateHost(t, offline, "0.2.6")
	failing.updateEvents = func(status updateStatus) { events = append(events, status) }
	offline.server.Close()
	failing.autoCheckForUpdate(context.Background())
	if len(events) != 0 {
		t.Fatalf("a failed automatic check is silent: %+v", events)
	}
}

func TestTheStartupCheckWaitsAndStopsWhenTheAppCloses(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc")
	host := updateHost(t, fake, "0.2.6")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		host.startupUpdateCheck(ctx, time.Hour)
		close(done)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the startup check did not stop when the app closed")
	}
	if fake.requests.Load() != 0 {
		t.Fatal("a check that was cancelled during its delay must not run")
	}
}

func TestOpenReleaseNotesOpensOnlyTheNotesOfTheReleaseFound(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc")
	host := updateHost(t, fake, "0.2.6")
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.UpdateOpenNotes(); err == nil || len(opened) != 0 {
		t.Fatalf("nothing found yet, nothing to open: %v %v", err, opened)
	}
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	if _, err := host.UpdateOpenNotes(); err != nil {
		t.Fatal(err)
	}
	if len(opened) != 1 || opened[0] != "https://github.com/"+updateTestRepository+"/releases/tag/v0.2.7-rc" {
		t.Fatalf("opened %v", opened)
	}
}

func TestAnErrorFromTheCheckerNeverBecomesABindingError(t *testing.T) {
	host := updateHost(t, newFakeReleaseServer(t), "0.2.6")
	host.updates.Platform = update.Platform{}
	text, err := host.UpdateCheck()
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(text, `"platform":""`) {
		t.Fatalf("status = %s", text)
	}
}

// The payloads the Update bindings send (ADR 0069): the UI's contract tests validate these files against its Zod schemas.
func TestContractUpdateStatus(t *testing.T) {
	fake := newFakeReleaseServer(t, "v0.2.7-rc", "v0.2.6-rc")
	host := updateHost(t, fake, "0.2.6")
	pin := func(name string) {
		text, err := host.UpdateStatus()
		if err != nil {
			t.Fatal(err)
		}
		var status any
		if err := json.Unmarshal([]byte(text), &status); err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, status)
	}
	pin("update-status-unchecked")
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	pin("update-status-available")
	fake.server.Close()
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	pin("update-status-check-failed")
	host.version, host.updates.Current = "0.0.0-dev", "0.0.0-dev"
	pin("update-status-development")
}
