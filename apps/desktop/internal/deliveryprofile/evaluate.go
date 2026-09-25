package deliveryprofile

import (
	"math"
	"slices"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// analyzerName is the analyzer the delivery findings are raised under: the measurement's, as before profiles.
const analyzerName = "measure"

// Status is how one rule stands for one file (or for the book).
type Status string

const (
	StatusMet           Status = "met"
	StatusNotMet        Status = "not_met"
	StatusNotMeasurable Status = "not_measurable"
	StatusNotChecked    Status = "not_checked"
	StatusOff           Status = "off"
)

// The ways a value misses a rule.
const (
	ViolationAboveMax = "above_max"
	ViolationBelowMin = "below_min"
	ViolationNotOneOf = "not_one_of"
	ViolationDiffers  = "differs_across_files"
)

// Result is one rule's result. Value is what was measured (nil when nothing was); Violation says how a not_met value
// missed; Why says why a rule was not measurable or not checked; Advice is the rule's softer check when it fired.
type Result struct {
	RuleID    string   `json:"ruleId"`
	Status    Status   `json:"status"`
	Value     *float64 `json:"value"`
	Violation string   `json:"violation,omitempty"`
	Why       string   `json:"why,omitempty"`
	Advice    string   `json:"advice,omitempty"`
}

// Judgement is one file's results, one per file rule in the profile's order, and the delivery_qc findings they raise.
type Judgement struct {
	Results  []Result
	Findings []findings.Finding
}

// metricValue reads a file metric from a report. known is false for a metric the report does not hold (the MP3
// container): such a rule is not checked, whatever its CheckedBy says.
func metricValue(report measure.Report, metric string) (value *float64, known bool) {
	switch metric {
	case "integrated_lufs":
		return report.IntegratedLUFS, true
	case "rms_dbfs":
		return report.RMSdBFS, true
	case "sample_peak_dbfs":
		return report.SamplePeakdBFS, true
	case "true_peak_dbtp":
		return report.TruePeakdBTP, true
	case "noise_floor_dbfs":
		return report.NoiseFloordBFS, true
	case "duration_seconds":
		return number(report.DurationSeconds), true
	case "sample_rate":
		return number(float64(report.SampleRate)), true
	case "channels":
		return number(float64(report.Channels)), true
	case "head_room_tone_seconds":
		return report.HeadRoomToneSeconds, true
	case "tail_room_tone_seconds":
		return report.TailRoomToneSeconds, true
	case "head_digital_silence_seconds":
		return report.HeadDigitalSilenceSeconds, true
	case "tail_digital_silence_seconds":
		return report.TailDigitalSilenceSeconds, true
	}
	return nil, false
}

// finite reports whether v holds a usable number.
func finite(v *float64) bool {
	return v != nil && !math.IsNaN(*v) && !math.IsInf(*v, 0)
}

// violationOf says how value misses the rule's bound, or "" when it meets it. Bounds are inclusive.
func violationOf(rule Rule, value float64) string {
	switch {
	case len(rule.OneOf) > 0 && !slices.Contains(rule.OneOf, value):
		return ViolationNotOneOf
	case rule.Max != nil && value > *rule.Max:
		return ViolationAboveMax
	case rule.Min != nil && value < *rule.Min:
		return ViolationBelowMin
	}
	return ""
}

// notCheckedWhy is what a rule the app does not judge says.
func notCheckedWhy(rule Rule) string {
	if rule.NotCheckedWhy != "" {
		return rule.NotCheckedWhy
	}
	if rule.CheckedBy == CheckedListen {
		return "Listen: the app does not judge this."
	}
	return "Not checked by the app yet."
}

// EvaluateFile judges one measured file against every file rule of the profile. A rule that is off, one the app cannot
// check, and one whose value could not be measured each get their own status; only a measured value inside its bound is
// met. Findings: an error for a required rule not met (a warning for advice), an info finding for a value that could not
// be measured, and a warning for a rule's advice.
func EvaluateFile(report measure.Report, profile Profile) Judgement {
	judgement := Judgement{Results: []Result{}, Findings: []findings.Finding{}}
	for _, rule := range profile.Rules {
		if rule.Scope != ScopeFile {
			continue
		}
		result := evaluateFileRule(report, rule)
		judgement.Results = append(judgement.Results, result)
		judgement.Findings = append(judgement.Findings, findingsOf(report.File, profile, rule, result, report)...)
	}
	return judgement
}

func evaluateFileRule(report measure.Report, rule Rule) Result {
	result := Result{RuleID: rule.ID}
	if rule.Off {
		result.Status, result.Why = StatusOff, "Turned off in this profile: not judged."
		return result
	}
	value, known := metricValue(report, rule.Metric)
	if rule.CheckedBy != CheckedMeasured || !known {
		result.Status, result.Why = StatusNotChecked, notCheckedWhy(rule)
		return result
	}
	if !finite(value) {
		result.Status = StatusNotMeasurable
		result.Why = "Could not be measured (silence, or audio shorter than the measurement needs); never counted as met."
		return result
	}
	result.Value = number(*value)
	result.Status = StatusMet
	if violation := violationOf(rule, *value); violation != "" {
		result.Status, result.Violation = StatusNotMet, violation
	}
	if rule.Advice != nil {
		if advised, ok := metricValue(report, rule.Advice.Metric); ok && finite(advised) && *advised > rule.Advice.Max {
			result.Advice = rule.Advice.Text
		}
	}
	return result
}

// EvaluateBook judges the book rules over the measured files' reports, in the profile's order. A measured book rule
// with no measured file is not measurable; one the app cannot check is listed as such.
func EvaluateBook(reports []measure.Report, profile Profile) []Result {
	out := []Result{}
	for _, rule := range profile.Rules {
		if rule.Scope != ScopeBook {
			continue
		}
		result := Result{RuleID: rule.ID}
		switch {
		case rule.Off:
			result.Status, result.Why = StatusOff, "Turned off in this profile: not judged."
		case rule.CheckedBy != CheckedMeasured:
			result.Status, result.Why = StatusNotChecked, notCheckedWhy(rule)
		default:
			result = evaluateBookRule(reports, rule)
		}
		out = append(out, result)
	}
	return out
}

func evaluateBookRule(reports []measure.Report, rule Rule) Result {
	result := Result{RuleID: rule.ID}
	var first *float64
	for _, report := range reports {
		value, known := metricValue(report, rule.Metric)
		if !known {
			result.Status, result.Why = StatusNotChecked, notCheckedWhy(rule)
			return result
		}
		if !finite(value) {
			continue
		}
		if violation := violationOf(rule, *value); violation != "" {
			result.Status, result.Violation, result.Value = StatusNotMet, violation, number(*value)
			return result
		}
		if first == nil {
			first = number(*value)
		} else if rule.SameAcrossFiles && *first != *value {
			result.Status, result.Violation = StatusNotMet, ViolationDiffers
			return result
		}
	}
	if first == nil {
		result.Status, result.Why = StatusNotMeasurable, "No measured file to judge."
		return result
	}
	result.Status, result.Value = StatusMet, first
	return result
}

// findingsOf turns one file rule's result into its delivery_qc findings.
func findingsOf(file string, profile Profile, rule Rule, result Result, report measure.Report) []findings.Finding {
	out := []findings.Finding{}
	switch result.Status {
	case StatusNotMet:
		severity := findings.SeverityError
		if rule.Level == LevelAdvice {
			severity = findings.SeverityWarning
		}
		evidence := evidenceOf(profile, rule)
		evidence["value"] = *result.Value
		evidence["violation"] = result.Violation
		addBounds(evidence, rule)
		out = append(out, newFinding(file, profile, rule, "out_of_range", severity, "deterministic measurement of the decoded samples", evidence))
	case StatusNotMeasurable:
		evidence := evidenceOf(profile, rule)
		evidence["available"] = false
		out = append(out, newFinding(file, profile, rule, "unavailable", findings.SeverityInfo,
			"the measurement could not be made (silence, or audio shorter than the measurement window)", evidence))
	}
	if result.Advice != "" && rule.Advice != nil {
		advised, _ := metricValue(report, rule.Advice.Metric)
		evidence := evidenceOf(profile, rule)
		evidence["metric"] = rule.Advice.Metric
		evidence["value"] = *advised
		evidence["violation"] = ViolationAboveMax
		evidence["limit_max"] = rule.Advice.Max
		evidence["advice"] = rule.Advice.Text
		out = append(out, newFinding(file, profile, rule, "advice", findings.SeverityWarning, "deterministic measurement of the decoded samples", evidence))
	}
	return out
}

func evidenceOf(profile Profile, rule Rule) map[string]any {
	return map[string]any{"metric": rule.Metric, "rule": rule.ID, "profile": profile.Key()}
}

func addBounds(evidence map[string]any, rule Rule) {
	if rule.Min != nil {
		evidence["limit_min"] = *rule.Min
	}
	if rule.Max != nil {
		evidence["limit_max"] = *rule.Max
	}
	if len(rule.OneOf) > 0 {
		evidence["allowed"] = append([]float64(nil), rule.OneOf...)
	}
}

// newFinding raises one delivery_qc finding. Its ID is built from the profile's id and the rule's id, never the
// profile's version, so moving a project to a newer version of a profile keeps a finding's ID when the rule is unchanged.
func newFinding(file string, profile Profile, rule Rule, kind string, severity findings.Severity, reason string, evidence map[string]any) findings.Finding {
	confidence := 1.0
	return findings.Finding{
		SchemaVersion:    findings.SchemaVersion,
		ID:               findings.StableID(analyzerName, file, profile.ID, rule.ID, kind),
		Analyzer:         analyzerName,
		Source:           findings.Source{File: file},
		Category:         findings.CategoryDeliveryQC,
		Severity:         severity,
		Confidence:       &confidence,
		ConfidenceReason: reason,
		Evidence:         evidence,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}
