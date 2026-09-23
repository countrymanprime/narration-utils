package guide

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// fixtureEntity builds an entity exactly as Service.Entities normalizes one,
// so tests exercise the same shape BuildFindings sees in production.
func fixtureEntity(id, reviewState string, locked bool, confidence string) map[string]any {
	return map[string]any{
		"id": id, "canonical_name": "Aria Wren", "category": "Character",
		"review_state": reviewState, "locked": locked,
		"pronunciation": map[string]any{"confidence": confidence},
		"occurrences": []any{
			map[string]any{"chapter": "Chapter One", "chapterId": "ch1", "paragraph": 2, "paragraphId": "p1", "excerpt": "Aria walked in."},
		},
	}
}

func TestBuildFindingsFlagsNeedsReviewEntity(t *testing.T) {
	entities := []map[string]any{fixtureEntity("ent1", "needs review", false, "high")}
	got := BuildFindings(entities, findings.Project{Path: "proj"})
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1: %+v", len(got), got)
	}
	f := got[0]
	if f.Category != findings.CategoryEntity {
		t.Errorf("Category = %q, want %q", f.Category, findings.CategoryEntity)
	}
	if f.Confidence != nil {
		t.Errorf("Confidence = %v, want nil (review_state is not a score)", *f.Confidence)
	}
	if f.Manuscript == nil || f.Manuscript.ChapterID != "ch1" {
		t.Errorf("Manuscript = %+v, want ChapterID ch1", f.Manuscript)
	}
	if err := f.Validate(); err != nil {
		t.Errorf("Validate() = %v", err)
	}
}

func TestBuildFindingsFlagsLowAndUnknownConfidencePronunciation(t *testing.T) {
	for _, label := range []string{"low", "unknown"} {
		t.Run(label, func(t *testing.T) {
			entities := []map[string]any{fixtureEntity("ent1", "reviewed", false, label)}
			got := BuildFindings(entities, findings.Project{Path: "proj"})
			if len(got) != 1 {
				t.Fatalf("len(got) = %d, want 1: %+v", len(got), got)
			}
			if got[0].Category != findings.CategoryPronunciation {
				t.Errorf("Category = %q, want %q", got[0].Category, findings.CategoryPronunciation)
			}
			if err := got[0].Validate(); err != nil {
				t.Errorf("Validate() = %v", err)
			}
		})
	}
}

func TestBuildFindingsIgnoresHighAndMediumConfidencePronunciation(t *testing.T) {
	for _, label := range []string{"high", "medium"} {
		t.Run(label, func(t *testing.T) {
			entities := []map[string]any{fixtureEntity("ent1", "reviewed", false, label)}
			got := BuildFindings(entities, findings.Project{Path: "proj"})
			if len(got) != 0 {
				t.Fatalf("len(got) = %d, want 0: %+v", len(got), got)
			}
		})
	}
}

func TestBuildFindingsIgnoresLockedEntitiesForBothConditions(t *testing.T) {
	entities := []map[string]any{fixtureEntity("ent1", "needs review", true, "unknown")}
	got := BuildFindings(entities, findings.Project{Path: "proj"})
	if len(got) != 0 {
		t.Fatalf("len(got) = %d, want 0 for a locked entity: %+v", len(got), got)
	}
}

func TestBuildFindingsProducesTwoIndependentFindingsWhenBothConditionsApply(t *testing.T) {
	entities := []map[string]any{fixtureEntity("ent1", "needs review", false, "unknown")}
	got := BuildFindings(entities, findings.Project{Path: "proj"})
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2: %+v", len(got), got)
	}
	if got[0].ID == got[1].ID {
		t.Errorf("both findings share id %q, want distinct ids so each resolves independently", got[0].ID)
	}
	categories := map[findings.Category]bool{got[0].Category: true, got[1].Category: true}
	if !categories[findings.CategoryEntity] || !categories[findings.CategoryPronunciation] {
		t.Errorf("categories = %v, want entity and pronunciation", categories)
	}
}

func TestBuildFindingsSkipsEntityWithNoID(t *testing.T) {
	entities := []map[string]any{{"canonical_name": "No Id", "review_state": "needs review", "locked": false}}
	got := BuildFindings(entities, findings.Project{Path: "proj"})
	if len(got) != 0 {
		t.Fatalf("len(got) = %d, want 0 for an entity with no id", len(got))
	}
}

func TestBuildFindingsIDsAreStableAcrossCalls(t *testing.T) {
	entities := []map[string]any{fixtureEntity("ent1", "needs review", false, "low")}
	first := BuildFindings(entities, findings.Project{Path: "proj"})
	second := BuildFindings(entities, findings.Project{Path: "proj"})
	if len(first) != 2 || len(second) != 2 {
		t.Fatalf("expected 2 findings each run, got %d and %d", len(first), len(second))
	}
	for i := range first {
		if first[i].ID != second[i].ID {
			t.Errorf("finding %d id changed across identical runs: %q vs %q", i, first[i].ID, second[i].ID)
		}
		if first[i].EvidenceVersion != second[i].EvidenceVersion {
			t.Errorf("finding %d evidence_version changed across identical runs: %q vs %q", i, first[i].EvidenceVersion, second[i].EvidenceVersion)
		}
	}
}

func TestBuildFindingsEvidenceVersionChangesWhenPronunciationConfidenceImproves(t *testing.T) {
	before := BuildFindings([]map[string]any{fixtureEntity("ent1", "reviewed", false, "low")}, findings.Project{Path: "proj"})
	after := BuildFindings([]map[string]any{fixtureEntity("ent1", "reviewed", false, "unknown")}, findings.Project{Path: "proj"})
	if len(before) != 1 || len(after) != 1 {
		t.Fatalf("expected one pronunciation finding each run, got %d and %d", len(before), len(after))
	}
	if before[0].EvidenceVersion == after[0].EvidenceVersion {
		t.Errorf("evidence_version unchanged though the confidence label changed from low to unknown")
	}
}
