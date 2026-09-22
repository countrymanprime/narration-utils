package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

const fakeTeleprompterEnv = "SHELL_FAKE_TELEPROMPTER"

// TestMain lets this test binary stand in for the teleprompter sidecar. It runs
// before Go parses flags, so it can accept the host's --engine/--chapter/...
// arguments. Like the real sidecar it exits once its --stop-file appears.
func TestMain(m *testing.M) {
	if os.Getenv(fakeGuideRenderEnv) != "" {
		os.Exit(runFakeGuideRender())
	}
	if path := os.Getenv(fakeGuideCountEnv); path != "" {
		os.Exit(runFakeGuideCount(path))
	}
	if os.Getenv(fakeTeleprompterEnv) != "" {
		runFakeTeleprompter()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// runFakeTeleprompterDevices stands in for the sidecar's `--list-devices` mode: one JSON line, then exit. Checked
// first (before the streaming behavior below) so a TeleprompterDevices test never waits on a --stop-file that
// `--list-devices` never receives.
func runFakeTeleprompterDevices() bool {
	if len(os.Args) < 2 || os.Args[1] != "--list-devices" {
		return false
	}
	fmt.Println(`{"type":"devices","devices":[{"name":"Microphone Array (Realtek(R) Audio)"}],"error":null}`)
	return true
}

func runFakeTeleprompter() {
	if runFakeTeleprompterDevices() {
		return
	}
	fmt.Println(`{"type":"script","chapter":{"id":"c1","title":"One"},"tokens":4,"spans":[]}`)
	stopFile := ""
	for index, arg := range os.Args {
		if arg == "--stop-file" && index+1 < len(os.Args) {
			stopFile = os.Args[index+1]
		}
	}
	for {
		if _, err := os.Stat(stopFile); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func newHostWithARunningTeleprompter(t *testing.T) *Host {
	t.Helper()
	t.Setenv(fakeTeleprompterEnv, "1")
	project := t.TempDir()
	manuscriptPath := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(manuscriptPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manuscriptPath, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	host := NewHost()
	host.teleprompter = teleprompter.New(teleprompter.Config{Project: project, SessionDir: t.TempDir(), Python: os.Args[0]}, host.sidecars, host.emitTeleprompterEvent, host.emitTeleprompterState)
	t.Cleanup(func() {
		_ = host.teleprompter.Close(context.Background())
		_ = host.sidecars.Close()
	})
	if err := host.teleprompter.Start(map[string]string{"chapter": "c1", "device": "Mic", "model": "tiny"}); err != nil {
		t.Fatal(err)
	}
	return host
}

func TestCanAttachRejectsAnActiveTeleprompterSession(t *testing.T) {
	host := newHostWithARunningTeleprompter(t)

	if host.canAttachLocked() {
		t.Fatal("a running teleprompter session must prevent a project switch")
	}

	host.teleprompter.Stop()
	deadline := time.Now().Add(10 * time.Second)
	for host.teleprompter.Busy() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !host.canAttachLocked() {
		t.Fatal("a stopped teleprompter session must not block attaching")
	}
}

func TestShutdownStopsARunningTeleprompterWithoutDeadlocking(t *testing.T) {
	host := newHostWithARunningTeleprompter(t)

	done := make(chan struct{})
	go func() {
		host.Shutdown(context.Background())
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("Shutdown did not return; the service's state callback needs the host lock while Shutdown waits for it")
	}
	if host.teleprompter.Busy() {
		t.Fatal("Shutdown returned while the teleprompter session was still Busy: Service.Close must wait until the watcher has recorded the final stopped state, not only until the child process has exited")
	}
}

func hostForTeleprompterStart(t *testing.T) (*Host, func()) {
	t.Helper()
	body := []byte("model-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	host := newTestHostForTranscriptStart(t, body, server)
	host.teleprompter = teleprompter.New(teleprompter.Config{}, process.NewSupervisor(), nil, nil)
	return host, server.Close
}

func startResult(t *testing.T, host *Host, options map[string]string) map[string]any {
	t.Helper()
	raw, err := host.TeleprompterStart(options)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestTeleprompterStartRequestsTheApprovedModelWhenNotInstalled(t *testing.T) {
	host, closeServer := hostForTeleprompterStart(t)
	defer closeServer()

	result := startResult(t, host, map[string]string{"model": "tiny"})

	model, _ := result["model"].(map[string]any)
	if result["status"] != "asset_required" || model["id"] != "tiny" {
		t.Fatalf("result = %v", result)
	}
}

func TestTeleprompterStartDefaultsToTheTinyModelSoLiveTranscriptionKeepsUp(t *testing.T) {
	host, closeServer := hostForTeleprompterStart(t)
	defer closeServer()

	result := startResult(t, host, map[string]string{})

	model, _ := result["model"].(map[string]any)
	if result["status"] != "asset_required" || model["id"] != "tiny" {
		t.Fatalf("the default live model should be tiny, got %v", result)
	}
}

func TestTeleprompterStartRejectsAModelOutsideTheApprovedCatalog(t *testing.T) {
	host, closeServer := hostForTeleprompterStart(t)
	defer closeServer()

	if _, err := host.TeleprompterStart(map[string]string{"model": "not-a-real-model"}); err == nil {
		t.Fatal("expected an error for a model outside the approved catalog")
	}
}

// Once the model is installed the gate is passed and the service's own
// validation runs; its bare Config makes "REAPER project" the deterministic
// signal that the gate was cleared rather than tripped.
func TestTeleprompterStartProceedsOnceTheModelIsInstalled(t *testing.T) {
	host, closeServer := hostForTeleprompterStart(t)
	defer closeServer()
	if err := host.registry().whisper.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}

	_, err := host.TeleprompterStart(map[string]string{"model": "tiny"})

	if err == nil || !strings.Contains(err.Error(), "REAPER project") {
		t.Fatalf("expected the post-gate service error, got %v", err)
	}
}

func TestTeleprompterStartReportsAnUnavailableService(t *testing.T) {
	host := &Host{}

	if _, err := host.TeleprompterStart(map[string]string{}); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestTeleprompterDevicesReturnsTheSidecarsListThroughTheHostBinding(t *testing.T) {
	t.Setenv(fakeTeleprompterEnv, "1")
	host := &Host{teleprompter: teleprompter.New(teleprompter.Config{Project: t.TempDir(), SessionDir: t.TempDir(), Python: os.Args[0]}, process.NewSupervisor(), nil, nil)}

	raw, err := host.TeleprompterDevices()
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Devices []map[string]string `json:"devices"`
		Error   *string             `json:"error"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Error != nil {
		t.Fatalf("error = %v, want nil", *result.Error)
	}
	if len(result.Devices) != 1 || result.Devices[0]["name"] != "Microphone Array (Realtek(R) Audio)" {
		t.Fatalf("devices = %v", result.Devices)
	}
}

// The `TeleprompterDevices` payload the UI receives (ADR 0069), pinned for the TS contract test
// (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2).
func TestContractTeleprompterDevices(t *testing.T) {
	t.Setenv(fakeTeleprompterEnv, "1")
	host := &Host{teleprompter: teleprompter.New(teleprompter.Config{Project: t.TempDir(), SessionDir: t.TempDir(), Python: os.Args[0]}, process.NewSupervisor(), nil, nil)}

	raw, err := host.TeleprompterDevices()
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "teleprompter-devices", decoded)
}

func TestTeleprompterDevicesReportsAnUnavailableServiceLikeTeleprompterStart(t *testing.T) {
	host := &Host{}

	if _, err := host.TeleprompterDevices(); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestTeleprompterStateReportsIdleBeforeAnySession(t *testing.T) {
	host := &Host{teleprompter: teleprompter.New(teleprompter.Config{}, nil, nil, nil)}

	raw, err := host.TeleprompterState()
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		t.Fatal(err)
	}
	if state["phase"] != "idle" {
		t.Fatalf("state = %v", state)
	}
}

func TestTeleprompterStopWithoutASessionIsHarmless(t *testing.T) {
	host := &Host{teleprompter: teleprompter.New(teleprompter.Config{}, nil, nil, nil)}

	if _, err := host.TeleprompterStop(); err != nil {
		t.Fatal(err)
	}
	if _, err := (&Host{}).TeleprompterStop(); err != nil {
		t.Fatal(err)
	}
}

func TestTeleprompterSeekReachesTheRunningServiceThroughTheHostBinding(t *testing.T) {
	host := newHostWithARunningTeleprompter(t)

	if _, err := host.TeleprompterSeek(12); err != nil {
		t.Fatal(err)
	}
}

func TestTeleprompterSeekReportsAnUnavailableService(t *testing.T) {
	host := &Host{}

	if _, err := host.TeleprompterSeek(12); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestTeleprompterSeekWithoutARunningSessionReportsTheServicesError(t *testing.T) {
	host := &Host{teleprompter: teleprompter.New(teleprompter.Config{}, nil, nil, nil)}

	if _, err := host.TeleprompterSeek(12); err == nil || !strings.Contains(err.Error(), "no teleprompter session") {
		t.Fatalf("err = %v", err)
	}
}

func TestTheDeveloperSidecarPathsIncludeTheTeleprompter(t *testing.T) {
	root := t.TempDir()
	python := filepath.Join(root, ".venv", "Scripts", "python.exe")
	if os.PathSeparator != '\\' {
		python = filepath.Join(root, ".venv", "bin", "python")
	}
	if err := os.MkdirAll(filepath.Dir(python), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(python, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	host := &Host{config: config{repoRoot: root}}

	host.resolveDeveloperSidecars()

	want := layout.Path(root, layout.TeleprompterBackend)
	if host.config.teleprompterPython != python || host.config.teleprompterBackend != want {
		t.Fatalf("teleprompter sidecar = %q %q", host.config.teleprompterPython, host.config.teleprompterBackend)
	}
}

func TestParseConfigArgsAcceptsTheTeleprompterSidecarFlags(t *testing.T) {
	config := parseConfigArgs(`C:\repo`, []string{"--teleprompter-python", `C:\py\python.exe`, "--teleprompter-backend", `C:\repo\live_asr.py`})

	if config.teleprompterPython != `C:\py\python.exe` || config.teleprompterBackend != `C:\repo\live_asr.py` {
		t.Fatalf("config = %#v", config)
	}
}

func TestAttachingAProjectBuildsTheTeleprompterService(t *testing.T) {
	host := NewHost()
	next := host.config
	next.projectFolder, next.projectName, next.daw = t.TempDir(), "My Book", "Standalone"

	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attachProjectLocked() = (%v, %q)", attached, reason)
	}

	if host.teleprompter == nil {
		t.Fatal("attaching a project should build the teleprompter service")
	}
}
