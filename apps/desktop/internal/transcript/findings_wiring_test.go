package transcript

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// compareMarkerEvent builds the exact COMPARE_MARKER field list
// narration_compare.lua's inspect_results sends, from a fixtureRow, so this
// test drives Service.Handle the same way the real bridge does.
func compareMarkerEvent(runID string, row map[string]any) []string {
	return []string{
		"COMPARE_MARKER", runID, row["id"].(string), row["kind"].(string), row["name"].(string),
		row["docText"].(string), row["audioText"].(string),
		strconv.FormatFloat(row["projectTime"].(float64), 'f', -1, 64), strconv.Itoa(row["itemIndex"].(int)),
		row["chapter"].(string), strconv.Itoa(row["paragraph"].(int)),
		row["scriptContext"].(string), row["audioContext"].(string),
		row["markerState"].(string), row["existingMarkerName"].(string),
		strconv.FormatFloat(row["srcpos"].(float64), 'f', -1, 64),
	}
}

func TestServiceSavesFindingsWhenCompareInspectedArrivesWithFindingsWired(t *testing.T) {
	service, session := testService(t)
	store := findings.NewStore(service.config.Project)
	lookup := &fakeLookup{chapterID: "chapter-1", chapterOK: true, paragraphID: "para-3", paragraphOK: true}
	service.SetFindings(store, lookup)

	manifestBytes, err := os.ReadFile(manifestFixture())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(session, "manifest_run-1.txt"), manifestBytes, 0o600); err != nil {
		t.Fatal(err)
	}

	service.state = empty()
	service.state["runId"], service.state["phase"], service.state["output"] = "run-1", "inspecting", resultsFixture()
	for _, row := range fixtureRows() {
		service.Handle(compareMarkerEvent("run-1", row))
	}
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "4 discrepancy(s) found.", "4", "0"})

	saved, err := store.List(findings.Query{})
	if err != nil {
		t.Fatalf("store.List() error = %v", err)
	}
	if len(saved) != 4 {
		t.Fatalf("store has %d findings after COMPARE_INSPECTED, want 4: %+v", len(saved), saved)
	}
	for _, f := range saved {
		if f.Manuscript.ChapterID != "chapter-1" {
			t.Errorf("finding %s: ChapterID = %q, want chapter-1", f.ID, f.Manuscript.ChapterID)
		}
	}
}

func TestServiceNeverSavesFindingsWhenFindingsIsNotWired(t *testing.T) {
	service, _ := testService(t)
	// No SetFindings call: existing callers (every other test in this
	// package) must see identical behavior to before this feature existed.
	service.state = empty()
	service.state["runId"], service.state["phase"], service.state["output"] = "run-1", "inspecting", resultsFixture()
	service.Handle(compareMarkerEvent("run-1", fixtureRows()[0]))
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "1 discrepancy found.", "1", "0"})
	// No panic and no findings directory created is the assertion: saveFindings must be a true no-op.
	if _, err := os.Stat(filepath.Join(service.config.Project, findings.Dir)); !os.IsNotExist(err) {
		t.Fatalf("findings directory exists though SetFindings was never called: %v", err)
	}
}
