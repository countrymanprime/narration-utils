package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// The Bootstrap payloads the UI receives (ADR 0069). The UI's contract tests validate these files against its schemas and
// the mock client's answers against the same schemas, so a Bootstrap that drifts from its schema fails here or there.
// Machine-specific values (the temp project folder, the diagnostic id) are fixed so the files are stable.
func contractHost(t *testing.T, project string) *Host {
	t.Helper()
	host := NewHost()
	host.diagnostic = "go-1789000000000000000"
	host.config.projectFolder = project
	host.config.projectName = "Alice"
	host.config.daw = "REAPER"
	host.config.manuscriptPython, host.config.manuscriptBackend = "python.exe", "manuscript_guide.py"
	host.config.comparePython, host.config.compareBackend = "python.exe", "compare.py"
	host.config.reaperLauncher = "narration_launcher.lua"
	return host
}

func fixedBootstrap(host *Host) map[string]any {
	boot := host.Bootstrap()
	boot["projectFolder"] = "C:/Projects/Alice"
	if candidate, ok := boot["manuscriptCandidate"].(map[string]any); ok {
		candidate["path"] = "C:/Projects/Alice/Manuscript.docx"
	}
	return boot
}

func TestContractBootstrapWithAnImportedManuscript(t *testing.T) {
	project := t.TempDir()
	path := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	data := `{"schemaVersion":1,"documentId":"alice-1","importedAt":"2026-09-01T09:30:00Z","importer":{"format":"docx"},"source":{"fileName":"Alice.docx"},"chapters":[{"wordCount":120,"contentKind":"opening"},{"wordCount":1200,"contentKind":"narration"},{"wordCount":800,"contentKind":"narration"}]}`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "bootstrap-manuscript", fixedBootstrap(contractHost(t, project)))
}

func TestContractBootstrapOfferingAManuscriptCandidate(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "Manuscript.docx"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "bootstrap-candidate", fixedBootstrap(contractHost(t, project)))
}

func TestContractBootstrapOfAStandaloneLaunchWithNoProject(t *testing.T) {
	host := contractHost(t, "")
	host.config.projectName, host.config.daw = "", "Standalone"
	contractfile.Check(t, "bootstrap-standalone", host.Bootstrap())
}

// The Story Bible build job as GuideBuildState sends it (ADR 0069). Elapsed time is the only value that varies.
func TestContractStoryBibleBuildJob(t *testing.T) {
	host := contractHost(t, "")
	pinBinding := func(name string, job map[string]any) {
		job["elapsed"] = 2.5
		contractfile.Check(t, name, job)
	}
	pinBinding("guide-build-idle", host.guideBuildState())
	// A job just started has no log lines yet: its `logs` is a nil slice, which the host sends as null.
	pinBinding("guide-build-starting", snapshotWork(&workJob{id: "guide-1", kind: "story_bible", phase: "running", message: "Preparing…", started: time.Now()}))
	pinBinding("guide-build-failed", snapshotWork(&workJob{id: "guide-1", kind: "story_bible", phase: "error", message: "The Story Bible build failed.", errorText: "python exited with code 1", percent: 40, logs: []string{"Reading canonical manuscript", "Loaded 120 paragraphs"}, started: time.Now()}))
}

// How a project attach ends, as ProjectSwitch and ProjectCreate answer it, and the Story Bible answer that needs a voice.
func TestContractProjectAttachResults(t *testing.T) {
	for name, attached := range map[string]struct {
		ok     bool
		reason string
	}{"project-switch-attached": {true, ""}, "project-switch-refused": {false, attachBusyReason}} {
		encoded, err := attachResult(attached.ok, attached.reason)
		if err != nil {
			t.Fatal(err)
		}
		var decoded any
		if err := json.Unmarshal([]byte(encoded), &decoded); err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, decoded)
	}
}

func TestContractPreviewNeedsAVoice(t *testing.T) {
	voice := tts.Voice{
		ID: "en_US-ljspeech-high", Provider: "piper", DisplayName: "LJSpeech (high)", Locale: "en_US", Version: "1.0", Publisher: "rhasspy",
		License: "CC0-1.0", LicenseURL: "https://example.test/license", ModelCardURL: "https://example.test/card", ProvenanceURL: "https://example.test/source",
		Attribution: "LJ Speech dataset", Files: []tts.File{{Name: "voice.onnx", Size: 114_000_000}, {Name: "voice.onnx.json", Size: 4_800}},
	}
	contractfile.Check(t, "guide-preview-asset-required", voiceAssetRequired(voice, "not_installed"))
}

