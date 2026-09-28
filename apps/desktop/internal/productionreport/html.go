package productionreport

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
	"sort"
	"strconv"
)

//go:embed report.html.tmpl
var pageSource string

var page = template.Must(template.New("report").Funcs(template.FuncMap{
	"clock":      formatClock,
	"optClock":   formatOptionalClock,
	"optPfh":     formatOptionalPfh,
	"optAmount":  formatOptionalAmount,
	"days":       formatDays,
	"stageHours": stageHoursLines,
	"readiness":  readinessLines,
}).Parse(pageSource))

// HTML renders the report as one self-contained page.
func (r Report) HTML() ([]byte, error) {
	var out bytes.Buffer
	if err := page.Execute(&out, r); err != nil {
		return nil, fmt.Errorf("could not write the report as HTML: %w", err)
	}
	return out.Bytes(), nil
}

// formatClock writes seconds as h:mm:ss, for the finished-audio figure.
func formatClock(seconds float64) string {
	total := int64(seconds)
	hours, minutes, secs := total/3600, total/60%60, total%60
	return fmt.Sprintf("%d:%02d:%02d", hours, minutes, secs)
}

func formatOptionalClock(hours float64) string {
	return strconv.FormatFloat(hours, 'f', 1, 64) + " h"
}

func formatOptionalPfh(value *float64) string {
	if value == nil {
		return "not available"
	}
	return strconv.FormatFloat(*value, 'f', 2, 64)
}

func formatOptionalAmount(value *float64) string {
	if value == nil {
		return "not available"
	}
	return strconv.FormatFloat(*value, 'f', 2, 64)
}

func formatDays(days int) string {
	switch {
	case days < 0:
		return fmt.Sprintf("%d days ago", -days)
	case days == 0:
		return "today"
	default:
		return fmt.Sprintf("in %d days", days)
	}
}

// stageHoursLines writes hours-by-stage in key order, so the HTML page is deterministic like the JSON.
func stageHoursLines(byStage map[string]float64) []string {
	keys := make([]string, 0, len(byStage))
	for key := range byStage {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, key+": "+formatOptionalClock(byStage[key]))
	}
	return lines
}

func readinessLines(r Readiness) []string {
	return []string{
		fmt.Sprintf("Recommended: %d", r.Recommended),
		fmt.Sprintf("Held back: %d", r.NotReady),
		fmt.Sprintf("Unknown: %d", r.Unknown),
		fmt.Sprintf("Dismissed: %d", r.Dismissed),
		fmt.Sprintf("Not available: %d", r.None),
	}
}
