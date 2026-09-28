package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/recording"
	"github.com/countrymanprime/narration-utils/shell/internal/recording/recordingtest"
)

// recorderHost is a host with a project, acting as Windows (where the wasapi row runs), whose recorder records through a
// fake engine instead of the sidecar.
func recorderHost(t *testing.T, fake *recordingtest.Fake) *Host {
	t.Helper()
	host := previewSuggestHost(t, previewManuscriptOK)
	host.platform = "windows"
	host.mu.Lock()
	host.recorder = recording.New(recording.Config{Project: host.config.projectFolder, Grace: time.Second}, fake, nil, nil)
	host.mu.Unlock()
	return host
}

func recorderOf(t *testing.T) func(string, error) RecorderState {
	return func(raw string, err error) RecorderState { return decodeRecorder(t, raw, err) }
}

func decodeRecorder(t *testing.T, raw string, err error) RecorderState {
	t.Helper()
	if err != nil {
		t.Fatalf("binding error = %v", err)
	}
	var state RecorderState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		t.Fatalf("payload %q is not JSON: %v", raw, err)
	}
	return state
}

func waitRecorderIdle(t *testing.T, host *Host) RecorderState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state := recorderOf(t)(host.RecorderState())
		if state.Phase == recording.PhaseIdle {
			return state
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the recorder never went idle")
	return RecorderState{}
}

