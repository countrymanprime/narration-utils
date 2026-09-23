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

// The REAPER identity narration_compare.lua appends to COMPARE_MARKER (review-dashboard PRD Phase 6), after srcpos.
const (
	markerItemGUID  = "{AAAAAAAA-0000-4000-8000-000000000001}"
	markerTakeGUID  = "{AAAAAAAA-0000-4000-8000-0000000000A1}"
	markerTrackGUID = "{00000001-0000-4000-8000-000000000001}"
)

func TestServiceCarriesTheMarkerGUIDsIntoTheSavedFindings(t *testing.T) {
	service, _ := testService(t)
	store := findings.NewStore(service.config.Project)
	service.SetFindings(store, &fakeLookup{chapterID: "chapter-1", chapterOK: true, paragraphID: "para-3", paragraphOK: true})
	service.state = empty()
	service.state["runId"], service.state["phase"], service.state["output"] = "run-1", "inspecting", resultsFixture()
	service.Handle(append(compareMarkerEvent("run-1", fixtureRows()[0]), markerItemGUID, markerTakeGUID, markerTrackGUID))
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "1 discrepancy found.", "1", "0"})

	saved, err := store.List(findings.Query{})
	if err != nil || len(saved) != 1 {
		t.Fatalf("saved %d findings, err %v", len(saved), err)
	}
	want := findings.Source{File: saved[0].Source.File, ItemGUID: markerItemGUID, TakeGUID: markerTakeGUID, TrackGUID: markerTrackGUID}
	if saved[0].Source != want {
		t.Fatalf("Source = %+v, want %+v", saved[0].Source, want)
	}
}

func TestAMarkerFromAScriptOlderThanTheGUIDsStillSavesAFindingWithoutThem(t *testing.T) {
	service, _ := testService(t)
	store := findings.NewStore(service.config.Project)
	service.SetFindings(store, nil)
	service.state = empty()
	service.state["runId"], service.state["phase"], service.state["output"] = "run-1", "inspecting", resultsFixture()
	service.Handle(compareMarkerEvent("run-1", fixtureRows()[0]))
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "1 discrepancy found.", "1", "0"})

	saved, err := store.List(findings.Query{})
	if err != nil || len(saved) != 1 {
		t.Fatalf("saved %d findings, err %v", len(saved), err)
	}
	if saved[0].Source.ItemGUID != "" || saved[0].Source.TakeGUID != "" || saved[0].Source.TrackGUID != "" {
		t.Fatalf("Source = %+v, want no GUIDs", saved[0].Source)
	}
}

func TestTheMarkerGUIDsStayInTheHostAndAreNotAddedToTheSnapshotRows(t *testing.T) {
	// The Transcript page's rows are a wire contract (apps/ui/src/api/schemas/transcript.ts); the GUIDs are for
	// findings, and navigation reaches the UI through the findings bindings, so the rows are unchanged.
	service, _ := testService(t)
	service.state = empty()
	service.state["runId"], service.state["phase"] = "run-1", "inspecting"
	service.Handle(append(compareMarkerEvent("run-1", fixtureRows()[0]), markerItemGUID, markerTakeGUID, markerTrackGUID))
	rows, _ := service.Snapshot()["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("rows = %v", service.Snapshot()["rows"])
	}
	for _, key := range []string{"itemGuid", "takeGuid", "trackGuid"} {
		if _, present := rows[0].(map[string]any)[key]; present {
			t.Errorf("snapshot row carries %s", key)
		}
	}
}
