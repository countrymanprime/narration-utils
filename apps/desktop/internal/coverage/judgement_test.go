package coverage

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The dialog's pass or fail (ResultView.Judgement, recording-check-summary PRD
// Phase 2, ADR 0204) is the stage signal's, by construction and by test.
func TestTheViewSJudgementIsTheStageSignalS(t *testing.T) {
	for name, report := range map[string]Report{"all read": allRead, "scattered drops": scatteredDrops, "skipped block": skippedBlock, "thin paragraph": thinParagraph} {
		t.Run(name, func(t *testing.T) {
			result := currentWith(report)
			signal := RecordingSignal(input(result))
			view := result.View(testChapter, DefaultThresholds)
			if view.Judgement == nil {
				t.Fatal("a current result has no judgement")
			}
			if view.Judgement.State != signal.State || view.Judgement.Reason != signal.Reason {
				t.Fatalf("judgement %+v, signal %s %q", view.Judgement, signal.State, signal.Reason)
			}
			if view.Judgement.Thresholds.MinParagraphPresent != DefaultThresholds.MinParagraphPresent || view.Judgement.Thresholds.MaxMissingRun != DefaultThresholds.MaxMissingRun {
				t.Fatalf("thresholds = %+v", view.Judgement.Thresholds)
			}
		})
	}
}

func TestJudgeNamesWhatFailsFirst(t *testing.T) {
	if got := Judge(allRead, DefaultThresholds); got.State != stages.SignalMet || got.Reason != "Text present: 100 of 100 words; every paragraph passes." {
		t.Fatalf("all read = %+v", got)
	}
	if got := Judge(skippedBlock, DefaultThresholds); got.State != stages.SignalNotMet || got.Reason != "paragraph 2: 14 words not read." {
		t.Fatalf("skipped block = %+v", got)
	}
	if got := Judge(thinParagraph, Thresholds{MinParagraphPresent: 0.5, MaxMissingRun: 3}); got.State != stages.SignalMet {
		t.Fatalf("looser thresholds = %+v", got)
	}
}

func TestAStaleResultKeepsItsJudgementFromTheLastCheck(t *testing.T) {
	view := stale(string(evidence.ReasonItemTrimmed)).View(testChapter, DefaultThresholds)
	if view.Judgement == nil || view.Judgement.State != stages.SignalMet {
		t.Fatalf("stale view judgement = %+v", view.Judgement)
	}
}

func TestNoJudgementWithoutACompleteReport(t *testing.T) {
	if view := never().View(testChapter, DefaultThresholds); view.Judgement != nil {
		t.Fatalf("never = %+v", view.Judgement)
	}
	partial := currentWith(allRead)
	partial.Record.Outcome = evidence.LedgerPartial
	if view := partial.View(testChapter, DefaultThresholds); view.Judgement != nil {
		t.Fatalf("partial = %+v", view.Judgement)
	}
	if view := currentWith(allRead).View(testChapter, Thresholds{MinParagraphPresent: 2, MaxMissingRun: 3}); view.Judgement != nil {
		t.Fatalf("invalid thresholds = %+v", view.Judgement)
	}
}
