package productionreport

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/production"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The golden files are written by this test, never by hand: run it with UPDATE_GOLDEN=1 after an intended change and
// read the diff.

func number(v float64) *float64 { return &v }

func sampleOverview() production.Overview {
	return production.Overview{
		Chapters: []production.OverviewChapter{
			{ID: "ch-1", Title: "Down the Rabbit-Hole", Status: stages.StageFinalized, WordCount: 3200, RecordedSeconds: number(708), HoursLogged: 3,
				PFH: number(1.5), Readiness: &production.Readiness{Verdict: stages.VerdictRecommended}},
			{ID: "ch-2", Title: "The Pool of Tears", Status: stages.StageEditing, WordCount: 2800, RecordedSeconds: number(512), HoursLogged: 1,
				Readiness: &production.Readiness{Verdict: stages.VerdictNotReady, Reason: "2 pickups open"}},
			{ID: "ch-3", Title: "A Caucus-Race and a Long Tale", Status: stages.StageNotStarted, WordCount: 2600, HoursLogged: 0},
		},
		Totals: production.Totals{
			Chapters: 3, FinalizedChapters: 1, WordCount: 8600, RecordedSeconds: 1220, MeasuredChapters: 2, HoursLogged: 4,
			HoursByStage: map[stages.Stage]float64{stages.StageRecording: 2, stages.StageEditing: 1.5, stages.StageProofing: 0.5},
			BookPFH:      number(1.97), ContractedAmount: number(2400), EffectiveRate: number(600),
		},
		Deadline: &production.Deadline{Date: "2026-12-01", DaysLeft: 30},
	}
}

func sampleInput() Input {
	return Input{
		GeneratedAt: "2026-09-27T18:00:00Z", AppVersion: "0.9.0",
		Overview: sampleOverview(),
		Milestones: []project.Milestone{
			{Name: "ACX 15-minute checkpoint", DueDate: "2026-10-15", Note: "The rights holder approves the first 15 minutes."},
			{Name: "Final delivery", DueDate: "2026-09-01"},
		},
		Now: time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC),
	}
}

func render(t *testing.T, in Input) (string, string) {
	t.Helper()
	report := Build(in)
	encoded, err := report.JSON()
	if err != nil {
		t.Fatal(err)
	}
	page, err := report.HTML()
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded), string(page)
}

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v (run with UPDATE_GOLDEN=1 to write it)", path, err)
	}
	if !bytes.Equal(bytes.ReplaceAll(want, []byte("\r\n"), []byte("\n")), []byte(got)) {
		t.Fatalf("%s differs from what the report writes now; run with UPDATE_GOLDEN=1 if the change is intended", path)
	}
}

func TestTheReportMatchesItsGoldenFiles(t *testing.T) {
	encoded, page := render(t, sampleInput())
	golden(t, "report.golden.json", encoded)
	golden(t, "report.golden.html", page)
}

func TestTheSameInputGivesTheSameBytesApartFromTheTimestamp(t *testing.T) {
	first, firstPage := render(t, sampleInput())
	again, againPage := render(t, sampleInput())
	if first != again || firstPage != againPage {
		t.Fatal("two reports of the same input differ")
	}
}

func TestTheContractedAmountAndRateAreLeftOutUnlessTheNarratorOptsIn(t *testing.T) {
	report := Build(sampleInput())
	if report.Rate.ContractedAmount != nil || report.Rate.EffectiveRate != nil {
		t.Fatal("the contracted amount and rate should be left out by default")
	}
	if report.Privacy.ContractedAmountIncluded {
		t.Fatal("Privacy.ContractedAmountIncluded should be false by default")
	}
	encoded, page := render(t, sampleInput())
	if bytes.Contains([]byte(encoded), []byte("2400")) || bytes.Contains([]byte(page), []byte("2400")) {
		t.Fatal("the contracted amount should not appear anywhere in the report by default")
	}

	in := sampleInput()
	in.Options.IncludeContractedAmount = true
	optedIn := Build(in)
	if optedIn.Rate.ContractedAmount == nil || *optedIn.Rate.ContractedAmount != 2400 {
		t.Fatal("opting in should include the contracted amount")
	}
	if optedIn.Rate.EffectiveRate == nil || *optedIn.Rate.EffectiveRate != 600 {
		t.Fatal("opting in should include the effective rate")
	}
	if !optedIn.Privacy.ContractedAmountIncluded {
		t.Fatal("Privacy.ContractedAmountIncluded should be true once opted in")
	}
}

func TestAnUndefinedBookPFHIsWrittenAsAbsentNeverZero(t *testing.T) {
	in := sampleInput()
	in.Overview.Totals.BookPFH = nil
	report := Build(in)
	if report.Book.BookPFH != nil {
		t.Fatal("an undefined BookPFH should stay nil, never 0")
	}
	_, page := render(t, in)
	if !bytes.Contains([]byte(page), []byte("not available")) {
		t.Fatal("the HTML page should say the PFH is not available, never write 0")
	}
}

func TestAMilestonePastItsDateIsOverdue(t *testing.T) {
	report := Build(sampleInput())
	if len(report.Milestones) != 2 {
		t.Fatalf("expected 2 milestones, got %d", len(report.Milestones))
	}
	if report.Milestones[0].Overdue {
		t.Fatal("the ACX checkpoint (2026-10-15) should not be overdue as of 2026-09-27")
	}
	if !report.Milestones[1].Overdue {
		t.Fatal("final delivery (2026-09-01) should be overdue as of 2026-09-27")
	}
}

func TestReadinessCountsEveryChapterByItsVerdictAndNoneWhenNotAssessed(t *testing.T) {
	report := Build(sampleInput())
	if report.Readiness.Recommended != 1 || report.Readiness.NotReady != 1 || report.Readiness.None != 1 {
		t.Fatalf("unexpected readiness counts: %+v", report.Readiness)
	}
}
