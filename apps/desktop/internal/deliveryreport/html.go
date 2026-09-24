package deliveryreport

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// report.html.tmpl is the whole page: inline styles, no script, nothing fetched, so it opens anywhere without the app.
//
//go:embed report.html.tmpl
var pageSource string

var page = template.Must(template.New("report").Funcs(template.FuncMap{
	"level":        formatLevel,
	"optLevel":     formatOptionalLevel,
	"clock":        formatClock,
	"timeRange":    formatTimeRange,
	"evidence":     evidenceLines,
	"statusText":   fileStatusText,
	"reviewText":   reviewText,
	"severity":     strings.ToUpper,
	"profileLine":  profileLine,
	"ruleSummary":  ruleSummary,
	"checkedText":  checkedText,
	"verifiedText": verifiedText,
	"resultCount":  resultCount,
	"fileRules":    fileRuleLines,
	"shortHash":    shortHash,
	"metrics":      reportMetrics,
	"fileName":     func(r Report, ref string) string { return r.fileName(ref) },
	"thresholds":   thresholdLines,
	"sourceKind":   sourceKindText,
	"counts":       countLines,
}).Parse(pageSource))

// HTML renders the report as one self-contained page.
func (r Report) HTML() ([]byte, error) {
	var out bytes.Buffer
	if err := page.Execute(&out, r); err != nil {
		return nil, fmt.Errorf("could not write the report as HTML: %w", err)
	}
	return out.Bytes(), nil
}

func (r Report) fileName(ref string) string {
	for _, file := range r.Files {
		if file.Ref == ref {
			return file.Name
		}
	}
	return ref
}

// formatLevel writes a level with one decimal and a typographic minus, as the Delivery page does.
func formatLevel(value float64) string {
	return strings.Replace(strconv.FormatFloat(value, 'f', 1, 64), "-", "−", 1)
}

func formatOptionalLevel(value *float64) string {
	if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) {
		return "Not measurable"
	}
	return formatLevel(*value)
}

// formatClock writes seconds as m:ss.mmm, or h:mm:ss.mmm from an hour, so a recipient can find the moment in any player.
func formatClock(seconds float64) string {
	millis := int64(math.Round(math.Max(0, seconds) * 1000))
	hours, minutes, secs, ms := millis/3_600_000, millis/60_000%60, millis/1000%60, millis%1000
	if hours > 0 {
		return fmt.Sprintf("%d:%02d:%02d.%03d", hours, minutes, secs, ms)
	}
	return fmt.Sprintf("%d:%02d.%03d", minutes, secs, ms)
}

func formatTimeRange(r *findings.TimeRange) string {
	if r == nil {
		return "Whole file"
	}
	return formatClock(r.Start) + " – " + formatClock(r.End)
}

// evidenceLines writes a finding's evidence as "key: value" lines in key order.
func evidenceLines(evidence map[string]any) []string {
	keys := make([]string, 0, len(evidence))
	for key := range evidence {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, key+": "+formatValue(evidence[key]))
	}
	return lines
}

func formatValue(value any) string {
	switch typed := value.(type) {
	case float64:
		return strconv.FormatFloat(typed, 'g', 6, 64)
	case nil:
		return "none"
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	}
	return fmt.Sprint(value)
}

func fileStatusText(file File) string {
	switch file.Status {
	case FileOpenFindings:
		if file.OpenFindings == 1 {
			return "1 open finding"
		}
		return fmt.Sprintf("%d open findings", file.OpenFindings)
	case FileIncomplete:
		return "Not fully checked"
	}
	return "Measured and checked; no open findings"
}

func reviewText(state findings.ReviewState) string {
	text := map[findings.Status]string{
		findings.StatusUnreviewed: "Unreviewed", findings.StatusAccepted: "Accepted", findings.StatusDismissed: "Dismissed", findings.StatusDeferred: "Deferred",
	}[state.Status]
	if text == "" {
		text = string(state.Status)
	}
	if state.Timestamp != "" {
		text += " (" + state.Timestamp + ")"
	}
	return text
}

// profileLine says where the profile's rules come from and how many of each kind it holds.
func profileLine(p ProfileInfo) string {
	checked, notChecked, listen, toVerify, conflicting := 0, 0, 0, 0, 0
	for _, rule := range p.Rules {
		switch rule.CheckedBy {
		case "measured":
			checked++
		case "listen":
			listen++
		default:
			notChecked++
		}
		switch rule.Verification {
		case "to_verify":
			toVerify++
		case "conflicting":
			conflicting++
		}
	}
	source := ""
	if p.SourceTitle != "" {
		source = "Rules cite " + p.SourceTitle
		if p.SourceURL != "" {
			source += " (" + p.SourceURL + ")"
		}
		if p.ReadOn != "" {
			source += ", read " + p.ReadOn
		}
		source += ". "
	}
	return fmt.Sprintf("%s%d rules: %d checked by the app, %d not checked by the app, %d listen. %d to verify, %d with conflicting sources.",
		source, len(p.Rules), checked, notChecked, listen, toVerify, conflicting)
}

