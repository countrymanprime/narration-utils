// This file is Phase 5 of docs/prds/proofing-readiness-signals.prd.md: one
// tri-state signal per delivery check, from the stored measurement of the
// chapter's chosen render (Phase 4) and the delivery profile the project is
// judged against now (internal/deliveryprofile, ADR 0179; the PRD's
// measure.Profile has since been superseded by it). Judging goes through
// deliveryprofile.EvaluateFile rule by rule, never through findings alone,
// because an empty findings list cannot tell "met" from "not evaluated"
// (Architecture Notes). Limits are applied on read, so changing one never
// forces a re-measure.
package proofing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// RenderLengthSignalID is Q9 C's cross-check between the render's length and
// the chapter's audio, required only while the narrator sets a tolerance.
const RenderLengthSignalID = "proofing.delivery.render_length"

// Evidence kinds of the delivery signals.
const (
	EvidenceRender      = "render"
	EvidenceMeasurement = "measurement"
	EvidenceLength      = "length"
	// EvidenceDeliveryScope is the pickups signal's line naming which delivery
	// checks the profile requires, so a pass from pickups alone is visible as
	// such (Q7).
	EvidenceDeliveryScope = "delivery_scope"
)

// DeliveryCheck is one metric check a delivery profile can require of a WAV
// render. ID is its signal id.
type DeliveryCheck struct {
	ID     string
	Metric string
	Label  string
}

// deliveryMetrics are the file metrics measure reports for a WAV and
// deliveryprofile can judge: every file rule a built-in or moved-over profile
// measures, except mp3_format, which is a rule about the MP3 the narrator
// uploads, not the WAV render proofing measures (Q10 A). A custom profile is a
// copy of a built-in and cannot add a kind of rule, so this list is complete
// for every profile the app can hold (pinned by a test).
var deliveryMetrics = []struct{ metric, label string }{
	{"integrated_lufs", "Integrated loudness"},
	{"rms_dbfs", "RMS"},
	{"sample_peak_dbfs", "Sample peak"},
	{"true_peak_dbtp", "True peak"},
	{"noise_floor_dbfs", "Noise floor"},
	{"sample_rate", "Sample rate"},
	{"duration_seconds", "File length"},
	{"head_room_tone_seconds", "Room tone, head"},
	{"tail_room_tone_seconds", "Room tone, tail"},
}

// DeliveryChecks is the catalogue of delivery checks, in a fixed order.
func DeliveryChecks() []DeliveryCheck {
	checks := make([]DeliveryCheck, 0, len(deliveryMetrics))
	for _, m := range deliveryMetrics {
		checks = append(checks, DeliveryCheck{ID: "proofing.delivery." + m.metric, Metric: m.metric, Label: m.label})
	}
	return checks
}

// gatingRules are the profile's rules a check is judged by: file rules on its
// metric, measured by the app, turned on and required. An advice rule never
// gates (its miss is a warning in the Delivery page's own terms); it is shown
// as evidence.
func gatingRules(profile deliveryprofile.Profile, metric string) (gating, advice []deliveryprofile.Rule) {
	for _, rule := range profile.Rules {
		if rule.Scope != deliveryprofile.ScopeFile || rule.Metric != metric || rule.Off || rule.CheckedBy != deliveryprofile.CheckedMeasured {
			continue
		}
		if rule.Level == deliveryprofile.LevelAdvice {
			advice = append(advice, rule)
		} else {
			gating = append(gating, rule)
		}
	}
	return gating, advice
}

// Required reports whether the profile requires the check (Q7 B: a check is
// required when the narrator's profile limits it; SR's own setting can still
// ignore it).
func (check DeliveryCheck) Required(profile deliveryprofile.Profile) bool {
	gating, _ := gatingRules(profile, check.Metric)
	return len(gating) > 0
}

// DeliveryInput is everything DeliverySignal reads. ChapterSpan is the
// timeline span of the chapter's played items, for the length evidence (nil
// when unknown).
type DeliveryInput struct {
	Check              DeliveryCheck
	Profile            deliveryprofile.Profile
	Render             RenderStatus
	ChapterSpan        *float64
	ProjectFileModTime time.Time
	ComputedAt         time.Time
}

