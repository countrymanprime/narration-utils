package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
)

// contractManuscriptLookup resolves every Transcript Compare chapter title to one chapter and paragraph id, as
// *manuscript.Service does for a linked manuscript, so the golden findings carry resolved manuscript anchors.
type contractManuscriptLookup struct{}

func (contractManuscriptLookup) ChapterIDByTitle(string) (string, bool, bool) {
	return "chapter-1", false, true
}
func (contractManuscriptLookup) ParagraphID(_ string, globalIndex int) (string, bool) {
	return fmt.Sprintf("chapter-1-p%d", globalIndex), true
}

// compareMarkerRow builds a row the way transcript.Service builds one from a COMPARE_MARKER event, with the item, take
// and track GUIDs the bridge appends (review-dashboard PRD Phase 6), which a finding is navigated by.
func compareMarkerRow(paragraph, itemIndex int, srcpos, projectTime float64, kind, doc, audio, script, audioContext, state, existing string) map[string]any {
	return map[string]any{
		"id": fmt.Sprintf("%d_%.3f", itemIndex, srcpos), "kind": kind, "docText": doc, "audioText": audio,
		"projectTime": projectTime, "itemIndex": itemIndex, "srcpos": srcpos, "chapter": "Chapter One", "paragraph": paragraph,
		"scriptContext": script, "audioContext": audioContext, "markerState": state, "existingMarkerName": existing,
		"itemGuid": fmt.Sprintf("{A1B2C3D4-0000-4000-8000-%012d}", itemIndex+1), "takeGuid": "{A1B2C3D4-0000-4000-8000-0000000000A1}",
		"trackGuid": "{A1B2C3D4-0000-4000-8000-0000000000F1}",
	}
}

// storyBibleEntity builds an entity the way guide.Service.Entities normalizes one.
func storyBibleEntity(id, name, reviewState, pronunciation string) map[string]any {
	return map[string]any{
		"id": id, "canonical_name": name, "category": "Character", "review_state": reviewState, "locked": false,
		"pronunciation": map[string]any{"confidence": pronunciation},
		"occurrences": []any{map[string]any{"chapter": "Chapter One", "chapterId": "chapter-1", "paragraph": 2,
			"paragraphId": "chapter-1-p2", "excerpt": name + " walked in."}},
	}
}

// contractReviewHost is a host over a temp project whose findings store holds what the real adapters produce:
// three of Transcript Compare's fixture markers (internal/transcript/testdata) and two Story Bible entities, one
// of which the latest Story Bible run no longer flags, so it is carried forward as not_in_latest_run.
func contractReviewHost(t *testing.T) *Host {
	t.Helper()
	folder := t.TempDir()
	store := findings.NewStore(folder)
	project := findings.Project{Path: "C:/Projects/Alice"}
	rows := []map[string]any{
		compareMarkerRow(3, 0, 12.340, 100.340, "MISREAD", "the quick brown fox", "the quick brown socks",
			"The quick brown fox jumped over the lazy dog.", "The quick brown socks jumped over the lazy dog.", "pending", ""),
		compareMarkerRow(3, 0, 45.100, 133.100, "SKIPPED", "jumped over", "",
			"The quick brown fox jumped over the lazy dog.", "The quick brown fox the lazy dog.", "pending", ""),
		compareMarkerRow(4, 0, 67.890, 155.890, "EXTRA", "", "and then",
			"It was a dark and stormy night.", "It was and then a dark and stormy night.", "existing", "TAKE 2"),
	}
	testdata := filepath.Join("internal", "transcript", "testdata")
	grouped, err := transcript.BuildFindings(rows, filepath.Join(testdata, "results_run-fixture.txt"),
		filepath.Join(testdata, "manifest_run-fixture.txt"), project, contractManuscriptLookup{})
	if err != nil {
		t.Fatal(err)
	}
	for scope, fresh := range grouped {
		if _, err := store.SaveAnalyzerFindings("transcript-compare", scope, fresh); err != nil {
			t.Fatal(err)
		}
	}
	aria := storyBibleEntity("ent-aria", "Aria Wren", "needs review", "high")
	tobias := storyBibleEntity("ent-tobias", "Tobias Vane", "reviewed", "low")
	for _, run := range [][]map[string]any{{aria, tobias}, {aria}} {
		if _, err := store.SaveAnalyzerFindings("story-bible", "entities", guide.BuildFindings(run, project)); err != nil {
			t.Fatal(err)
		}
	}
	host := &Host{findings: store}
	host.config.projectFolder = folder
	return host
}

// What FindingsList, FindingsReview and FindingsSummary send (review dashboard Phase 4, ADR 0120): a decided
// finding, the evidence shapes the store holds today, and a finding not in the latest run. FindingsGet sends the
// same record as FindingsReview, so it has no file of its own.
func TestContractFindingsReviewBindings(t *testing.T) {
	host := contractReviewHost(t)
	var shown findings.Page
	if first, err := host.FindingsList(FindingsQuery{Analyzer: "transcript-compare", Sort: "time", Limit: 1}); err != nil {
		t.Fatal(err)
	} else if err := json.Unmarshal([]byte(first), &shown); err != nil || len(shown.Findings) != 1 {
		t.Fatalf("first transcript finding: %v %s", err, first)
	}
	reviewed, err := host.FindingsReview(shown.Findings[0].ID, shown.Findings[0].EvidenceVersion, "dismissed", "Room noise, not a misread.")
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "findings-review", reviewed)

	listed, err := host.FindingsList(FindingsQuery{IncludeNotInLatestRun: true})
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "findings-list", listed)

	summary, err := host.FindingsSummary()
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "findings-summary", summary)
}

// checkBindingContract pins a string binding's answer as the UI receives it, with the decision timestamp fixed.
func checkBindingContract(t *testing.T, name, payload string) {
	t.Helper()
	var decoded any
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatal(err)
	}
	stable, err := contractfile.Stabilize(decoded)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, name, stable)
}
