package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
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
	// What GuideBuild answers: the job that started, or the first-use gate for the language model (release readiness phase 5).
	started := snapshotWork(&workJob{id: "guide-1", kind: "story_bible", phase: "running", message: "Story Bible rebuild started.", percent: 1, started: time.Now()})
	started["elapsed"] = 0.0
	contractfile.Check(t, "guide-build-started", map[string]any{"status": "started", "job": started})
	contractfile.Check(t, "guide-build-asset-required", spacyAssetRequired(spacy.Model{ID: "en_core_web_sm", Provider: "spacy", DisplayName: "English, small (fast)", Description: "The default: a small download that runs on any computer.",
		Version: "3.8.0", Publisher: "Explosion", License: "MIT", LicenseURL: "https://spacy.io/models/en#en_core_web_sm", ModelCardURL: "https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0",
		ProvenanceURL: "https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0", Attribution: "spaCy English pipeline by Explosion (MIT).",
		Files: []spacy.File{{Name: "w.whl", Size: 12806118, Extract: "model", Expand: 15251718}}}, "not_installed", "C:/Users/narrator/AppData/Local/narration-utils/assets/spacy/en_core_web_sm/3.8.0"))
	pinBinding("guide-build-failed", snapshotWork(&workJob{id: "guide-1", kind: "story_bible", phase: "error", message: "The Story Bible build failed.", errorText: "python exited with code 1", percent: 40, logs: []string{"Reading canonical manuscript", "Loaded 120 paragraphs"}, started: time.Now()}))
}

// How a project attach ends, as ProjectSwitch and ProjectCreateIn answer it, and the Story Bible answer that needs a voice.
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
	contractfile.Check(t, "guide-preview-asset-required", voiceAssetRequired(voice, "not_installed", "C:/Users/narrator/AppData/Local/narration-utils/assets/tts/piper/en_US-ljspeech-high/1.0.0"))
}

// The approved catalogs, built from the repository's real config files with nothing installed (ADR 0069), and the install jobs.
// contractFixture is what the catalog payloads are built from: the registry of approved assets and the settings that say which is selected.
type contractFixture struct {
	registry *assetRegistry
	settings *settings.Store
}

func contractServices(t *testing.T) contractFixture {
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
	languageModels, err := spacy.New(layout.RepoFile(layout.SpacyCatalogFile), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return contractFixture{registry: newAssetRegistry(t.TempDir(), voices, models, languageModels, nil), settings: settings.New(layout.FindRoot("."), "")}
}

func TestContractCatalogsAndInstallJobs(t *testing.T) {
	svc := contractServices(t)
	voices, err := ttsCatalogPayload(svc.registry, svc.settings)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "tts-catalog", voices)
	models, err := whisperCatalogPayload(svc.registry, svc.settings)
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
		contractfile.Check(t, name, legacyInstall(snapshotInstall(job)))
	}
}

// The generic asset API (release readiness phase 3): the list of everything that can be downloaded, and the answer to a verify.
func TestContractAssetsListAndVerify(t *testing.T) {
	fixture := contractServices(t)
	host := &Host{assets: fixture.registry, installJobs: map[string]*installJob{}}
	list, err := host.assetsList()
	if err != nil {
		t.Fatal(err)
	}
	// The cache folder is a per-machine path; the golden holds a fixed one so the file is the same everywhere.
	list["cacheRoot"] = "C:/Users/narrator/AppData/Local/narration-utils/assets"
	for _, entry := range list["assets"].([]map[string]any) {
		entry["path"] = "C:/Users/narrator/AppData/Local/narration-utils/assets/" + entry["kind"].(string) + "/" + entry["id"].(string)
	}
	contractfile.Check(t, "assets-list", list)
	contractfile.Check(t, "asset-install-downloading", snapshotInstall(&installJob{id: "tts-1", kind: installKindTts, assetID: "en_US-ljspeech-high", phase: installPhaseDownloading, message: "Downloading and verifying the approved voice…", done: 45678901, total: 114203981}))
	contractfile.Check(t, "assets-verify", map[string]any{"kind": "tts", "id": "en_US-ljspeech-high", "installState": "verification_failed"})
}