// ruleSummary is the summary line of the file rules' results.
func ruleSummary(r Report) string {
	c := r.Summary.RuleResults
	return fmt.Sprintf("Against %s: %d rule result(s) not met in %d file(s); %d met; %d not checked by the app; %d not measurable.",
		r.Profile.Title, c.NotMet, r.Summary.FilesNotMet, c.Met, c.NotChecked, c.NotMeasurable)
}

func checkedText(rule ProfileRule) string {
	if rule.Off {
		return "Turned off in this profile: not judged"
	}
	switch rule.CheckedBy {
	case "measured":
		if rule.Bound == "" {
			return "Measured"
		}
		return "Measured, " + rule.Bound
	case "listen":
		return "Listen: not judged by the app"
	}
	return "Not checked by the app"
}

func verifiedText(rule ProfileRule) string {
	text := map[string]string{"verified": "Verified", "to_verify": "To verify", "conflicting": "Conflicting sources"}[rule.Verification]
	if rule.Verification == "verified" && rule.ReadOn != "" {
		text += " " + rule.ReadOn
	}
	if rule.VerificationNote != "" {
		text += ": " + rule.VerificationNote
	}
	return text
}

func resultCount(c RuleCount) string {
	parts := []string{}
	for _, part := range []struct {
		n    int
		text string
	}{{c.Met, "met"}, {c.NotMet, "not met"}, {c.NotMeasurable, "not measurable"}, {c.NotChecked, "not checked"}, {c.Off, "off"}} {
		if part.n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", part.n, part.text))
		}
	}
	if len(parts) == 0 {
		return "Nothing measured"
	}
	return strings.Join(parts, ", ")
}

// fileRuleLines lists a file's result per rule in words.
func fileRuleLines(r Report, rules []RuleResult) []string {
	labels := map[string]string{}
	for _, rule := range r.Profile.Rules {
		labels[rule.ID] = rule.Label
	}
	words := map[string]string{"met": "met", "not_met": "NOT MET", "not_measurable": "not measurable", "not_checked": "not checked", "off": "off"}
	lines := make([]string, 0, len(rules))
	for _, result := range rules {
		line := labels[result.Rule] + ": " + words[result.Status]
		if result.Advice != "" {
			line += " (advice: " + result.Advice + ")"
		}
		lines = append(lines, line)
	}
	return lines
}

func shortHash(fingerprint *measure.Fingerprint) string {
	if fingerprint == nil || len(fingerprint.SHA256) < 12 {
		return ""
	}
	return fingerprint.SHA256[:12]
}

// metricCell is one measured value with its unit, for the files table.
type metricCell struct{ Label, Value string }

func reportMetrics(report *measure.Report) []metricCell {
	if report == nil {
		return nil
	}
	return []metricCell{
		{"Loudness (LUFS)", formatOptionalLevel(report.IntegratedLUFS)},
		{"RMS (dBFS)", formatOptionalLevel(report.RMSdBFS)},
		{"Sample peak (dBFS)", formatOptionalLevel(report.SamplePeakdBFS)},
		{"True peak (dBTP)", formatOptionalLevel(report.TruePeakdBTP)},
		{"Noise floor (dBFS)", formatOptionalLevel(report.NoiseFloordBFS)},
		{"Sample rate (Hz)", strconv.Itoa(report.SampleRate)},
		{"Channels", strconv.Itoa(report.Channels)},
		{"Length", formatClock(report.DurationSeconds)},
		{"Silent windows", strconv.Itoa(report.DigitalSilentWindows)},
	}
}

func thresholdLines(options *measure.DiagnosticOptions) []string {
	if options == nil {
		return nil
	}
	return []string{
		"Clip ceiling: " + formatLevel(options.ClipCeilingdBFS) + " dBFS",
		"Silence floor: " + formatLevel(options.SilenceFloordBFS) + " dBFS",
		"Shortest silence: " + strconv.FormatFloat(options.MinSilenceSeconds, 'g', 6, 64) + " s",
		"Level shift: " + strconv.FormatFloat(options.LevelShiftLU, 'g', 6, 64) + " LU",
		"Room-tone step: " + strconv.FormatFloat(options.RoomToneStepDB, 'g', 6, 64) + " dB",
		"Long pause: " + strconv.FormatFloat(options.Pauses.LongPauseSeconds, 'g', 6, 64) + " s (pauses from " + strconv.FormatFloat(options.Pauses.MinPauseSeconds, 'g', 6, 64) + " s)",
	}
}

func sourceKindText(kind *measure.SourceKind) string {
	if kind == nil {
		return ""
	}
	if *kind == measure.SourceProcessedRender {
		return "Processed renders"
	}
	return "Raw recordings"
}

// countLines writes a count map ("unreviewed: 3") in key order.
func countLines(counts map[string]int) string {
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s %d", key, counts[key]))
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, ", ")
}
