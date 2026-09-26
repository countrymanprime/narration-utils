// Package levelnormalize computes the gain a REAPER item needs to bring a measured level onto the narrator's own
// target, within their tolerance (diagnostics-delivery-and-cleanup-tools PRD Phase 11's level-normalize half, ADR
// 0252). It never measures anything itself (that is internal/measure's AnalyzeRange, already used by
// internal/measure/takemetrics.go over one item's range) and it never touches REAPER: it only turns a measured value
// and a target into a gain decision, the same "measure first, decide, then one caller applies it" shape
// internal/deliveryprofile.Evaluate uses for delivery limits.
package levelnormalize

import "math"

// Metric selects which of measure.Report's loudness fields a target is judged against.
type Metric string

const (
	MetricIntegratedLUFS Metric = "integrated_lufs"
	MetricRMS            Metric = "rms_dbfs"
)

// Target is the narrator's own level and how far a measured value may drift from it before a gain change is
// proposed (min <= max is not required here: ToleranceDB is a distance, always >= 0, unlike Profile's paired
// bounds - there is one level to match, not a range to stay inside).
type Target struct {
	Metric      Metric
	ValueDB     float64
	ToleranceDB float64
}

// GainDeltaDB says how many dB to add to an item's current volume to bring measured onto target.Value: deltaDB is
// meaningful only when ok is true. needsChange is false when measured is already within target.ToleranceDB of
// target.ValueDB (deltaDB is then 0, not a tiny nonzero nudge). ok is false only when measured has no usable value
// (silence, or too short to measure) - never fabricated as 0 dB or "no change needed".
func GainDeltaDB(measured *float64, target Target) (deltaDB float64, needsChange bool, ok bool) {
	if measured == nil || math.IsNaN(*measured) || math.IsInf(*measured, 0) {
		return 0, false, false
	}
	diff := target.ValueDB - *measured
	if math.Abs(diff) <= target.ToleranceDB {
		return 0, false, true
	}
	return diff, true, true
}
