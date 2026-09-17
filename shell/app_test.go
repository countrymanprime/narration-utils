package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
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
	if hostAPIVersion != 3 {
		t.Fatalf("host API version = %d, want 2; update it with shared/ui/src/hostApi.ts", hostAPIVersion)
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

func TestVoiceDownloadSizeIncludesEveryVerifiedFile(t *testing.T) {
	voice := tts.Voice{Files: []tts.File{{Name: "voice.onnx", Size: 10}, {Name: "voice.onnx.json", Size: 4}}}
	if size := voiceDownloadSize(voice); size != 14 {
		t.Fatalf("download size = %d, want 14", size)
	}
}

func TestDiscoverRepoRootFindsCheckoutFromShellDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "shared", "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "shared", "config", "defaults.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := discoverRepoRoot(filepath.Join(root, "shell", "nested")); got != root {
		t.Fatalf("repo root = %q, want %q", got, root)
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
