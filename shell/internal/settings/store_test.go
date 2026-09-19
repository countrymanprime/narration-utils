package settings

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuiltinDefaultsMatchRepoDefaultsFile(t *testing.T) {
	document := readDocument(filepath.Join("..", "..", "..", "shared", "config", "defaults.json"))
	if len(document) == 0 {
		t.Fatal("could not read shared/config/defaults.json")
	}
	for tool := range document {
		file := readTool(filepath.Join("..", "..", "..", "shared", "config", "defaults.json"), tool)
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

func TestDefaultsFallBackToBuiltinsWithoutARepoCheckout(t *testing.T) {
	store := New(t.TempDir(), "")
	if value, source := store.Effective("TranscriptCompare", "color_misread", ""); value != "FF4040" || source != "repo_default" {
		t.Fatalf("installed builds must still have color defaults, got %q from %q", value, source)
	}
}

func TestPreservesLayerPrecedenceAndProjectReset(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if err := os.MkdirAll(filepath.Join(root, "shared", "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "shared", "config", "defaults.json"), []byte(`{"Piper":{"tts_voice_id":"default"}}`), 0o600); err != nil {
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
