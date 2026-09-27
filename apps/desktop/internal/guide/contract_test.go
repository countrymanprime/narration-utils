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

// The pronunciation query list and its CSV, as the host sends them to the UI (prep-depth P3), from the same sidecar-written file.
func TestContractPronunciationQueriesFromTheSidecarsOwnFile(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "guide-entities-pronunciation-sidecar.json"))
	if err != nil {
		t.Fatal(err)
	}
	var entities []any
	if err := json.Unmarshal(bytes, &entities); err != nil {
		t.Fatal(err)
	}
	queries, err := serviceWithGuideFile(t, entities).PronunciationQueries()
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "guide-pronunciation-queries", queries)
	contractfile.Check(t, "guide-pronunciation-queries-csv", map[string]any{"csv": QueriesCSV(queries), "count": len(queries)})
}

func TestContractNoGuideFileYetHasNoPronunciationQueries(t *testing.T) {
	queries, err := New(t.TempDir(), "", "", nil, nil).PronunciationQueries()
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "guide-pronunciation-queries-empty", queries)
}

// The query-answer import result, as the host sends it to the UI (prep-depth P6), from the same sidecar-written file: a
// row naming an entry that is not in it, so the wire shape (applied, issues) is proven with no sidecar call needed.
func TestContractPronunciationQueriesImportFromTheSidecarsOwnFile(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "guide-entities-pronunciation-sidecar.json"))
	if err != nil {
		t.Fatal(err)
	}
	var entities []any
	if err := json.Unmarshal(bytes, &entities); err != nil {
		t.Fatal(err)
	}
	applied, issues, err := serviceWithGuideFile(t, entities).ImportQueriesCSV("word,entry_id\nGhost,entity-does-not-exist\n")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "guide-pronunciation-queries-import", map[string]any{"applied": applied, "issues": issues})
}

// The narrator's own pronunciation, its alternate, a status and a note (prep-depth P1), from the file the sidecar's own test writes.
func TestContractEntitiesWithPronunciationWorkFromTheSidecarsOwnFile(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "guide-entities-pronunciation-sidecar.json"))
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
	contractfile.Check(t, "guide-entities-pronunciation", got)
}
