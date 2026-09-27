package production

import (
	"slices"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

func seconds(value float64) *float64 { return &value }

func chapter(id string, status stages.Stage, verdict stages.Verdict) ChapterInput {
	input := ChapterInput{ID: id, Title: "Chapter " + id, ContentKind: "narration", Status: status, WordCount: 3000}
	if verdict != "" {
		input.Readiness = &Readiness{Verdict: verdict}
	}
	return input
}

func nextUpIDs(overview Overview) []string {
	ids := make([]string, 0, len(overview.NextUp))
	for _, item := range overview.NextUp {
		ids = append(ids, item.ChapterID)
	}
	return ids
}

// The expected order of "Next up" on a fixture book (PRD success metric "Milestone risk", ADR 0400): a chapter held
// back by a known problem first, then the other chapters in progress with the least advanced first, then the ones
// ready to move on, then the ones not started in book order. Finalized chapters and non-narration content never show.
func TestNextUpOrdersChaptersByTheRiskTheyPutOnTheDeadline(t *testing.T) {
	credits := chapter("credits", stages.StageRecording, stages.VerdictNotReady)
	credits.ContentKind = "opening"
	legacy := chapter("legacy", stages.StageRecording, stages.VerdictNotReady)
	legacy.ContentKind = ""
	chapters := []ChapterInput{
		chapter("c1", stages.StageFinalized, stages.VerdictNone),
		chapter("c2", stages.StageProofing, stages.VerdictRecommended),
		chapter("c3", stages.StageProofing, stages.VerdictNotReady),
		chapter("c4", stages.StageEditing, stages.VerdictUnknown),
		chapter("c5", stages.StageRecording, stages.VerdictUnknown),
		chapter("c6", stages.StageRecording, stages.VerdictNotReady),
		chapter("c7", stages.StageNotStarted, ""),
		chapter("c8", stages.StageNotStarted, ""),
		credits,
		legacy,
	}
	got := nextUpIDs(BuildOverview(OverviewInput{Chapters: chapters, Now: nineAM}))
	want := []string{"c6", "legacy", "c3", "c5", "c4"}
	if !slices.Equal(got, want) {
		t.Fatalf("next up = %v, want %v", got, want)
	}
}

func TestNextUpFillsWithChaptersNotStartedInBookOrder(t *testing.T) {
	chapters := []ChapterInput{
		chapter("c1", stages.StageNotStarted, ""),
		chapter("c2", stages.StageRecording, stages.VerdictDismissed),
		chapter("c3", stages.StageNotStarted, ""),
	}
	got := nextUpIDs(BuildOverview(OverviewInput{Chapters: chapters, Now: nineAM}))
	if want := []string{"c2", "c1", "c3"}; !slices.Equal(got, want) {
		t.Fatalf("next up = %v, want %v", got, want)
	}
}

func TestNextUpHoldsAtMostFiveChapters(t *testing.T) {
	var chapters []ChapterInput
	for _, id := range []string{"c1", "c2", "c3", "c4", "c5", "c6", "c7"} {
		chapters = append(chapters, chapter(id, stages.StageNotStarted, ""))
	}
	if got := BuildOverview(OverviewInput{Chapters: chapters, Now: nineAM}).NextUp; len(got) != nextUpLimit {
		t.Fatalf("next up holds %d, want %d", len(got), nextUpLimit)
	}
}

func TestNextUpIsEmptyWhenEveryChapterIsFinalized(t *testing.T) {
	overview := BuildOverview(OverviewInput{Chapters: []ChapterInput{chapter("c1", stages.StageFinalized, stages.VerdictNone)}, Now: nineAM})
	if overview.NextUp == nil || len(overview.NextUp) != 0 {
		t.Fatalf("next up = %#v, want an empty list (never null on the wire)", overview.NextUp)
	}
}

// PFH and the rate on the overview are exactly Phase 2's, measured only: an unmeasured chapter has no PFH and adds
// nothing to the recorded total, and a book with no contracted amount has no rate (Q4 A, ADR 0320).
func TestTheOverviewsFiguresComeOnlyFromLoggedHoursAndMeasuredTime(t *testing.T) {
	measured := chapter("c1", stages.StageEditing, stages.VerdictUnknown)
	measured.RecordedSeconds = seconds(1800)
	unmeasured := chapter("c2", stages.StageRecording, stages.VerdictUnknown)
	unmeasured.RecordedUnavailable = "unlinked"
	sessions := []Session{
		logged("c1", stages.StageRecording, 2*time.Hour),
		logged("c1", stages.StageEditing, time.Hour),
		logged("c2", stages.StageRecording, time.Hour),
		running("c2"),
	}
	overview := BuildOverview(OverviewInput{Chapters: []ChapterInput{measured, unmeasured}, Sessions: sessions, Now: nineAM})

	if got := overview.Chapters[0]; got.PFH == nil || !near(*got.PFH, 6) || !near(got.HoursLogged, 3) {
		t.Fatalf("measured chapter = %+v, want PFH 6 over 3 hours", got)
	}
	if got := overview.Chapters[1]; got.PFH != nil || got.RecordedSeconds != nil || got.RecordedUnavailable != "unlinked" || !near(got.HoursLogged, 1) {
		t.Fatalf("unmeasured chapter = %+v, want no PFH and its reason kept", got)
	}
	totals := overview.Totals
	if !near(totals.RecordedSeconds, 1800) || totals.MeasuredChapters != 1 || !near(totals.HoursLogged, 4) {
		t.Fatalf("totals = %+v", totals)
	}
	if totals.BookPFH == nil || !near(*totals.BookPFH, 8) {
		t.Fatalf("book PFH = %v, want 4 hours over half an hour = 8", totals.BookPFH)
	}
	if totals.EffectiveRate != nil || totals.ContractedAmount != nil {
		t.Fatalf("rate = %v, amount = %v, want both undefined with no contracted amount", totals.EffectiveRate, totals.ContractedAmount)
	}
	if overview.Running == nil || overview.Running.ChapterID != "c2" {
		t.Fatalf("running = %+v, want c2's timer", overview.Running)
	}
}

func TestTheRateUsesTheContractedAmountFromThePlan(t *testing.T) {
	amount := 900.0
	overview := BuildOverview(OverviewInput{
		Chapters: []ChapterInput{chapter("c1", stages.StageRecording, stages.VerdictUnknown)},
		Sessions: []Session{logged("c1", stages.StageRecording, 3*time.Hour)},
		Plan:     Plan{ContractedAmount: &amount},
		Now:      nineAM,
	})
	if got := overview.Totals.EffectiveRate; got == nil || !near(*got, 300) {
		t.Fatalf("rate = %v, want 300", got)
	}
}

// Days left count whole calendar days from today to the due date, so the figure does not change during the day; an
// overdue deadline is negative, never hidden.
func TestTheDeadlineSaysHowManyDaysAreLeft(t *testing.T) {
	due := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		now  time.Time
		want int
	}{
		{time.Date(2026, 9, 26, 23, 59, 0, 0, time.UTC), 18},
		{time.Date(2026, 10, 14, 8, 0, 0, 0, time.UTC), 0},
		{time.Date(2026, 10, 16, 8, 0, 0, 0, time.UTC), -2},
	} {
		overview := BuildOverview(OverviewInput{Plan: Plan{Deadline: &due}, Now: test.now})
		if overview.Deadline == nil || overview.Deadline.Date != "2026-10-14" || overview.Deadline.DaysLeft != test.want {
			t.Fatalf("at %v deadline = %+v, want %d days left", test.now, overview.Deadline, test.want)
		}
	}
	if overview := BuildOverview(OverviewInput{Now: nineAM}); overview.Deadline != nil {
		t.Fatalf("deadline = %+v, want none before one is set (Phase 3)", overview.Deadline)
	}
}

