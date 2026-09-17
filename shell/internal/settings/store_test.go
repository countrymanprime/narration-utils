package settings

import (
	"os"
	"path/filepath"
	"testing"
)

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
