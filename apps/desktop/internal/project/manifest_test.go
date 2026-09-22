package project

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewManifestCarriesTheScannableMarkerNameAndCreationDate(t *testing.T) {
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)

	manifest := New("Alice in Wonderland", now)

	if manifest.Marker != Marker {
		t.Fatalf("Marker = %q, want %q", manifest.Marker, Marker)
	}
	if manifest.Name != "Alice in Wonderland" {
		t.Fatalf("Name = %q, want %q", manifest.Name, "Alice in Wonderland")
	}
	if !manifest.CreatedAt.Equal(now) {
		t.Fatalf("CreatedAt = %v, want %v", manifest.CreatedAt, now)
	}
}

func TestSaveThenLoadRoundTripsTheManifest(t *testing.T) {
	project := t.TempDir()
	manifest := New("Alice in Wonderland", time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC))
	manifest.DawProjectFile = &DawLink{Absolute: filepath.Join(project, "alice.rpp"), Relative: "alice.rpp"}

	if err := manifest.Save(project); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	loaded, ok, err := Load(nil, project)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !ok {
		t.Fatalf("Load() ok = false, want true")
	}
	if loaded.Marker != Marker || loaded.Name != "Alice in Wonderland" {
		t.Fatalf("loaded = %+v, want marker %q and name %q", loaded, Marker, "Alice in Wonderland")
	}
	if !loaded.CreatedAt.Equal(manifest.CreatedAt) {
		t.Fatalf("CreatedAt = %v, want %v", loaded.CreatedAt, manifest.CreatedAt)
	}
	if loaded.DawProjectFile == nil || loaded.DawProjectFile.Absolute != manifest.DawProjectFile.Absolute {
		t.Fatalf("DawProjectFile = %+v, want %+v", loaded.DawProjectFile, manifest.DawProjectFile)
	}
}

func TestLoadOnAProjectWithNoManifestReturnsNotOkWithoutAnError(t *testing.T) {
	project := t.TempDir()

	loaded, ok, err := Load(nil, project)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if ok || loaded != nil {
		t.Fatalf("Load() = %+v, %v, want nil, false", loaded, ok)
	}
}

func TestSaveWritesReadableIndentedJSONUnderTheNarrationUtilsSidecarFolder(t *testing.T) {
	project := t.TempDir()
	manifest := New("Alice", time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC))

	if err := manifest.Save(project); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	path := Path(project)
	if filepath.Dir(path) != filepath.Join(project, "narration-utils") {
		t.Fatalf("Path() = %q, want it under %q", path, filepath.Join(project, "narration-utils"))
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("could not read %s: %v", path, err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("project.json is not valid JSON: %v", err)
	}
	if decoded["marker"] != Marker {
		t.Fatalf("marker field = %v, want %q", decoded["marker"], Marker)
	}
}

func TestSaveOverwritesAnExistingManifestInPlace(t *testing.T) {
	project := t.TempDir()
	first := New("Working Title", time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC))
	if err := first.Save(project); err != nil {
		t.Fatalf("first Save() error = %v", err)
	}

	second := New("Final Title", time.Date(2026, 9, 22, 12, 0, 0, 0, time.UTC))
	if err := second.Save(project); err != nil {
		t.Fatalf("second Save() error = %v", err)
	}

	loaded, ok, err := Load(nil, project)
	if err != nil || !ok {
		t.Fatalf("Load() = %+v, %v, %v", loaded, ok, err)
	}
	if loaded.Name != "Final Title" {
		t.Fatalf("Name = %q, want %q", loaded.Name, "Final Title")
	}
}