// DeliverySignal is one check's tri-state signal: met only when the current
// render's stored measurement has a finite value inside every gating rule's
// bounds; not_met, with the value and the limit, when one is outside; unknown,
// with the cause and the action, for no render, a stale or unsupported render,
// no or a failed measurement, a value that could not be measured, and a check
// the profile does not require. The same input always gives the same signal.
func DeliverySignal(in DeliveryInput) stages.Signal {
	gating, advice := gatingRules(in.Profile, in.Check.Metric)
	signal := deliveryBase(in.Check.ID, in.Render, in.ChapterSpan, in.ProjectFileModTime, in.ComputedAt)
	signal.Basis.Fingerprint = deliveryFingerprint(in.Render, in.Profile.Key(), append(gating, advice...))
	if len(gating) == 0 {
		return unknownSignal(signal, stages.CauseMeasurementUnavailable, fmt.Sprintf("The delivery profile %s has no required rule for %s turned on, so this check is not required.", profileTitle(in.Profile), strings.ToLower(in.Check.Label)))
	}
	if cause, reason, ok := renderNotReady(in.Render); ok {
		return unknownSignal(signal, cause, reason)
	}
	probe := in.Profile
	probe.Rules = append(append([]deliveryprofile.Rule{}, gating...), advice...)
	results := deliveryprofile.EvaluateFile(in.Render.Measurement.Report, probe).Results
	var notMet, unknown []string
	for i, result := range results {
		rule := probe.Rules[i]
		gates := i < len(gating)
		signal.Evidence = append(signal.Evidence, stages.Evidence{Kind: EvidenceMeasurement, Label: ruleLabel(rule, gates), Value: resultText(rule, result)})
		if !gates {
			continue
		}
		switch result.Status {
		case deliveryprofile.StatusMet:
		case deliveryprofile.StatusNotMet:
			notMet = append(notMet, fmt.Sprintf("%s is %s, outside %s", rule.Label, valueText(result.Value, rule.Unit), boundText(rule)))
		default:
			why := result.Why
			if why == "" {
				why = "could not be judged"
			}
			unknown = append(unknown, fmt.Sprintf("%s: %s", rule.Label, why))
		}
	}
	switch {
	case len(notMet) > 0:
		signal.State, signal.Reason = stages.SignalNotMet, strings.Join(notMet, "; ")+"."
	case len(unknown) > 0:
		return unknownSignal(signal, stages.CauseMeasurementUnavailable, strings.Join(unknown, "; "))
	default:
		signal.State, signal.Reason = stages.SignalMet, fmt.Sprintf("%s is within the %s limits on the current render.", in.Check.Label, profileTitle(in.Profile))
	}
	return signal
}

// LengthInput is everything RenderLengthSignal reads.
type LengthInput struct {
	Tolerance          *float64
	ChapterSpan        *float64
	Render             RenderStatus
	ProjectFileModTime time.Time
	ComputedAt         time.Time
}

// RenderLengthSignal is Q9 C: met when the render's measured length is within
// the narrator's tolerance of the chapter's played span; not required (and
// unknown) when no tolerance is set, since no default is proposed until
// render-versus-project lengths are measured on real renders.
func RenderLengthSignal(in LengthInput) stages.Signal {
	signal := deliveryBase(RenderLengthSignalID, in.Render, in.ChapterSpan, in.ProjectFileModTime, in.ComputedAt)
	tolerance := "unset"
	if in.Tolerance != nil {
		tolerance = strconv.FormatFloat(*in.Tolerance, 'f', -1, 64)
	}
	signal.Basis.Fingerprint = hashText(in.Render.Fingerprint, strings.Join(in.Render.RecordIDs, ","), "tolerance="+tolerance)
	if in.Tolerance == nil {
		return unknownSignal(signal, stages.CauseMeasurementUnavailable, "No render length tolerance is set in Proofing settings, so this check is not required.")
	}
	if cause, reason, ok := renderNotReady(in.Render); ok {
		return unknownSignal(signal, cause, reason)
	}
	if in.ChapterSpan == nil {
		return unknownSignal(signal, stages.CauseUnmappedTrack, "The chapter's audio in the saved project could not be read to compare lengths. Link this chapter to its track.")
	}
	rendered := in.Render.Measurement.Report.DurationSeconds
	difference := math.Abs(rendered - *in.ChapterSpan)
	if difference > *in.Tolerance {
		signal.State = stages.SignalNotMet
		signal.Reason = fmt.Sprintf("The render is %.1f s and the chapter's audio spans %.1f s: %.1f s apart, more than your %s s tolerance.", rendered, *in.ChapterSpan, difference, tolerance)
		return signal
	}
	signal.State = stages.SignalMet
	signal.Reason = fmt.Sprintf("The render's length is within %s s of the chapter's audio.", tolerance)
	return signal
}

// deliveryBase is a delivery signal with the evidence every one shows: which
// render it is about and, when measured, its length against the chapter's.
func deliveryBase(id string, render RenderStatus, span *float64, projectModTime, now time.Time) stages.Signal {
	signal := stages.Signal{
		ID: id, Stage: stages.StageProofing, Evidence: []stages.Evidence{}, ComputedAt: now,
		Basis: stages.Basis{LedgerRecordIDs: distinct(render.RecordIDs), ProjectFileModTime: projectModTime},
	}
	if render.Association != nil {
		entry := stages.Evidence{Kind: EvidenceRender, Label: "Rendered file", Value: filepath.Base(render.Association.Path), File: render.Association.Path}
		if render.Measurement != nil {
			entry.Value += ", measured " + render.Measurement.MeasuredAt.UTC().Format(time.RFC3339)
		}
		signal.Evidence = append(signal.Evidence, entry)
	}
	if render.Measurement != nil && span != nil {
		signal.Evidence = append(signal.Evidence, stages.Evidence{Kind: EvidenceLength, Label: "Render length against the chapter's audio",
			Value: fmt.Sprintf("render %.1f s; chapter items span %.1f s", render.Measurement.Report.DurationSeconds, *span)})
	}
	return signal
}