// stableRecorder fixes what a golden cannot hold: the project folder, file times and the start time.
func stableRecorder(t *testing.T, raw string, folder string) any {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["startedAt"] != nil {
		decoded["startedAt"] = 1790000000000
	}
	takes, _ := decoded["takes"].([]any)
	for index, take := range takes {
		take.(map[string]any)["recordedAt"] = 1790000000000 + index*60000
	}
	portable, err := contractfile.PortablePaths(decoded, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	return portable
}

// TestRecorderStateGoldensAreCurrent pins the "recording:state" payload apps/ui's schema and mock follow: no project; a
// project that records with the built-in recorder, with a finished take, an unfinished one and the last take's numbers;
// and a take recording. UPDATE_CONTRACTS=1 rewrites tests/fixtures/contracts/recorder-state-*.json.
func TestRecorderStateGoldensAreCurrent(t *testing.T) {
	t.Run("no project", func(t *testing.T) {
		host := NewHost()
		host.platform = "windows"
		contractfile.Check(t, "recorder-state-no-project", stableRecorder(t, mustRaw(t)(host.RecorderState()), "unused"))
	})

	fake := &recordingtest.Fake{}
	host := recorderHost(t, fake)
	folder := host.config.projectFolder
	recorderOf(t)(host.RecorderChooseEngine(engineBuiltin))
	if err := os.MkdirAll(filepath.Join(folder, recording.FolderName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(folder, recording.FolderName, "Take 001.partial.wav"), 24000); err != nil {
		t.Fatal(err)
	}
	recorderOf(t)(host.RecorderStart("Analogue 1 + 2 (Focusrite USB Audio)"))
	t.Run("recording", func(t *testing.T) {
		contractfile.Check(t, "recorder-state-recording", stableRecorder(t, mustRaw(t)(host.RecorderState()), folder))
	})
	recorderOf(t)(host.RecorderStop())
	waitRecorderIdle(t, host)
	t.Run("takes", func(t *testing.T) {
		contractfile.Check(t, "recorder-state-takes", stableRecorder(t, mustRaw(t)(host.RecorderState()), folder))
	})
}

func mustRaw(t *testing.T) func(string, error) string {
	return func(raw string, err error) string {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
}

func TestRecorderDevicesGoldenIsCurrent(t *testing.T) {
	host := recorderHost(t, &recordingtest.Fake{DeviceList: []recording.Device{{Name: "Microphone Array (Realtek(R) Audio)"}, {Name: "Analogue 1 + 2 (Focusrite USB Audio)"}}})
	var decoded map[string]any
	if err := json.Unmarshal([]byte(mustRaw(t)(host.RecorderDevices())), &decoded); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "recorder-devices", decoded)
}

func TestAProjectRecordsWithREAPERUntilItChoosesTheBuiltInRecorder(t *testing.T) {
	host := recorderHost(t, &recordingtest.Fake{})
	state := recorderOf(t)(host.RecorderState())
	if state.Engine != engineDAW || !state.HasProject || state.Support["level"] != "experimental" || state.Support["available"] != true {
		t.Fatalf("state = %+v", state)
	}
	if _, err := host.RecorderStart("Mic"); err == nil || !strings.Contains(err.Error(), "choose the built-in recorder") {
		t.Fatalf("a take started while the project records with REAPER: %v", err)
	}
	if state := recorderOf(t)(host.RecorderChooseEngine(engineBuiltin)); state.Engine != engineBuiltin {
		t.Fatalf("engine = %q", state.Engine)
	}
	if state := recorderOf(t)(host.RecorderChooseEngine(engineDAW)); state.Engine != engineDAW {
		t.Fatalf("engine = %q", state.Engine)
	}
	if _, err := host.RecorderChooseEngine("audacity"); err == nil {
		t.Fatal("an unknown engine was saved")
	}
}

func TestTheBuiltInRecorderIsRefusedWhereItsRowDoesNotRun(t *testing.T) {
	host := recorderHost(t, &recordingtest.Fake{})
	host.platform = "linux"
	if _, err := host.RecorderChooseEngine(engineBuiltin); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Fatalf("err = %v", err)
	}
	if state := recorderOf(t)(host.RecorderState()); state.Engine != engineDAW || state.Support["available"] != false {
		t.Fatalf("state = %+v", state)
	}
}

func TestChoosingAnEngineNeedsAProjectAndNoTakeRecording(t *testing.T) {
	if _, err := NewHost().RecorderChooseEngine(engineBuiltin); err == nil {
		t.Fatal("chose without a project")
	}
	host := recorderHost(t, &recordingtest.Fake{})
	recorderOf(t)(host.RecorderChooseEngine(engineBuiltin))
	recorderOf(t)(host.RecorderStart("Mic"))
	if _, err := host.RecorderChooseEngine(engineDAW); err == nil {
		t.Fatal("changed engine mid-take")
	}
	if host.idle() {
		t.Fatal("the host is idle while a take records")
	}
	recorderOf(t)(host.RecorderStop())
	waitRecorderIdle(t, host)
}

func TestATakeRemembersItsDeviceAndPlaysThroughTheMediaRoute(t *testing.T) {
	host := recorderHost(t, &recordingtest.Fake{})
	recorderOf(t)(host.RecorderChooseEngine(engineBuiltin))
	recorderOf(t)(host.RecorderStart("Studio Mic"))
	recorderOf(t)(host.RecorderStop())
	state := waitRecorderIdle(t, host)
	if len(state.Takes) != 1 || state.Device != "Studio Mic" {
		t.Fatalf("state = %+v", state)
	}

	// A fresh recorder (the project reopened) still shows the device the project last recorded with.
	host.mu.Lock()
	host.recorder = recording.New(recording.Config{Project: host.config.projectFolder}, &recordingtest.Fake{}, nil, nil)
	host.mu.Unlock()
	if got := recorderOf(t)(host.RecorderState()).Device; got != "Studio Mic" {
		t.Fatalf("remembered device = %q", got)
	}

	serve := func(path string) int {
		recorder := httptest.NewRecorder()
		host.mediaMiddleware(http.NotFoundHandler()).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+url.QueryEscape(path), nil))
		return recorder.Code
	}
	if code := serve(state.Takes[0].Path); code != http.StatusOK {
		t.Fatalf("the take is not served: %d", code)
	}
	if code := serve(filepath.Join(host.config.projectFolder, "manuscript.json")); code != http.StatusNotFound {
		t.Fatalf("a project file that is not a take is served: %d", code)
	}
}

// recordingManuscriptWithSource is previewManuscriptOK with a recorded source checksum stamped, the same shape
// internal/lineidentity's own tests use (`"source":{"fileName":...,"sha256":...}`), since RecorderSetTakeLine reads
// exactly that field.
const recordingManuscriptWithSource = `{"schemaVersion":1,"documentId":"doc-1","source":{"fileName":"book.docx","sha256":"abc123"},"chapters":[` +
	`{"id":"c-0001","title":"Chapter One","index":0,"contentKind":"narration"}` +
	`],"paragraphs":[` +
	`{"id":"p-000001","chapterId":"c-0001","index":0,"text":"Alice walked through the forest, alone with her thoughts."}` +
	`]}`

