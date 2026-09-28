package guide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeGuideDocument(t *testing.T, project string, document map[string]any) {
	t.Helper()
	path := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	bytes, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestReadOnlyNamesReturnsCanonicalNamesByID(t *testing.T) {
	dir := t.TempDir()
	writeGuideDocument(t, dir, map[string]any{
		"schema_version": 2,
		"entities": []any{
			map[string]any{"id": "entity-alice", "canonical_name": "Alice", "category": "Character"},
			map[string]any{"id": "entity-hatter", "canonical_name": "Hatter", "category": "Character"},
		},
	})

	names, err := ReadOnlyNames(dir)
	if err != nil {
		t.Fatal(err)
	}
	if names["entity-alice"] != "Alice" || names["entity-hatter"] != "Hatter" {
		t.Fatalf("unexpected names: %#v", names)
	}
}

func TestReadOnlyNamesExcludesDraftEntities(t *testing.T) {
	dir := t.TempDir()
	writeGuideDocument(t, dir, map[string]any{
		"schema_version": 2,
		"entities": []any{
			map[string]any{"id": "entity-new", "canonical_name": "New entity", "category": "Draft"},
		},
	})

	names, err := ReadOnlyNames(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 0 {
		t.Fatalf("want a Draft entity excluded, got %#v", names)
	}
}

func TestReadOnlyNamesOnAProjectWithNoStoryBibleYetIsEmptyNotAnError(t *testing.T) {
	names, err := ReadOnlyNames(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 0 {
		t.Fatalf("want no names for a project with no Story Bible built yet, got %#v", names)
	}
}

func TestReadOnlyNamesFailsOnCorruptJSONWithoutTouchingTheFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ManuscriptGuide", "manuscript_guide.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := ReadOnlyNames(dir); err == nil {
		t.Fatal("want an error reading a corrupt Story Bible file")
	}

	// ReadOnlyNames is a read-only cross-project path (character.ReadOnly's own precedent): it must never quarantine,
	// rename or otherwise touch a file it does not own.
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "{not json" {
		t.Fatalf("want the corrupt file left exactly as it was, got: %s", bytes)
	}
}

func TestReadOnlyNamesRefusesAFileWrittenByANewerSchema(t *testing.T) {
	dir := t.TempDir()
	writeGuideDocument(t, dir, map[string]any{"schema_version": 999, "entities": []any{}})
	if _, err := ReadOnlyNames(dir); err == nil {
		t.Fatal("want an error reading a Story Bible file from a newer schema version")
	}
}