// The approved catalogs, built from the repository's real config files with nothing installed (ADR 0069), and the install jobs.
func contractServices(t *testing.T) hostServices {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	voices, err := tts.New(layout.RepoFile(layout.TTSCatalogFile), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	models, err := whisper.New(layout.RepoFile(layout.WhisperCatalogFile), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return hostServices{tts: voices, whisper: models, settings: settings.New(layout.FindRoot("."), "")}
}

func TestContractCatalogsAndInstallJobs(t *testing.T) {
	svc := contractServices(t)
	voices, err := ttsCatalogPayload(svc)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "tts-catalog", voices)
	models, err := whisperCatalogPayload(svc)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "whisper-catalog", models)

	for name, job := range map[string]*installJob{
		"tts-install-downloading":     {id: "tts-1", kind: installKindTts, assetID: "en_US-ljspeech-high", phase: installPhaseDownloading, message: "Downloading and verifying the approved voice…", done: 45678901, total: 114203981},
		"tts-install-verifying":       {id: "tts-1", kind: installKindTts, assetID: "en_US-ljspeech-high", phase: installPhaseVerifying, message: "Checking the voice against its approved checksum…", done: 114203981, total: 114203981},
		"tts-install-success":         {id: "tts-1", kind: installKindTts, assetID: "en_US-ljspeech-high", phase: installPhaseSuccess, message: "Voice installed and verified.", done: 114203981, total: 114203981},
		"tts-install-error":           {id: "tts-1", kind: installKindTts, assetID: "en_US-ljspeech-high", phase: installPhaseError, message: "The downloaded voice did not match the approved file, so it was not installed.", errorText: "The downloaded voice did not match the approved file, so it was not installed.", done: 20000000, total: 114203981},
		"tts-install-cancelled":       {id: "tts-1", kind: installKindTts, assetID: "en_US-ljspeech-high", phase: installPhaseCancelled, message: "Voice download cancelled.", done: 20000000, total: 114203981},
		"whisper-install-downloading": {id: "whisper-1", kind: installKindWhisper, assetID: "small", phase: installPhaseDownloading, message: "Downloading and verifying the approved Whisper model…", done: 120000000, total: 486212372},
		"whisper-install-success":     {id: "whisper-1", kind: installKindWhisper, assetID: "small", phase: installPhaseSuccess, message: "Whisper model installed and verified.", done: 486212372, total: 486212372},
	} {
		contractfile.Check(t, name, snapshotInstall(job))
	}
}

func TestContractAFirstUseGateForAModel(t *testing.T) {
	svc := contractServices(t)
	model, ok := svc.whisper.Model("small")
	if !ok {
		t.Fatal("the approved catalog has no small model")
	}
	contractfile.Check(t, "transcript-start-asset-required", modelAssetRequired(model, svc.whisper.State(model)))
	contractfile.Check(t, "transcript-start-started", map[string]any{"status": "started"})
}

// The Settings page's fields for both scopes, from the real field schemas and the repository's defaults.
func TestContractSettingsForEachScope(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	project := t.TempDir()
	host := NewHost()
	host.settings = settings.New(layout.FindRoot("."), project)
	for _, scope := range []string{"global", "project"} {
		fields, err := host.settingsForScope(scope)
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, "settings-"+scope, fields)
	}
}

// The Tracks page's discovery as TracksDiscover and TracksSelect send it: nothing found (a nil list, sent as null), several files and
// no choice yet, and one file that is selected on its own.
func TestContractTracksDiscovery(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	pin := func(name, folder string) {
		discovery, err := discoverTracks(hostServices{config: config{projectFolder: folder}, settings: settings.New(layout.FindRoot("."), folder)})
		if err != nil {
			t.Fatal(err)
		}
		stable, err := contractfile.PortablePaths(discovery, folder, "C:/Projects/Alice")
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, stable)
	}
	write := func(folder, file string) {
		if err := os.WriteFile(filepath.Join(folder, file), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	none, several, one := t.TempDir(), t.TempDir(), t.TempDir()
	write(several, "Alice.rpp")
	write(several, "Alice-alt-mix.rpp")
	write(one, "Alice.rpp")
	pin("tracks-discovery-none", none)
	pin("tracks-discovery-several", several)
	pin("tracks-discovery-selected", one)
}

// The system:notice event: something the app did for the narrator that they should read (ADR 0069).
func TestContractNarratorNotice(t *testing.T) {
	contractfile.Check(t, "system-notice", noticePayload("Your notes file could not be read. It was kept as manuscript-notes.json.corrupt-20260921-101530 next to the original, and a fresh one was started."))
}