// renderNotReady is the unknown cause and action when the render cannot be
// judged: none chosen, missing, stale, not a WAV, never or unsuccessfully
// measured. "Unavailable" is never good.
func renderNotReady(render RenderStatus) (stages.UnknownCause, string, bool) {
	switch {
	case render.State != RenderCurrent:
		return render.Cause, render.Reason, true
	case render.MeasurementFailed:
		return stages.CauseIncompleteRun, "The last measurement of the rendered file did not finish. Measure it again on the Delivery page.", true
	case render.Measurement == nil:
		return stages.CauseNeverAnalyzed, "Measure the rendered file on the Delivery page.", true
	}
	return "", "", false
}

func unknownSignal(signal stages.Signal, cause stages.UnknownCause, reason string) stages.Signal {
	signal.State, signal.Cause, signal.Reason = stages.SignalUnknown, cause, reason
	return signal
}

func ruleLabel(rule deliveryprofile.Rule, gates bool) string {
	if gates {
		return rule.Label
	}
	return rule.Label + " (advice)"
}

func resultText(rule deliveryprofile.Rule, result deliveryprofile.Result) string {
	switch result.Status {
	case deliveryprofile.StatusMet:
		return fmt.Sprintf("%s, within %s", valueText(result.Value, rule.Unit), boundText(rule))
	case deliveryprofile.StatusNotMet:
		return fmt.Sprintf("%s, outside %s", valueText(result.Value, rule.Unit), boundText(rule))
	}
	if result.Why != "" {
		return "not judged: " + result.Why
	}
	return "not judged"
}

func valueText(value *float64, unit string) string {
	if value == nil {
		return "no value"
	}
	text := strconv.FormatFloat(*value, 'f', 1, 64)
	if unit != "" {
		text += " " + unit
	}
	return text
}

// boundText writes a rule's bound the way the Delivery page states limits.
func boundText(rule deliveryprofile.Rule) string {
	number := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	unit := ""
	if rule.Unit != "" {
		unit = " " + rule.Unit
	}
	switch {
	case rule.BoundText != "":
		return rule.BoundText
	case len(rule.OneOf) > 0:
		values := make([]string, 0, len(rule.OneOf))
		for _, v := range rule.OneOf {
			values = append(values, number(v))
		}
		return "one of " + strings.Join(values, ", ") + unit
	case rule.Min != nil && rule.Max != nil:
		return number(*rule.Min) + " to " + number(*rule.Max) + unit
	case rule.Min != nil:
		return "at least " + number(*rule.Min) + unit
	case rule.Max != nil:
		return "at most " + number(*rule.Max) + unit
	}
	return "its limit"
}

func profileTitle(profile deliveryprofile.Profile) string {
	if profile.ID == "" {
		return "(none)"
	}
	return profile.Title()
}

// deliveryFingerprint hashes what a delivery verdict rests on: the render and
// its measurement, the profile version and the rules' bounds, so a changed
// limit or a new measurement changes the basis and the clock does not.
func deliveryFingerprint(render RenderStatus, profileKey string, rules []deliveryprofile.Rule) string {
	encoded, _ := json.Marshal(rules)
	return hashText(render.Fingerprint, strings.Join(render.RecordIDs, ","), string(render.State), strconv.FormatBool(render.MeasurementFailed), profileKey, string(encoded))
}

func hashText(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = fmt.Fprintf(hash, "%d:%s", len(part), part)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// deliveryScope is the pickups signal's evidence line naming what delivery
// checks are required right now, including "none", so a pass from pickups
// alone is visible as such (Q7).
func deliveryScope(profile deliveryprofile.Profile, tolerance *float64) stages.Evidence {
	var required []string
	for _, check := range DeliveryChecks() {
		if check.Required(profile) {
			required = append(required, check.Label)
		}
	}
	if tolerance != nil {
		required = append(required, "render length")
	}
	value := fmt.Sprintf("No delivery check is required: the delivery profile %s has no measured file rule turned on and no render length tolerance is set.", profileTitle(profile))
	if len(required) > 0 {
		value = fmt.Sprintf("Required by %s: %s.", profileTitle(profile), strings.Join(required, ", "))
	}
	return stages.Evidence{Kind: EvidenceDeliveryScope, Label: "Delivery checks", Value: value}
}
