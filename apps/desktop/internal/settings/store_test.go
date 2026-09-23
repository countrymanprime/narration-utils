package settings

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func TestBuiltinDefaultsMatchRepoDefaultsFile(t *testing.T) {
	store := New(t.TempDir(), "")
	document := store.readDocument(layout.RepoFile(layout.DefaultsFile), persist.Disposable)
	if len(document) == 0 {
		t.Fatalf("could not read %s", layout.DefaultsFile)
	}
	for tool := range document {
		file := store.readTool(layout.RepoFile(layout.DefaultsFile), tool, persist.Disposable)
		for key, want := range file {
			if got := builtinDefaults[tool][key]; got != want {
				t.Errorf("builtinDefaults[%q][%q] = %q, defaults.json has %q", tool, key, got, want)
			}
		}
		for key := range builtinDefaults[tool] {
			if _, ok := file[key]; !ok {
				t.Errorf("builtinDefaults[%q][%q] is not in defaults.json", tool, key)
			}
		}
	}
}

// The store serves every DAW (audacity-integration PRD Phase 5), so refusing a project override with no project open must not
// tell an Audacity narrator, or a standalone one, to save a REAPER project.
func TestAProjectSaveWithNoProjectNamesNoDAW(t *testing.T) {
	value := "x"
	err := New(t.TempDir(), "").Save("General", "project", map[string]*string{"log_verbosity": &value})
	if err == nil {
		t.Fatal("a project save with no project must fail")
	}
	if strings.Contains(strings.ToLower(err.Error()), "reaper") {
		t.Fatalf("error = %q, want a DAW-neutral sentence", err)
	}
}

func TestDefaultsFallBackToBuiltinsWithoutARepoCheckout(t *testing.T) {
	store := New(t.TempDir(), "")
	if value, source := store.Effective("TranscriptCompare", "color_misread", ""); value != "FF4040" || source != "repo_default" {
		t.Fatalf("installed builds must still have color defaults, got %q from %q", value, source)
	}
}

func TestPreservesLayerPrecedenceAndProjectReset(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.MkdirAll(layout.Path(root, layout.ConfigDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(layout.Path(root, layout.DefaultsFile), []byte(`{"Piper":{"tts_voice_id":"default"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APPDATA", filepath.Join(root, "appdata"))
	store := New(root, project)
	global := "global"
	if err := store.Save("Piper", "global", map[string]*string{"tts_voice_id": &global}); err != nil {
		t.Fatal(err)
	}
	if value, source := store.Effective("Piper", "tts_voice_id", ""); value != "global" || source != "global" {
		t.Fatalf("%q %q", value, source)
	}
	local := "project"
	if err := store.Save("Piper", "project", map[string]*string{"tts_voice_id": &local}); err != nil {
		t.Fatal(err)
	}
	if value, source := store.Effective("Piper", "tts_voice_id", ""); value != "project" || source != "project" {
		t.Fatalf("%q %q", value, source)
	}
	if err := store.Save("Piper", "project", map[string]*string{"tts_voice_id": nil}); err != nil {
		t.Fatal(err)
	}
	if value, source := store.Effective("Piper", "tts_voice_id", ""); value != "global" || source != "global" {
		t.Fatalf("%q %q", value, source)
	}
}
