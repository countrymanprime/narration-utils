package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/recents"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/wailsapp/wails/v2/pkg/options"
)

func TestResourceKeyChangesWithEmbeddedContent(t *testing.T) {
	first := fstest.MapFS{"cmd/narration-utils/resources/config.json": {Data: []byte(`{"version":1}`)}}
	second := fstest.MapFS{"cmd/narration-utils/resources/config.json": {Data: []byte(`{"version":2}`)}}

	firstKey, err := resourceKeyFor(first)
	if err != nil {
		t.Fatal(err)
	}
	secondKey, err := resourceKeyFor(second)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(firstKey, "v1-") {
		t.Fatalf("key %q lacks its cache namespace", firstKey)
	}
	if firstKey == secondKey {
		t.Fatal("different embedded resources must not share an extraction cache")
	}
}

func TestHostAPIVersionMatchesTheCurrentDesktopContract(t *testing.T) {
	if hostAPIVersion != 5 {
		t.Fatalf("host API version = %d, want 5; update it with apps/ui/src/hostApi.ts", hostAPIVersion)
	}
}

func TestBootstrapReportsCanonicalNarratableTotals(t *testing.T) {
	project := t.TempDir()
	path := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	data := `{"schemaVersion":1,"documentId":"book","importedAt":"2026-01-01T00:00:00Z","importer":{"format":"markdown"},"source":{"fileName":"book.md"},"chapters":[{"wordCount":100,"contentKind":"opening"},{"wordCount":1200,"contentKind":"narration"},{"wordCount":400,"contentKind":"reference"},{"wordCount":800}]}`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	host := NewHost()
	host.config.projectFolder = project
	boot := host.Bootstrap()
	manuscript, ok := boot["manuscript"].(map[string]any)
	if !ok || manuscript["narratableWordCount"] != 2000 || manuscript["narratableChapterCount"] != 2 {
		t.Fatalf("bootstrap manuscript totals = %#v", boot["manuscript"])
	}
}

func TestBootstrapOffersAManuscriptFileFoundInTheProjectFolder(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "Manuscript.docx"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := NewHost()
	host.config.projectFolder = project
	boot := host.Bootstrap()
	candidate, ok := boot["manuscriptCandidate"].(map[string]any)
	if boot["manuscript"] != nil || !ok || candidate["name"] != "Manuscript.docx" {
		t.Fatalf("bootstrap = manuscript %#v candidate %#v", boot["manuscript"], boot["manuscriptCandidate"])
	}
}

