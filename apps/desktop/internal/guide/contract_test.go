package guide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// What Entities() sends to the UI (ADR 0069). The first file is built from the entities the Python sidecar's own test pins
// (guide-entities-sidecar.json), read back through the real service; the second is a record written by an older sidecar, with the
// nulls and missing objects normalizeEntity exists for.
func serviceWithGuideFile(t *testing.T, entities any) *Service {
	t.Helper()
	project := t.TempDir()
	path := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	bytes, err := json.Marshal(map[string]any{"schema_version": 2, "entities": entities})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	return New(project, "", "", nil, nil)
}

func TestContractEntitiesFromTheSidecarsOwnFile(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "guide-entities-sidecar.json"))
	if err != nil {
		t.Fatalf("the sidecar's entity file is missing (run the Python contract test with UPDATE_CONTRACTS=1): %v", err)
	}
	var entities []any
	if err := json.Unmarshal(bytes, &entities); err != nil {
		t.Fatal(err)
	}
	got, err := serviceWithGuideFile(t, entities).Entities()
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "guide-entities", got)
}

func TestContractEntitiesFromAnOlderSidecarAreNormalized(t *testing.T) {
	legacy := []any{map[string]any{
		"id": "entity-legacy", "canonical_name": "Hatter", "category": "Character", "occurrence_count": 0, "locked": false, "review_state": "generated",
		"aliases": []any{map[string]any{"text": "Mad Hatter"}}, "occurrences": nil, "personality_notes": nil, "relationships": nil,
	}}
	got, err := serviceWithGuideFile(t, legacy).Entities()
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "guide-entities-legacy", got)
}

func TestContractNoGuideFileYetIsAnEmptyList(t *testing.T) {
	got, err := New(t.TempDir(), "", "", nil, nil).Entities()
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "guide-entities-empty", got)
}
