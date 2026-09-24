package deliveryreport

import (
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// notice is the report's first words: what it is, and what it is not (the PRD's "What We're NOT Building").
const notice = "A generic technical measurement of the files listed, made on the narrator's computer. It is not a certification: " +
	"it does not say that a distributor (ACX or another) will accept these files, and it does not replace an engineer's review. " +
	"A rule marked \"not checked by the app\" or \"listen\" was not judged, and never counts as met. " +
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
	Profile       ProfileInfo       `json:"profile"`
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

// ProfileInfo is the delivery profile the measurements were judged against (ADR 0179): which profile and version, where
// its rules come from, every rule with its source and verification and how many files met it, and the book rules'
// results. Notice says why the project's own choice could not be used, when it could not.
type ProfileInfo struct {
	Key         string        `json:"key"`
	ID          string        `json:"id"`
	Version     string        `json:"version,omitempty"`
	Revision    int           `json:"revision,omitempty"`
	Title       string        `json:"title"`
	Platform    string        `json:"platform"`
	BuiltIn     bool          `json:"built_in"`
	BasedOn     string        `json:"based_on,omitempty"`
	Note        string        `json:"note,omitempty"`
	Notice      string        `json:"notice,omitempty"`
	SourceTitle string        `json:"source_title,omitempty"`
	SourceURL   string        `json:"source_url,omitempty"`
	ReadOn      string        `json:"read_on,omitempty"`
	Rules       []ProfileRule `json:"rules"`
	Book        []RuleResult  `json:"book_results"`
}

// ProfileRule is one rule as a recipient reads it: what the platform requires and where that is written, how the app
// checks it, how it was verified, and how many measured files met it, did not, or could not be judged.
type ProfileRule struct {
	ID               string    `json:"id"`
	Label            string    `json:"label"`
	Scope            string    `json:"scope"`
	Metric           string    `json:"metric"`
	Unit             string    `json:"unit,omitempty"`
	Min              *float64  `json:"min"`
	Max              *float64  `json:"max"`
	OneOf            []float64 `json:"one_of,omitempty"`
	Bound            string    `json:"bound"`
	Level            string    `json:"level"`
	CheckedBy        string    `json:"checked_by"`
	Off              bool      `json:"off,omitempty"`
	Requirement      string    `json:"requirement"`
	Quoted           bool      `json:"quoted"`
	SourceURL        string    `json:"source_url,omitempty"`
	ReadOn           string    `json:"read_on,omitempty"`
	Verification     string    `json:"verification"`
	VerificationNote string    `json:"verification_note,omitempty"`
	Results          RuleCount `json:"results"`
}

// RuleCount counts one rule's results over the measured files, or over the book.
type RuleCount struct {
	Met           int `json:"met"`
	NotMet        int `json:"not_met"`
	NotMeasurable int `json:"not_measurable"`
	NotChecked    int `json:"not_checked"`
	Off           int `json:"off"`
}

// RuleResult is one rule's result for one file, or for the book.
type RuleResult struct {
	Rule      string   `json:"rule"`
	Status    string   `json:"status"`
	Value     *float64 `json:"value"`
	Violation string   `json:"violation,omitempty"`
	Why       string   `json:"why,omitempty"`
	Advice    string   `json:"advice,omitempty"`
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
	RuleResults  RuleCount      `json:"rule_results"`
	FilesNotMet  int            `json:"files_not_met"`
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
	// Rules is the file's result per file rule of the profile; empty unless measured.
	Rules []RuleResult `json:"rules"`
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
		"noise_floor_dbfs": "dBFS", "duration_seconds": "s", "sample_rate": "Hz", "time_range": "s from the start of the file",
	}
}

func definitions() map[string]string {
	return map[string]string{
		"integrated_lufs":  "Gated integrated loudness per ITU-R BS.1770-4 over the whole file.",
		"rms_dbfs":         "RMS over the whole file, silences included, over every channel; whether it matches a distributor's own RMS definition is still to verify.",
		"sample_peak_dbfs": "The highest decoded sample.",
		"true_peak_dbtp":   "The highest inter-sample peak, from oversampling (4x at 48 kHz and below, 2x above; ITU-R BS.1770-4 Annex 2).",
		"noise_floor_dbfs": "The RMS of the quietest 0.5 s window that is not digital silence.",
		"not_measurable":   "A value that is null could not be measured (silence, or audio too short); it is never a number and never counts as met.",
		"not_checked":      "A rule the app cannot check yet (for example the MP3 you upload, when the WAV render was measured) or one to listen for; it is never counted as met.",
	}
}

var diagnosticLabels = map[string]string{
	"clipping": "Clipping", "level_shift": "Level shift", "room_tone_change": "Room-tone change", "long_pause": "Long pause",
}

// titleOf names a finding in words: the rule and how the file missed it, or the kind of diagnostic.
func titleOf(f findings.Finding, labels map[string]string, platform string) string {
	if f.Category == findings.CategoryDeliveryQC {
		rule, _ := f.Evidence["rule"].(string)
		label := labels[rule]
		if label == "" {
			label = rule
		}
		if _, advice := f.Evidence["advice"]; advice {
			return label + ": advice"
		}
		switch f.Evidence["violation"] {
		case "above_max":
			return label + " above " + platform + "'s highest"
		case "below_min":
			return label + " below " + platform + "'s lowest"
		case "not_one_of":
			return label + " not one " + platform + " accepts"
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
