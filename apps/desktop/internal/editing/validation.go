// This file is Phase 4 of docs/prds/editing-readiness-analysis.prd.md ("Click
// and breath validation"): the detector versions the click and breath
// records are stamped with, the recorded held-out runs of those versions, the
// gate that lets a class signal say met only for a version with a qualifying
// run (Q5), the per-class signal itself, and the scan defaults the tuning half
// chose. The runs are produced by validationrun_test.go, which also fails if a
// recorded number stops matching what the detector does now, so no number
// here stands without the run behind it. The method and the numbers are in
// docs/research/editing-click-breath-validation.md.
package editing

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// ClickAnalyzerVersion and BreathAnalyzerVersion identify the click and breath
// detectors as this package runs them: measure/cleanup.go's heuristics (DX
// Phase 9 owns them) under DefaultScanOptions. Either changing - the heuristic
// or the default - is a new version, recorded with its own run; the ledger
// records and cache entries of the old one then read stale.
const (
	ClickAnalyzerVersion  = "editing-click-v1"
	BreathAnalyzerVersion = "editing-breath-v1"
)

// RecallTarget is the Success Metrics' proposed recall per class (an
// assumption to calibrate, not a measured fact). A detector version is
// validated only when its held-out recall reaches it overall and in every
// recording condition of the run.
const RecallTarget = 0.9

// DefaultScanOptions are the scan parameters the Phase 4 tuning half chose:
// DX's own silence and cleanup defaults, except BreathBelowSpeechDB, lowered
// from 12 to 8 dB because the tuning half's loud breaths (8 to 12 dB under
// the speech peak) were missed at 12 and precision did not fall at 8. Clicks
// keep ClickAboveSilenceDB 30: from 20 to 30 dB nothing changed, and 40 only
// dropped plosive false positives at the same recall, which the selection
// rule never trades for sensitivity (a precision gain measured on synthetic
// audio is no reason to raise fewer candidates on real audio). Provisional
// (D70): chosen on synthetic audio.
func DefaultScanOptions() ScanOptions {
	cleanup := measure.DefaultCleanupOptions()
	cleanup.BreathBelowSpeechDB = 8
	return ScanOptions{Silence: measure.DefaultDiagnosticOptions(), Cleanup: cleanup}
}

// CorpusKind is what a validation run was scored on. Only a permissioned
// narrator corpus can validate a detector; synthetic audio is a regression
// guard (Q10: "Synthetic breaths and clicks are not a validation").
type CorpusKind string

const (
	CorpusSynthetic    CorpusKind = "synthetic"
	CorpusPermissioned CorpusKind = "permissioned"
)

// ConditionResult is one recording condition's held-out tally for one class:
// labeled locations found, labeled locations, and candidates raised.
type ConditionResult struct {
	Condition     string
	TruePositives int
	Labels        int
	Candidates    int
}

// Recall is TruePositives over Labels (0 with no labels).
func (r ConditionResult) Recall() float64 {
	if r.Labels == 0 {
		return 0
	}
	return float64(r.TruePositives) / float64(r.Labels)
}

// DetectorValidation is one recorded held-out run of one class detector
// version.
type DetectorValidation struct {
	AnalyzerID      string
	AnalyzerVersion string
	Corpus          CorpusKind
	RunDate         string
	HeldOut         []ConditionResult
}

// Total sums the held-out conditions.
func (v DetectorValidation) Total() ConditionResult {
	total := ConditionResult{Condition: "all"}
	for _, r := range v.HeldOut {
		total.TruePositives += r.TruePositives
		total.Labels += r.Labels
		total.Candidates += r.Candidates
	}
	return total
}

// Validated reports whether this run opens the gate: a permissioned corpus,
// and recall at RecallTarget overall and in every condition.
func (v DetectorValidation) Validated() bool {
	if v.Corpus != CorpusPermissioned || len(v.HeldOut) == 0 || v.Total().Recall() < RecallTarget {
		return false
	}
	for _, r := range v.HeldOut {
		if r.Recall() < RecallTarget {
			return false
		}
	}
	return true
}

// recordedValidations are the Phase 4 runs, held-out half, 2026-09-28, on the
// synthetic validation corpus (validationcorpus_test.go; no permissioned
// corpus is on main). Clicks reach 38% held-out recall (mouth clicks next to a
// word and clicks in room tone above the silence floor are missed); breaths
// reach 84% (breaths under the absolute silence floor in a quiet read are
// missed). Neither reaches RecallTarget even here, and a synthetic run could
// not validate anyway, so both ship gated off.
var recordedValidations = []DetectorValidation{
	{
		AnalyzerID: AnalyzerClick, AnalyzerVersion: ClickAnalyzerVersion, Corpus: CorpusSynthetic, RunDate: "2026-09-28",
		HeldOut: []ConditionResult{
			{Condition: "studio", TruePositives: 4, Labels: 8, Candidates: 8},
			{Condition: "room_tone", TruePositives: 4, Labels: 8, Candidates: 8},
			{Condition: "noisy_room", TruePositives: 0, Labels: 8, Candidates: 0},
			{Condition: "quiet_read", TruePositives: 4, Labels: 8, Candidates: 8},
		},
	},
	{
		AnalyzerID: AnalyzerBreath, AnalyzerVersion: BreathAnalyzerVersion, Corpus: CorpusSynthetic, RunDate: "2026-09-28",
		HeldOut: []ConditionResult{
			{Condition: "studio", TruePositives: 8, Labels: 8, Candidates: 16},
			{Condition: "room_tone", TruePositives: 8, Labels: 8, Candidates: 15},
			{Condition: "noisy_room", TruePositives: 8, Labels: 8, Candidates: 23},
			{Condition: "quiet_read", TruePositives: 3, Labels: 8, Candidates: 5},
		},
	},
}