func TestContractAFirstUseGateForAModel(t *testing.T) {
	svc := contractServices(t)
	model, ok := svc.registry.whisper.Model("small")
	if !ok {
		t.Fatal("the approved catalog has no small model")
	}
	contractfile.Check(t, "transcript-start-asset-required", modelAssetRequired(model, svc.registry.whisper.State(model), "C:/Users/narrator/AppData/Local/narration-utils/assets/whisper/faster-whisper/small/536b0662742c02347bc0e980a01041f333bce120"))
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

// The confirmed chapter-track mapping's ChapterTrackMapList/Confirm/Clear payloads (analysis evidence ledger PRD,
// Phase 5, Q6). ConfirmedAt is a real timestamp (RFC3339Nano), so it is normalized to a fixed value before pinning -
// the same "machine-specific values are fixed" rule contractHost already applies to the diagnostic id.
func TestContractChapterTrackMap(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	project := t.TempDir()
	host := NewHost()
	host.config.projectFolder = project
	host.manuscript = manuscript.New(project)
	job := host.manuscript.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := host.manuscript.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := host.manuscript.Commit(job.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	chapters, err := host.manuscript.Chapters()
	if err != nil || len(chapters) == 0 {
		t.Fatalf("chapters = %#v, %v", chapters, err)
	}
	firstChapterID, _ := chapters[0]["id"].(string)

	pin := func(name string, value any) {
		normalized, err := normalizeMappingPayload(value)
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, normalized)
	}

	emptyRaw, err := host.ChapterTrackMapList()
	if err != nil {
		t.Fatal(err)
	}
	pin("chapter-track-map-empty", json.RawMessage(emptyRaw))

	confirmedRaw, err := host.ChapterTrackMapConfirm("{0E4D1D7F-D039-674D-87E6-719376DE95EC}", firstChapterID)
	if err != nil {
		t.Fatal(err)
	}
	pin("chapter-track-map-confirmed", json.RawMessage(confirmedRaw))

	listRaw, err := host.ChapterTrackMapList()
	if err != nil {
		t.Fatal(err)
	}
	pin("chapter-track-map-list", json.RawMessage(listRaw))
}

// normalizeMappingPayload decodes a JSON-encoded ChapterTrackMap binding payload and replaces every "confirmedAt"
// field (a real time.Now() value) and "documentId" field (newID()'s random hex, manuscript/service.go) with fixed
// values, so neither ever makes a committed contract fixture flap from one test run to the next - the same
// "machine-specific values are fixed" rule contractHost already applies to the diagnostic id.
func normalizeMappingPayload(value any) (any, error) {
	const fixedTime = "2026-01-01T00:00:00Z"
	const fixedDocumentID = "doc-fixed-for-contract-test"
	bytes, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded map[string]any
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		return nil, err
	}
	if _, ok := decoded["confirmedAt"]; ok {
		decoded["confirmedAt"] = fixedTime
	}
	if _, ok := decoded["documentId"]; ok {
		decoded["documentId"] = fixedDocumentID
	}
	if mappings, ok := decoded["mappings"].([]any); ok {
		for _, entry := range mappings {
			if mapping, ok := entry.(map[string]any); ok {
				mapping["confirmedAt"] = fixedTime
			}
		}
	}
	return decoded, nil
}

// The system:notice event: something the app did for the narrator that they should read (ADR 0069).
func TestContractNarratorNotice(t *testing.T) {
	contractfile.Check(t, "system-notice", noticePayload("Your notes file could not be read. It was kept as manuscript-notes.json.corrupt-20260921-101530 next to the original, and a fresh one was started."))
}

// ProjectLinkDawFile's result (PRD project-workspace-and-daw-link.prd.md, Open Question W19): a file linked inside the
// project folder, one outside it (refused, W15), and the dialog cancelled.
func TestContractProjectLinkDawFile(t *testing.T) {
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Alice.rpp")
	if err := os.WriteFile(rpp, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	linked, err := linkDawFile(nil, folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	stableLinked, err := contractfile.PortablePaths(linked, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "daw-link-selected", stableLinked)

	other := t.TempDir()
	elsewhere := filepath.Join(other, "Elsewhere.rpp")
	if err := os.WriteFile(elsewhere, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	mismatch, err := linkDawFile(nil, folder, elsewhere)
	if err != nil {
		t.Fatal(err)
	}
	stableMismatch, err := contractfile.PortablePaths(mismatch, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	stableMismatch, err = contractfile.PortablePaths(stableMismatch, other, "C:/Projects/Elsewhere")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "daw-link-folder-mismatch", stableMismatch)

	contractfile.Check(t, "daw-link-cancelled", map[string]any{"selected": false, "linked": false})
}

// DawLaunch's result (Phase 8, docs/prds/project-workspace-and-daw-link.prd.md).
func TestContractDawLaunch(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never read the real machine's global-settings.json
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Alice.rpp")
	if err := os.WriteFile(rpp, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link, err := project.BuildDawLink(folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	manifest := project.New("Alice", time.Now())
	manifest.DawProjectFile = &link
	if err := manifest.Save(folder); err != nil {
		t.Fatal(err)
	}
	svc := hostServices{config: config{projectFolder: folder}, settings: settings.New("", folder)}
	locate := func() (string, string, error) {
		return `C:\Program Files\REAPER (x64)\reaper.exe`, "uninstall_registry", nil
	}
	launched, err := launchReaper(svc, nil, locate, func(string, []string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	stable, err := contractfile.PortablePaths(launched, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "daw-launch", stable)
}

// CreditsTemplates' shipped defaults (audiobook-credits-templates.prd.md, Phase 1).
func TestContractCreditsTemplates(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	templates, err := host.creditTemplates.List()
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "credits-templates", templates)
}

// CreditsProjectValues' payload for a project with no credits saved yet, and CreditsPreview's Result for a template with
// one unresolved token (Success Metrics: "unresolved tokens are reported by name").
func TestContractCreditsProjectValuesAndPreview(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	folder := t.TempDir()
	host := NewHost()
	host.config.projectFolder = folder
	host.config.projectName = "Alice"
	host.settings = settings.New(layout.FindRoot("."), folder)
	values, err := host.CreditsProjectValues()
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(values), &decoded); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "credits-project-values-empty", decoded)

	preview, err := host.CreditsPreview("[Title], written by [Author], narrated by [Narrator].")
	if err != nil {
		t.Fatal(err)
	}
	var decodedPreview map[string]any
	if err := json.Unmarshal([]byte(preview), &decodedPreview); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "credits-preview-unresolved", decodedPreview)
}
