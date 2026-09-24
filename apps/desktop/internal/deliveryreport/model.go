package deliveryreport

import (
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// notice is the report's first words: what it is, and what it is not (the PRD's "What We're NOT Building").
const notice = "A generic technical measurement of the files listed, made on the narrator's computer. It is not a certification: " +
	"it does not say that a distributor (ACX or another) will accept these files, and it does not replace an engineer's review. " +
	"Every open finding, and every file that was not measured or checked, is listed."

const scopeDescription = "The files the narrator chose on the Delivery page in this session: the last measurement and the last diagnostics check. " +
	"Files are not matched to chapters yet, so each is listed by its file name."

// Report is the whole exported report; JSON and HTML are two renderings of it.
type Report struct {
	SchemaVersion int               `json:"schema_version"`
	GeneratedAt   string            `json:"generated_at"`
	App           App               `json:"app"`
	Analyzers     []Analyzer        `json:"analyzers"`
	Notice        string            `json:"notice"`
	Scope         Scope             `json:"scope"`
	Privacy       Privacy           `json:"privacy"`
	Units         map[string]string `json:"units"`
	Definitions   map[string]string `json:"definitions"`
	Limits        Limits            `json:"limits"`
	Diagnostics   DiagnosticsInfo   `json:"diagnostics"`
	Review        ReviewInfo        `json:"review"`
	Summary       Summary           `json:"summary"`
	Files         []File            `json:"files"`
	Findings      []Finding         `json:"findings"`
	Assets        AssetsInfo        `json:"assets"`
}

type App struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type Analyzer struct {
	Name        string `json:"name"`
	Version     int    `json:"version"`
	Description string `json:"description"`
}

type Scope struct {
	Kind        string `json:"kind"`
	Description string `json:"description"`
}

type Privacy struct {
	PathsIncluded bool   `json:"paths_included"`
	Note          string `json:"note"`
}

// Limits are the narrator's limits the measurements were judged against, or why none were.
type Limits struct {
	Set     bool       `json:"set"`
	Error   string     `json:"error,omitempty"`
	Note    string     `json:"note"`
	Metrics []LimitRow `json:"metrics"`
}

type LimitRow struct {
	Metric string   `json:"metric"`
	Label  string   `json:"label"`
	Unit   string   `json:"unit"`
	Min    *float64 `json:"min"`
	Max    *float64 `json:"max"`
}

// DiagnosticsInfo says whether a diagnostics check is in the report, of what source kind and with which thresholds.
type DiagnosticsInfo struct {
	Run        bool                       `json:"run"`
	Note       string                     `json:"note"`
	SourceKind *measure.SourceKind        `json:"source_kind"`
	Thresholds *measure.DiagnosticOptions `json:"thresholds"`
}

type ReviewInfo struct {
	Available bool   `json:"available"`
	Note      string `json:"note"`
}

type Summary struct {
	Files        int            `json:"files"`
	Measured     int            `json:"measured"`
	NotMeasured  int            `json:"not_measured"`
	Checked      int            `json:"checked"`
	NotChecked   int            `json:"not_checked"`
	Findings     int            `json:"findings"`
	OpenFindings int            `json:"open_findings"`
	ByReview     map[string]int `json:"by_review"`
	BySeverity   map[string]int `json:"by_severity"`
}

// File is one file the report covers. Ref (F1, F2, ...) is what a finding names it by.
type File struct {
	Ref          string          `json:"ref"`
	Name         string          `json:"name"`
	Path         string          `json:"path,omitempty"`
	Status       string          `json:"status"`
	OpenFindings int             `json:"open_findings"`
	Measurement  FileMeasurement `json:"measurement"`
	Diagnostics  FileCheck       `json:"diagnostics"`
	// path is the file's identity while the report is built; it is written only through Path.
	path string
}

type FileMeasurement struct {
	Status      string               `json:"status"`
	Reason      string               `json:"reason,omitempty"`
	Report      *measure.Report      `json:"report,omitempty"`
	Fingerprint *measure.Fingerprint `json:"fingerprint,omitempty"`
}

type FileCheck struct {
	Status  string                     `json:"status"`
	Reason  string                     `json:"reason,omitempty"`
	Summary *measure.DiagnosticSummary `json:"summary,omitempty"`
}

// Finding is one finding as a recipient reads it: the same ID and review state the app shows, the file it is in, when,
// and what was measured against which threshold. Open is every finding the narrator has not dismissed.
type Finding struct {
	ID               string               `json:"id"`
	Analyzer         string               `json:"analyzer"`
	Category         string               `json:"category"`
	Severity         string               `json:"severity"`
	Title            string               `json:"title"`
	File             string               `json:"file"`
	Chapter          *Chapter             `json:"chapter,omitempty"`
	TimeRange        *findings.TimeRange  `json:"time_range,omitempty"`
	Confidence       *float64             `json:"confidence"`
	ConfidenceReason string               `json:"confidence_reason"`
	Evidence         map[string]any       `json:"evidence,omitempty"`
	Review           findings.ReviewState `json:"review"`
	Open             bool                 `json:"open"`
}

type Chapter struct {
	ID    string `json:"id,omitempty"`
	Title string `json:"title,omitempty"`
}

type AssetsInfo struct {
	Available bool    `json:"available"`
	Note      string  `json:"note,omitempty"`
	Items     []Asset `json:"items"`
}

func units() map[string]string {
	return map[string]string{
		"integrated_lufs": "LUFS", "rms_dbfs": "dBFS", "sample_peak_dbfs": "dBFS", "true_peak_dbtp": "dBTP",
		"noise_floor_dbfs": "dBFS", "duration_seconds": "s", "time_range": "s from the start of the file",
	}
}

func definitions() map[string]string {
	return map[string]string{
		"integrated_lufs":  "Gated integrated loudness per ITU-R BS.1770-4 over the whole file.",
		"rms_dbfs":         "RMS over the whole file, silences included; not any distributor's own RMS definition.",
		"sample_peak_dbfs": "The highest decoded sample.",
		"true_peak_dbtp":   "The highest inter-sample peak, from oversampling (4x at 48 kHz and below, 2x above; ITU-R BS.1770-4 Annex 2).",
		"noise_floor_dbfs": "The RMS of the quietest 0.5 s window that is not digital silence.",
		"not_measurable":   "A value that is null could not be measured (silence, or audio too short); it is never a number and never counts as within a limit.",
	}
}

var metricLabels = map[string]string{
	"integrated_lufs": "Integrated loudness", "rms_dbfs": "RMS", "sample_peak_dbfs": "Sample peak",
	"true_peak_dbtp": "True peak", "noise_floor_dbfs": "Noise floor",
}

var diagnosticLabels = map[string]string{
	"clipping": "Clipping", "level_shift": "Level shift", "room_tone_change": "Room-tone change", "long_pause": "Long pause",
}

// titleOf names a finding in words: the metric and how it broke a limit, or the kind of diagnostic.
func titleOf(f findings.Finding) string {
	if f.Category == findings.CategoryDeliveryQC {
		metric, _ := f.Evidence["metric"].(string)
		label := metricLabels[metric]
		if label == "" {
			label = metric
		}
		switch f.Evidence["violation"] {
		case "above_max":
			return label + " above your highest limit"
		case "below_min":
			return label + " below your lowest limit"
		}
		if available, ok := f.Evidence["available"].(bool); ok && !available {
			return label + " not measurable, so not judged"
		}
		return label
	}
	kind, _ := f.Evidence["kind"].(string)
	if label := diagnosticLabels[kind]; label != "" {
		return label
	}
	return string(f.Category)
}