// The overview never writes a chapter status: it only reads the stage recommendations' verdict (PRD success metric
// "Board never invents a status").
func TestTheOverviewKeepsEachChaptersStatusAndReadinessAsGiven(t *testing.T) {
	input := chapter("c1", stages.StageProofing, stages.VerdictNotReady)
	input.Readiness.Target = stages.StageFinalized
	input.Readiness.Reason = "2 pickups are still open"
	got := BuildOverview(OverviewInput{Chapters: []ChapterInput{input}, Now: nineAM}).Chapters[0]
	if got.Status != stages.StageProofing || got.Readiness == nil || *got.Readiness != *input.Readiness {
		t.Fatalf("chapter = %+v, readiness = %+v", got, got.Readiness)
	}
}

// ProductionOverview's payload on a small fixture book (ADR 0069): the UI's schema and mock are checked against it.
func TestContractProductionOverview(t *testing.T) {
	amount := 2400.0
	due := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	first := chapter("c-0001", stages.StageEditing, stages.VerdictNotReady)
	first.Title = "Chapter 1"
	first.Subtitle = "Down the Rabbit-Hole"
	first.RecordedSeconds = seconds(708)
	first.Readiness.Target = stages.StageProofing
	first.Readiness.Reason = "3 clicks are still in the take"
	second := chapter("c-0002", stages.StageRecording, stages.VerdictUnknown)
	second.Title = "The Pool of Tears"
	second.RecordedUnavailable = "unlinked"
	second.Readiness.Target = stages.StageEditing
	second.Readiness.Reason = "No recording check has run yet"
	third := chapter("c-0003", stages.StageNotStarted, stages.VerdictNone)
	third.Title = "A Caucus-Race and a Long Tale"
	overview := BuildOverview(OverviewInput{
		Chapters: []ChapterInput{first, second, third},
		Sessions: []Session{
			logged("c-0001", stages.StageRecording, 90*time.Minute),
			logged("c-0001", stages.StageEditing, 45*time.Minute),
			running("c-0002"),
		},
		Plan: Plan{Deadline: &due, ContractedAmount: &amount},
		Now:  time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC),
	})
	stable, err := contractfile.Stabilize(overview)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "production-overview", stable)
	empty, err := contractfile.Stabilize(BuildOverview(OverviewInput{Now: nineAM}))
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "production-overview-empty", empty)
}
