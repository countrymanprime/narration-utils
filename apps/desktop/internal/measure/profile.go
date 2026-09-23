package measure

import (
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

const analyzerName = "measure"

// Limit is an inclusive bound on one measurement. A nil bound is unbounded,
// and a Limit with neither bound means the metric is not checked.
type Limit struct {
	Min *float64
	Max *float64
}

func (l Limit) set() bool { return l.Min != nil || l.Max != nil }

// Profile is a named set of limits a report is judged against. The package
// ships no distributor profile: one belongs here only after its rules have
// been independently specified and validated, per the product roadmap.
type Profile struct {
	Name           string
	IntegratedLUFS Limit
	RMSdBFS        Limit
	TruePeakdBTP   Limit
	NoiseFloordBFS Limit
}

// metricCheck pairs a report value with the profile limit that governs it.
type metricCheck struct {
	name  string
	value *float64
	limit Limit
}

// Evaluate turns a report into findings: one delivery_qc error for every
// limited metric that is out of range, and one info finding for every
// limited metric that could not be measured, so a missing measurement is
// never mistaken for a pass. Metrics without a limit produce nothing.
func Evaluate(report Report, profile Profile) []findings.Finding {
	checks := []metricCheck{
		{"integrated_lufs", report.IntegratedLUFS, profile.IntegratedLUFS},
		{"rms_dbfs", report.RMSdBFS, profile.RMSdBFS},
		{"true_peak_dbtp", report.TruePeakdBTP, profile.TruePeakdBTP},
		{"noise_floor_dbfs", report.NoiseFloordBFS, profile.NoiseFloordBFS},
	}

	var out []findings.Finding
	for _, check := range checks {
		if !check.limit.set() {
			continue
		}
		if check.value == nil || math.IsNaN(*check.value) || math.IsInf(*check.value, 0) {
			out = append(out, unavailableFinding(report, profile, check))
			continue
		}
		if violation := violationOf(*check.value, check.limit); violation != "" {
			out = append(out, violationFinding(report, profile, check, violation))
		}
	}
	return out
}

func violationOf(value float64, limit Limit) string {
	switch {
	case limit.Max != nil && value > *limit.Max:
		return "above_max"
	case limit.Min != nil && value < *limit.Min:
		return "below_min"
	}
	return ""
}

func violationFinding(report Report, profile Profile, check metricCheck, violation string) findings.Finding {
	evidence := baseEvidence(profile, check)
	evidence["value"] = *check.value
	evidence["violation"] = violation
	if check.limit.Min != nil {
		evidence["limit_min"] = *check.limit.Min
	}
	if check.limit.Max != nil {
		evidence["limit_max"] = *check.limit.Max
	}
	return newFinding(report, profile, check, "out_of_range", findings.SeverityError,
		"deterministic measurement of the decoded samples", evidence)
}

func unavailableFinding(report Report, profile Profile, check metricCheck) findings.Finding {
	evidence := baseEvidence(profile, check)
	evidence["available"] = false
	return newFinding(report, profile, check, "unavailable", findings.SeverityInfo,
		"the measurement could not be made (silence, or audio shorter than the measurement window)", evidence)
}

func baseEvidence(profile Profile, check metricCheck) map[string]any {
	return map[string]any{"metric": check.name, "profile": profile.Name}
}

func newFinding(report Report, profile Profile, check metricCheck, kind string, severity findings.Severity, reason string, evidence map[string]any) findings.Finding {
	confidence := 1.0
	return findings.Finding{
		SchemaVersion:    findings.SchemaVersion,
		ID:               findings.StableID(analyzerName, report.File, profile.Name, check.name, kind),
		Analyzer:         analyzerName,
		Source:           findings.Source{File: report.File},
		Category:         findings.CategoryDeliveryQC,
		Severity:         severity,
		Confidence:       &confidence,
		ConfidenceReason: reason,
		Evidence:         evidence,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}