func recorderHostWithManuscript(t *testing.T, fake *recordingtest.Fake) *Host {
	t.Helper()
	host := previewSuggestHost(t, recordingManuscriptWithSource)
	host.platform = "windows"
	host.mu.Lock()
	host.recorder = recording.New(recording.Config{Project: host.config.projectFolder, Grace: time.Second}, fake, nil, nil)
	host.mu.Unlock()
	return host
}

// TestRecorderSetTakeLineAssignsThroughTheManuscriptsOwnChecksum pins Phase 4's binding: it takes only an entity id
// from the caller, reading the manuscript's own recorded source checksum itself so the UI can never stamp a stale
// or wrong one (native-recording-suite PRD Phase 3's SetTakeLine, first wired to the UI here).
func TestRecorderSetTakeLineAssignsThroughTheManuscriptsOwnChecksum(t *testing.T) {
	fake := &recordingtest.Fake{}
	host := recorderHostWithManuscript(t, fake)
	folder := filepath.Join(host.config.projectFolder, recording.FolderName)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(folder, "Take 001.wav"), 24000); err != nil {
		t.Fatal(err)
	}

	state := recorderOf(t)(host.RecorderSetTakeLine("Take 001", "p-000001"))
	take := state.Takes[0]
	if take.LineID == nil || *take.LineID != "p-000001@abc123" {
		t.Fatalf("LineID = %v, want p-000001@abc123", take.LineID)
	}

	// Clearing.
	state = recorderOf(t)(host.RecorderSetTakeLine("Take 001", ""))
	if state.Takes[0].LineID != nil {
		t.Fatalf("LineID = %v, want nil after clearing", state.Takes[0].LineID)
	}
}

func TestRecorderSetTakeLineRefusesWithNoManuscriptImported(t *testing.T) {
	host := recorderHost(t, &recordingtest.Fake{}) // previewManuscriptOK has no source checksum
	folder := filepath.Join(host.config.projectFolder, recording.FolderName)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(folder, "Take 001.wav"), 24000); err != nil {
		t.Fatal(err)
	}
	if _, err := host.RecorderSetTakeLine("Take 001", "p-000001"); err == nil || !strings.Contains(err.Error(), "import a manuscript") {
		t.Fatalf("err = %v", err)
	}
}

func TestRecorderSetTakeLineWithoutAProjectIsRefused(t *testing.T) {
	if _, err := NewHost().RecorderSetTakeLine("Take 001", "p-000001"); err == nil {
		t.Fatal("assigned a line without a project")
	}
}

// TestRecorderSetTakeKeeperMarksAndUndoes pins Phase 4's keeper binding end to end, through the host.
func TestRecorderSetTakeKeeperMarksAndUndoes(t *testing.T) {
	host := recorderHost(t, &recordingtest.Fake{})
	folder := filepath.Join(host.config.projectFolder, recording.FolderName)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(folder, "Take 001.wav"), 24000); err != nil {
		t.Fatal(err)
	}

	state := recorderOf(t)(host.RecorderSetTakeKeeper("Take 001", true))
	if !state.Takes[0].Keeper {
		t.Fatal("Keeper = false, want true")
	}
	state = recorderOf(t)(host.RecorderSetTakeKeeper("Take 001", false))
	if state.Takes[0].Keeper {
		t.Fatal("Keeper = true, want false after undoing")
	}
}

func TestRecorderSetTakeKeeperWithoutAProjectIsRefused(t *testing.T) {
	if _, err := NewHost().RecorderSetTakeKeeper("Take 001", true); err == nil {
		t.Fatal("marked a keeper without a project")
	}
}

func TestTheMeterStartsAndStopsOnlyForTheBuiltInRecorder(t *testing.T) {
	fake := &recordingtest.Fake{}
	host := recorderHost(t, fake)
	if _, err := host.RecorderMeterStart("Mic"); err == nil {
		t.Fatal("metered while the project records with REAPER")
	}
	recorderOf(t)(host.RecorderChooseEngine(engineBuiltin))
	if state := recorderOf(t)(host.RecorderMeterStart("Mic")); state.Phase != recording.PhaseMetering {
		t.Fatalf("phase = %q", state.Phase)
	}
	recorderOf(t)(host.RecorderMeterStop())
	waitRecorderIdle(t, host)
	// Choosing REAPER again stops a meter.
	recorderOf(t)(host.RecorderMeterStart("Mic"))
	recorderOf(t)(host.RecorderChooseEngine(engineDAW))
	waitRecorderIdle(t, host)
}
