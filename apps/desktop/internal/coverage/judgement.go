package coverage

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// Judgement is a stored report judged by the narrator's thresholds: met or
// not met, and why (recording-check-summary PRD Phase 2, ADR 0204). The
// recording check dialog shows it as its headline and the stage signal is
// built from it (measuredSignal), so the two can never disagree. Thresholds
// are the ones it was judged by, so the dialog can say so.
type Judgement struct {
	State      stages.SignalState `json:"state"`
	Reason     string             `json:"reason"`
	Thresholds ThresholdsView     `json:"thresholds"`
}

// ThresholdsView is Thresholds on the wire.
type ThresholdsView struct {
	MinParagraphPresent float64 `json:"minParagraphPresent"`
	MaxMissingRun       int     `json:"maxMissingRun"`
}

// Judge applies thresholds to report: met when the text is complete
// (Report.TextComplete), otherwise not met with the gap that fails first
// (largestGap). It is the one rule both the dialog and the stage engine use.
func Judge(report Report, thresholds Thresholds) Judgement {
	judgement := Judgement{Thresholds: ThresholdsView(thresholds)}
	if report.TextComplete(thresholds) {
		judgement.State = stages.SignalMet
		judgement.Reason = fmt.Sprintf("Text present: %d of %s; every paragraph passes.", report.Summary.PresentTokens, words(report.Summary.BodyTokens))
		return judgement
	}
	judgement.State = stages.SignalNotMet
	judgement.Reason = largestGap(report, thresholds)
	return judgement
}
