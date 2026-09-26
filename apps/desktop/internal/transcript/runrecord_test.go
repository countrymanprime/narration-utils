package transcript

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// recordedRuns wires a recorder that keeps every reported run.
func recordedRuns(service *Service) *[]CompletedRun {
	runs := &[]CompletedRun{}
	service.SetRunRecorder(func(run CompletedRun) { *runs = append(*runs, run) })
	return runs
}

func inspecting(service *Service, options map[string]string) {
	service.state = empty()
	service.state["runId"], service.state["phase"], service.state["output"] = "run-1", "inspecting", resultsFixture()
	service.state["startedAt"], service.state["options"] = time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC), options
}

// TestACompleteRunIsReportedWithItsChapter: a run with rows reports the rows'
// chapter, the manifest this run wrote and the model it used.
func TestACompleteRunIsReportedWithItsChapter(t *testing.T) {
	service, session := testService(t)
	runs := recordedRuns(service)
	inspecting(service, map[string]string{"model": "medium"})
	row := fixtureRows()[0]
	service.Handle(append(compareMarkerEvent("run-1", row), "", "", "{TRACK}"))
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "1 discrepancy found.", "1", "0"})

	if len(*runs) != 1 {
		t.Fatalf("runs = %+v, want one", *runs)
	}
	run := (*runs)[0]
	if run.Outcome != RunComplete || run.ChapterTitle != row["chapter"] || run.Model != "medium" || run.FindingCount != 1 || run.TrackGUID != "{TRACK}" {
		t.Fatalf("run = %+v", run)
	}
	if run.ManifestPath != filepath.Join(session, "manifest_run-1.txt") || run.StartedAt.IsZero() || run.CompletedAt.IsZero() {
		t.Fatalf("run = %+v", run)
	}
}

// TestACleanRunKeepsItsChapterFromTheSummary is Q5's clean-run case: with no
// rows, the chapter survives only in compare.py's MATCH summary.
func TestACleanRunKeepsItsChapterFromTheSummary(t *testing.T) {
	service, _ := testService(t)
	runs := recordedRuns(service)
	inspecting(service, nil)
	service.Handle([]string{"COMPARE_INSPECTED", "run-1", "MATCH: 'Chapter 2: It's Late' (score 0.93) - 0 discrepancy marker(s)", "0", "0"})
	if len(*runs) != 1 || (*runs)[0].ChapterTitle != "Chapter 2: It's Late" || (*runs)[0].FindingCount != 0 {
		t.Fatalf("runs = %+v", *runs)
	}
}

// TestACleanCompleteRunMarksEarlierFindingsAbsent: a clean run is a full run of
// its chapter in the findings store, so what an earlier run raised is marked
// not_in_latest_run (rolled-up readers then resolve it only if the run covered
// it); an ambiguous or unknown title touches nothing.
func TestACleanCompleteRunMarksEarlierFindingsAbsent(t *testing.T) {
	for _, tc := range []struct {
		name       string
		lookup     *fakeLookup
		wantAbsent bool
	}{
		{"resolved title", &fakeLookup{chapterID: "chapter-1", chapterOK: true}, true},
		{"title of two chapters", &fakeLookup{chapterID: "chapter-1", chapterOK: true, chapterAmbiguous: true}, false},
		{"title of no chapter", &fakeLookup{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service, _ := testService(t)
			store := findings.NewStore(service.config.Project)
			service.SetFindings(store, &fakeLookup{chapterID: "chapter-1", chapterOK: true})
			inspecting(service, nil)
			service.Handle(compareMarkerEvent("run-1", fixtureRows()[0]))
			service.Handle([]string{"COMPARE_INSPECTED", "run-1", "1 discrepancy found.", "1", "0"})

			service.SetFindings(store, tc.lookup)
			inspecting(service, nil)
			service.Handle([]string{"COMPARE_INSPECTED", "run-1", "MATCH: 'Chapter One' (score 0.99) - 0 discrepancy marker(s)", "0", "0"})
			saved, err := store.List(findings.Query{IncludeNotInLatestRun: true})
			if err != nil || len(saved) != 1 {
				t.Fatalf("saved = %+v, %v", saved, err)
			}
			if saved[0].NotInLatestRun != tc.wantAbsent {
				t.Fatalf("NotInLatestRun = %v, want %v", saved[0].NotInLatestRun, tc.wantAbsent)
			}
		})
	}
}

// TestAFailedRunIsReportedAndACancelledOneIsNot: an error during a run reports
// a failed run with the narrator's chosen chapter; an error while exporting
// markers ends no run; a cancel reports nothing.
func TestAFailedRunIsReportedAndACancelledOneIsNot(t *testing.T) {
	service, _ := testService(t)
	runs := recordedRuns(service)
	inspecting(service, map[string]string{"chapterTitle": "Chapter One"})
	service.state["phase"] = "running"
	service.Handle([]string{"ERROR", "run-1", "The sidecar crashed."})
	if len(*runs) != 1 || (*runs)[0].Outcome != RunFailed || (*runs)[0].ChapterTitle != "Chapter One" {
		t.Fatalf("runs = %+v", *runs)
	}

	inspecting(service, nil)
	service.fail("The REAPER bridge is unavailable.")
	if len(*runs) != 2 || (*runs)[1].Outcome != RunFailed || (*runs)[1].ChapterTitle != "" {
		t.Fatalf("runs = %+v", *runs)
	}

	service.state["phase"] = "success"
	service.fail("Could not export markers.")
	service.state["phase"] = "cancelled"
	service.Handle([]string{"ERROR", "run-1", "late"})
	if len(*runs) != 2 {
		t.Fatalf("no run ended after the comparison finished: %+v", *runs)
	}
}

func TestRunChapterTitle(t *testing.T) {
	rows := []map[string]any{{"chapter": "One"}, {"chapter": "One"}}
	mixed := []map[string]any{{"chapter": "One"}, {"chapter": "Two"}}
	summary := "MATCH: 'From Summary' (score 0.50) - 2 discrepancy marker(s)"
	options := map[string]string{"chapterTitle": "Chosen"}
	cases := []struct {
		rows    []map[string]any
		summary string
		want    string
	}{
		{rows, summary, "One"},
		{mixed, summary, "From Summary"},
		{nil, summary, "From Summary"},
		{nil, "3 discrepancy(s) found.", "Chosen"},
	}
	for _, tc := range cases {
		if got := runChapterTitle(tc.rows, tc.summary, options); got != tc.want {
			t.Fatalf("runChapterTitle(%v, %q) = %q, want %q", tc.rows, tc.summary, got, tc.want)
		}
	}
}
