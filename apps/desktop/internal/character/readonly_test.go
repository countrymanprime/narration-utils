package character

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadOnlyReturnsTheStoredReferences(t *testing.T) {
	dir := t.TempDir()

	// Approve requires a saved project, so seed references.json through a Service whose ProjectFile resolves,
	// mirroring how the other tests in this package seed data.
	rppPath := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(rppPath, []byte(twoRegions), 0o600); err != nil {
		t.Fatal(err)
	}
	approver := New(Config{Project: dir, ProjectFile: func() (string, error) { return rppPath, nil }})
	if _, err := approver.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "note"); err != nil {
		t.Fatal(err)
	}

	refs, err := ReadOnly(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].CharacterID != "char-alice" {
		t.Fatalf("unexpected references: %#v", refs)
	}
}

func TestReadOnlyOnAProjectWithNoReferencesYetIsEmptyNotAnError(t *testing.T) {
	refs, err := ReadOnly(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 0 {
		t.Fatalf("want no references for a project that never approved any, got %#v", refs)
	}
}

func TestReadOnlyFailsOnCorruptJSONWithoutTouchingTheFile(t *testing.T) {
	dir := t.TempDir()
	path := referencesPath(dir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := ReadOnly(dir); err == nil {
		t.Fatal("want an error reading a corrupt references file")
	}

	// ReadOnly must never quarantine, rename or otherwise write - it crosses into another project's data only to
	// read it (Phase 9, docs/prds/character-continuity-review.prd.md: "no write path from one project's session
	// into another project's own data").
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "{not json" {
		t.Fatalf("want the corrupt file left exactly as it was, got: %s", bytes)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("want no extra file written (no quarantine copy), found: %v", entries)
	}
}

func TestReadOnlyRefusesAFileWrittenByANewerSchema(t *testing.T) {
	dir := t.TempDir()
	path := referencesPath(dir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion": 999, "references": []}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadOnly(dir); err == nil {
		t.Fatal("want an error reading a references file from a newer schema version")
	}
}
