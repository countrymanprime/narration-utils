package deliveryprofile

// The Review page's delivery findings (delivery-platform-profiles.prd.md Phase 9, P12): the adapter that turns one
// measured file's rule results into the delivery_qc findings saved in the project's findings store, beside Transcript
// Compare's and the Story Bible's. It mirrors those adapters: it only reads a judgement (EvaluateFile), never changes a
// profile or a measurement, and never deletes a finding. The store alone decides a finding is resolved, by its id being
// absent from the fresh set the next time the file is judged, which is what happens once its rule is met again.

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// ReviewAnalyzer is the store partition delivery findings are saved under: the analyzer the findings already name.
const ReviewAnalyzer = analyzerName

// ReviewScope is the store scope of one measured file. A measurement covers only the files the narrator picked, so each
// file is its own scope: judging one file again resolves only that file's findings, never another file's.
func ReviewScope(file string) string {
	hash := sha256.Sum256([]byte(file))
	return "file-" + hex.EncodeToString(hash[:8])
}

// ReviewFindings is one finding per file rule that is not met or could not be measured, with the same id the Delivery
// page and the exported report give it, so a decision made on the Review page is the report's decision too. A rule's
// advice (true peak above ACX's advice, digital silence at an edge) stays on the Delivery page: it is not a rule missed.
// fingerprint names the audio that was measured (measure.Fingerprint's SHA-256); it is part of the evidence version, so
// a decision holds while the same audio is judged the same way and the finding returns to unreviewed after a re-render.
func ReviewFindings(report measure.Report, fingerprint string, profile Profile, project findings.Project) []findings.Finding {
	judgement := EvaluateFile(report, profile)
	byID := make(map[string]findings.Finding, len(judgement.Findings))
	for _, f := range judgement.Findings {
		byID[f.ID] = f
	}
	out := []findings.Finding{}
	for _, result := range judgement.Results {
		var kind string
		switch result.Status {
		case StatusNotMet:
			kind = "out_of_range"
		case StatusNotMeasurable:
			kind = "unavailable"
		default:
			continue
		}
		rule, _ := profile.Rule(result.RuleID)
		f, ok := byID[findings.StableID(analyzerName, report.File, profile.ID, rule.ID, kind)]
		if !ok {
			continue
		}
		f.Project = project
		f.Evidence["rule_label"] = rule.Label
		f.Evidence["requirement"] = rule.Source.Requirement
		f.Evidence["profile_name"] = profile.Title()
		if rule.Unit != "" {
			f.Evidence["unit"] = rule.Unit
		}
		f.EvidenceVersion = reviewEvidenceVersion(fingerprint, rule, result)
		out = append(out, f)
	}
	return out
}

// reviewEvidenceVersion hashes what a decision on a delivery finding is made against: the audio measured, the rule's
// bound, and how the value stood against it. The profile's version and a custom profile's revision are left out, so a
// newer ACX or a saved custom profile with this rule unchanged keeps the narrator's decision.
func reviewEvidenceVersion(fingerprint string, rule Rule, result Result) string {
	parts := []string{fingerprint, rule.ID, string(result.Status), result.Violation, formatNumber(result.Value), formatNumber(rule.Min), formatNumber(rule.Max)}
	for _, allowed := range rule.OneOf {
		parts = append(parts, formatNumber(&allowed))
	}
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	return "sha256:" + hex.EncodeToString(hash[:])
}

// formatNumber writes a value to a hundredth, finer than the page shows it, so float noise never counts as new evidence.
func formatNumber(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'f', 2, 64)
}