func TestPollWorkJobTailsSidecarProgressAndLogOnce(t *testing.T) {
	dir := t.TempDir()
	progress, logPath := filepath.Join(dir, "progress.txt"), filepath.Join(dir, "log.txt")
	job := &workJob{percent: 1}
	var logAt int64

	if err := os.WriteFile(progress, []byte("EXTRACT|30|Finding people, places, and organizations...\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(logPath, []byte("Reading canonical manuscript\nLoaded 120 paragraphs\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	pollWorkJob(job, progress, logPath, &logAt)
	if job.percent != 30 || job.message != "Finding people, places, and organizations..." || len(job.logs) != 2 {
		t.Fatalf("first poll: percent %d message %q logs %#v", job.percent, job.message, job.logs)
	}

	pollWorkJob(job, progress, logPath, &logAt)
	if len(job.logs) != 2 {
		t.Fatalf("an unchanged log must not be re-read: %#v", job.logs)
	}

	if err := os.WriteFile(progress, []byte("LOAD|5|Reading manuscript...\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("Merging generated entries\n"); err != nil {
		t.Fatal(err)
	}
	file.Close()
	pollWorkJob(job, progress, logPath, &logAt)
	if job.percent != 30 {
		t.Fatalf("progress moved backwards to %d", job.percent)
	}
	if len(job.logs) != 3 || job.logs[2] != "Merging generated entries" {
		t.Fatalf("appended line was not picked up: %#v", job.logs)
	}
}

func TestVoiceDownloadSizeIncludesEveryVerifiedFile(t *testing.T) {
	voice := tts.Voice{Files: []tts.File{{Name: "voice.onnx", Size: 10}, {Name: "voice.onnx.json", Size: 4}}}
	if size := voiceDownloadSize(voice); size != 14 {
		t.Fatalf("download size = %d, want 14", size)
	}
}

func TestResolveDeveloperSidecarsUsesCheckoutVirtualEnvironment(t *testing.T) {
	root := t.TempDir()
	python := filepath.Join(root, ".venv", "Scripts", "python.exe")
	if os.PathSeparator != '\\' {
		python = filepath.Join(root, ".venv", "bin", "python")
	}
	if err := os.MkdirAll(filepath.Dir(python), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(python, nil, 0o700); err != nil {
		t.Fatal(err)
	}
	host := &Host{config: config{repoRoot: root}}
	host.resolveDeveloperSidecars()
	if host.config.manuscriptPython != python || host.config.comparePython != python {
		t.Fatalf("sidecar Python = %#v", host.config)
	}
	if host.config.manuscriptBackend == "" || host.config.compareBackend == "" {
		t.Fatalf("sidecar backends = %#v", host.config)
	}
}

func TestParseConfigArgsUsesForwardedSecondInstanceArguments(t *testing.T) {
	config := parseConfigArgs(`C:\repo`, []string{"--project-folder", `C:\books\novel`, "--session-dir", `C:\books\novel\session`, "--daw", "reaper"})
	if config.projectFolder != `C:\books\novel` || config.sessionDir != `C:\books\novel\session` || config.daw != "reaper" {
		t.Fatalf("forwarded config = %#v", config)
	}
}

func TestCanAttachRejectsPreparedImportAndActiveTranscript(t *testing.T) {
	host := NewHost()
	host.manuscript.Begin("draft.md")
	if host.canAttachLocked() {
		t.Fatal("prepared manuscript import must prevent a project switch")
	}
	host.manuscript = manuscript.New("")
	project := t.TempDir()
	canonical := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(canonical), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(canonical, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	client, err := bridge.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	host.transcript = transcript.New(transcript.Config{Project: project}, client, host.settings, host.sidecars, nil)
	if err := host.transcript.Start(map[string]string{}); err != nil {
		t.Fatal(err)
	}
	if host.canAttachLocked() {
		t.Fatal("active transcript state must prevent a project switch")
	}
}

func TestAttachProjectLockedAppliesFolderNameAndDaw(t *testing.T) {
	host := NewHost()
	project := t.TempDir()
	next := host.config
	next.projectFolder, next.projectName, next.daw = project, "My Book", "Standalone"
	attached, reason := host.attachProjectLocked(next)
	if !attached || reason != "" {
		t.Fatalf("attachProjectLocked() = (%v, %q), want (true, \"\")", attached, reason)
	}
	if host.config.projectFolder != project || host.config.projectName != "My Book" || host.config.daw != "Standalone" {
		t.Fatalf("config after attach = %#v", host.config)
	}
	if host.transcript == nil || host.guide == nil {
		t.Fatal("attachProjectLocked must reconfigure project-scoped services")
	}
}

func TestAttachProjectLockedRejectsEmptyFolder(t *testing.T) {
	host := NewHost()
	before := host.config
	next := host.config
	next.projectName, next.daw = "Name", "Standalone"
	attached, reason := host.attachProjectLocked(next)
	if attached {
		t.Fatal("an empty folder must not attach")
	}
	if reason != "No project folder was provided." {
		t.Fatalf("reason = %q", reason)
	}
	if host.config != before {
		t.Fatalf("config changed on rejected attach: %#v", host.config)
	}
}

func TestAttachProjectLockedRefusesWhenBusy(t *testing.T) {
	host := NewHost()
	host.manuscript.Begin("draft.md")
	before := host.config
	next := host.config
	next.projectFolder, next.projectName, next.daw = t.TempDir(), "Busy Book", "Standalone"
	attached, reason := host.attachProjectLocked(next)
	if attached {
		t.Fatal("busy host must refuse to attach")
	}
	if reason != "Narration Utils is busy, so the current project was left unchanged." {
		t.Fatalf("reason = %q", reason)
	}
	if host.config != before {
		t.Fatalf("config changed while busy: %#v", host.config)
	}
}

func TestConfigureLockedToleratesAbsentSessionDirAndProjectFolder(t *testing.T) {
	root := t.TempDir()
	host := NewHost()
	host.configureLocked(parseConfigArgs(root, []string{}))

	boot := host.Bootstrap()
	if boot["projectFolder"] != "" {
		t.Fatalf("projectFolder = %#v, want empty", boot["projectFolder"])
	}
	if boot["manuscript"] != nil {
		t.Fatalf("manuscript = %#v, want nil", boot["manuscript"])
	}
	if host.transcript == nil || host.guide == nil {
		t.Fatal("project-scoped services must still be constructed with no project folder")
	}
}

func TestProjectCreateMakesDirectoryAndAttaches(t *testing.T) {
	host := NewHost()
	project := filepath.Join(t.TempDir(), "New Book")
	raw, err := host.ProjectCreate(project, "")
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result["switched"] != true {
		t.Fatalf("result = %#v, want switched:true", result)
	}
	if _, err := os.Stat(project); err != nil {
		t.Fatalf("project folder was not created: %v", err)
	}
	if host.config.projectFolder != project {
		t.Fatalf("projectFolder = %q, want %q", host.config.projectFolder, project)
	}
	if host.config.projectName != "New Book" {
		t.Fatalf("projectName = %q, want folder basename", host.config.projectName)
	}
}

func TestProjectCreateRefusesWithoutCreatingTheFolderWhenBusy(t *testing.T) {
	host := NewHost()
	host.manuscript.Begin("draft.md")
	before := host.config
	project := filepath.Join(t.TempDir(), "Busy Book")
	raw, err := host.ProjectCreate(project, "")
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result["switched"] != false {
		t.Fatalf("result = %#v, want switched:false", result)
	}
	if reason, _ := result["reason"].(string); reason != attachBusyReason {
		t.Fatalf("reason = %q, want the busy reason", reason)
	}
	if _, err := os.Stat(project); !os.IsNotExist(err) {
		t.Fatalf("a refused create must not leave the folder behind (stat error: %v)", err)
	}
	if host.config != before {
		t.Fatalf("config changed on a refused create: %#v", host.config)
	}
}

func TestProjectCreateRequiresAnAbsolutePath(t *testing.T) {
	host := NewHost()
	relative := filepath.Join("relative-project-folder-that-must-not-exist", "Book")
	t.Cleanup(func() { _ = os.RemoveAll("relative-project-folder-that-must-not-exist") })
	_, err := host.ProjectCreate(relative, "")
	if err == nil || !strings.Contains(err.Error(), "absolute") {
		t.Fatalf("err = %v, want an error saying the path must be absolute", err)
	}
	if _, statErr := os.Stat(relative); !os.IsNotExist(statErr) {
		t.Fatalf("a relative path must not create a folder under the working directory (stat error: %v)", statErr)
	}
}

func TestProjectSwitchRefusesWhenBusy(t *testing.T) {
	host := NewHost()
	host.manuscript.Begin("draft.md")
	raw, err := host.ProjectSwitch(t.TempDir(), "Busy Book")
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result["switched"] != false {
		t.Fatalf("result = %#v, want switched:false", result)
	}
	if reason, _ := result["reason"].(string); reason == "" {
		t.Fatal("expected a non-empty busy reason")
	}
}

func TestProjectSwitchTouchesRecents(t *testing.T) {
	host := NewHost()
	host.recents = recents.New(filepath.Join(t.TempDir(), "recent-projects.json"))
	project := t.TempDir()
	if _, err := host.ProjectSwitch(project, "My Project"); err != nil {
		t.Fatal(err)
	}
	entries, err := host.recents.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Path != filepath.Clean(project) || entries[0].Name != "My Project" {
		t.Fatalf("recents = %#v", entries)
	}
}

func TestProjectRecentsEncodesTheStoredList(t *testing.T) {
	host := NewHost()
	host.recents = recents.New(filepath.Join(t.TempDir(), "recent-projects.json"))
	project := t.TempDir()
	if err := host.recents.Touch(project, "My Project"); err != nil {
		t.Fatal(err)
	}
	raw, err := host.ProjectRecents()
	if err != nil {
		t.Fatal(err)
	}
	var entries []recents.Entry
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "My Project" {
		t.Fatalf("entries = %#v", entries)
	}
}

func TestProjectRecentsReturnsEmptyArrayWithNoStore(t *testing.T) {
	host := &Host{}
	raw, err := host.ProjectRecents()
	if err != nil {
		t.Fatal(err)
	}
	if raw != "[]" {
		t.Fatalf("raw = %q, want an empty JSON array", raw)
	}
}

func TestProjectRemoveRecentDropsTheEntry(t *testing.T) {
	host := NewHost()
	host.recents = recents.New(filepath.Join(t.TempDir(), "recent-projects.json"))
	first := t.TempDir()
	second := t.TempDir()
	if err := host.recents.Touch(first, "First"); err != nil {
		t.Fatal(err)
	}
	if err := host.recents.Touch(second, "Second"); err != nil {
		t.Fatal(err)
	}
	raw, err := host.ProjectRemoveRecent(first)
	if err != nil {
		t.Fatal(err)
	}
	var entries []recents.Entry
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "Second" {
		t.Fatalf("entries = %#v, want only %q left", entries, "Second")
	}
}

func TestProjectRemoveRecentReturnsEmptyArrayWithNoStore(t *testing.T) {
	host := &Host{}
	raw, err := host.ProjectRemoveRecent(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if raw != "[]" {
		t.Fatalf("raw = %q, want an empty JSON array", raw)
	}
}

func TestProjectSelectFolderRejectsWhenHostNotReady(t *testing.T) {
	host := NewHost()
	if _, err := host.ProjectSelectFolder(); err == nil || !strings.Contains(err.Error(), "not ready") {
		t.Fatalf("err = %v, want a not-ready error", err)
	}
}

func TestOnSecondInstanceRefreshesSessionDirFromNewArgs(t *testing.T) {
	host := NewHost()
	host.config.sessionDir = `C:\old\session`
	host.onSecondInstance(options.SecondInstanceData{Args: []string{
		"--project-folder", t.TempDir(),
		"--session-dir", `C:\new\session`,
		"--daw", "REAPER",
	}})
	if host.config.sessionDir != `C:\new\session` {
		t.Fatalf("sessionDir = %q, want the second launch's session dir", host.config.sessionDir)
	}
}

func TestWriteReaperLauncherPathRefreshesMovedExecutable(t *testing.T) {
	root := t.TempDir()
	if err := writeReaperLauncherPath(root, `C:\old\Narration Utils.exe`); err != nil {
		t.Fatal(err)
	}
	if err := writeReaperLauncherPath(root, `D:\moved\Narration Utils.exe`); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "reaper", "narration-utils-app-path.txt")
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(bytes), "D:\\moved\\Narration Utils.exe\n"; got != want {
		t.Fatalf("launcher target = %q, want %q", got, want)
	}
}