// DetectorValidations returns a copy of the recorded runs.
func DetectorValidations() []DetectorValidation {
	out := make([]DetectorValidation, len(recordedValidations))
	for i, v := range recordedValidations {
		v.HeldOut = append([]ConditionResult(nil), v.HeldOut...)
		out[i] = v
	}
	return out
}

// IsValidated reports whether validations hold a qualifying run for exactly
// this analyzer and version (Q5): any other version, of either class, is not.
func IsValidated(validations []DetectorValidation, analyzerID, analyzerVersion string) bool {
	for _, v := range validations {
		if v.AnalyzerID == analyzerID && v.AnalyzerVersion == analyzerVersion && v.Validated() {
			return true
		}
	}
	return false
}

// ClassSignalInput is everything ClassSignal reads for the click or the
// breath signal. Coverage is each item's staleness against the class's own
// ledger record; Candidates are the class's persisted findings.
type ClassSignalInput struct {
	ID              string
	AnalyzerID      string
	AnalyzerVersion string
	Validations     []DetectorValidation
	Coverage        ChapterCoverage
	Candidates      []CandidateStatus
	Running         bool
	Basis           stages.Basis
	ComputedAt      time.Time
}

// ClassSignal is the click or breath signal. The validated-version gate comes
// first: an unvalidated version is unknown whatever the scan found, and still
// lists its open candidates as evidence. A validated version follows the
// empty-space rule without its policy: met only when mapped, every item
// current and no candidate open; not_met with an open candidate; unknown
// otherwise.
func ClassSignal(in ClassSignalInput) stages.Signal {
	signal := stages.Signal{
		ID: in.ID, Stage: stages.StageEditing, Evidence: []stages.Evidence{processedAudioCaveat(), itemsSourceEvidence()},
		Basis: in.Basis, ComputedAt: in.ComputedAt,
	}
	open := 0
	for _, candidate := range in.Candidates {
		if candidate.Open {
			open++
			signal.Evidence = append(signal.Evidence, candidate.Evidence)
		}
	}
	noun := classNoun(in.AnalyzerID)
	if !IsValidated(in.Validations, in.AnalyzerID, in.AnalyzerVersion) {
		signal.Evidence = append(signal.Evidence, stages.Evidence{
			Kind: "validation", Label: "Detector", Value: validationSummary(in.Validations, in.AnalyzerID, in.AnalyzerVersion),
		})
		return unknownEditingSignal(signal, stages.CauseMeasurementUnavailable, fmt.Sprintf(
			"The %s detector is not validated yet on a labeled narrator recording, so it can list candidates but never say this chapter is done.", noun))
	}
	if cause, reason, ok := mappingCause(in.Coverage, in.Coverage.Unconfirmed); ok {
		return unknownEditingSignal(signal, cause, reason)
	}
	if in.Running {
		return unknownEditingSignal(signal, stages.CauseAnalysisRunning, "An editing check of this chapter is running.")
	}
	if len(in.Coverage.UnsupportedReasons) > 0 {
		return unknownEditingSignal(signal, stages.CauseMeasurementUnavailable, unsupportedReason(in.Coverage.UnsupportedReasons))
	}
	if !in.Coverage.HasAnalyzableItems {
		return unknownEditingSignal(signal, stages.CauseNeverAnalyzed, "There is no analyzable audio on this chapter's track yet.")
	}
	if cause, reason, ok := itemCoverageCause(in.Coverage.Items); ok {
		return unknownEditingSignal(signal, cause, reason)
	}
	if open > 0 {
		signal.State, signal.Reason = stages.SignalNotMet, fmt.Sprintf("%d %s candidate(s) remain open.", open, noun)
		return signal
	}
	signal.State, signal.Reason = stages.SignalMet, fmt.Sprintf("No open %s candidates; every played item was checked at its current state.", noun)
	return signal
}

func classNoun(analyzerID string) string {
	if analyzerID == AnalyzerBreath {
		return "breath"
	}
	return "click"
}

// validationSummary says what run, if any, is recorded for this version.
func validationSummary(validations []DetectorValidation, analyzerID, analyzerVersion string) string {
	for _, v := range validations {
		if v.AnalyzerID != analyzerID || v.AnalyzerVersion != analyzerVersion {
			continue
		}
		total := v.Total()
		return fmt.Sprintf("%s: held-out recall %.0f%% (%d of %d) on a %s corpus, %s; validation needs %.0f%% in every condition on a narrator corpus.",
			analyzerVersion, 100*total.Recall(), total.TruePositives, total.Labels, v.Corpus, v.RunDate, 100*RecallTarget)
	}
	return analyzerVersion + ": no validation run is recorded for this version."
}
