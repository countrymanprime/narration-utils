// Package deliveryreport builds the Delivery page's exported report (diagnostics-delivery-and-cleanup-tools.prd.md
// Phase 7): one model rendered twice, as JSON for tools and as a self-contained HTML page for a reviewer without the
// app, carrying the same finding IDs and review states. It is pure: the host gathers the inputs (the last measurement
// and diagnostics check, the project's delivery profile, the review store, the installed assets) and writes the two files.
//
// The output is deterministic: the same input gives byte-identical files apart from generated_at, because files and
// findings are sorted and every map is written in key order. Local paths are left out unless the narrator opts in
// (Options.IncludePaths): a file is named by its base name, and any absolute path left in free text (an error message,
// evidence) is replaced. A manuscript excerpt is never written, and no audio is embedded or referenced.
package deliveryreport

import (
	"cmp"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// SchemaVersion is the version of the JSON report this package writes.
const SchemaVersion = 2

// Dir is the sidecar folder the host writes reports to, relative to the project folder; never next to the audio.
const Dir = "narration-utils/delivery"

// The statuses of one file in a report.
const (
	FileOpenFindings   = "open_findings"
	FileIncomplete     = "incomplete"
	FileNoOpenFindings = "no_open_findings"
)

// Options are the narrator's choices for one export.
type Options struct {
	// IncludePaths writes each file's full path (and an installed asset's folder); off by default.
	IncludePaths bool
}

// MeasuredFile is one file of the last measurement, as the host's job holds it. Status is the job's word (measured,
// failed, cancelled, pending, measuring).
type MeasuredFile struct {
	Path        string
	Name        string
	Status      string
	Error       string
	Report      *measure.Report
	Fingerprint *measure.Fingerprint
}

// CheckedFile is one file of the last diagnostics check. Status is the job's word (checked, failed, cancelled, ...).
type CheckedFile struct {
	Path     string
	Name     string
	Status   string
	Error    string
	Summary  *measure.DiagnosticSummary
	Findings []findings.Finding
}

// Asset is one installed local asset (a voice, a model), as the asset cache manifest names it.
type Asset struct {
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	Version       string `json:"version"`
	Publisher     string `json:"publisher,omitempty"`
	ProvenanceURL string `json:"provenance_url,omitempty"`
	// Path is the asset's folder, written only when the narrator includes paths.
	Path string `json:"path,omitempty"`
}

// ReviewLookup answers the narrator's decision on a finding, when the project's review store has one.
type ReviewLookup func(id string) (findings.ReviewState, bool)

// Input is everything one report is built from.
type Input struct {
	GeneratedAt string
	AppVersion  string
	Options     Options

	// Profile is the delivery profile the project is judged against (ADR 0179); ProfileNotice says why the project's own
	// choice could not be used, when it could not.
	Profile       deliveryprofile.Profile
	ProfileNotice string

	// Measured is the last measurement's files.
	Measured []MeasuredFile
	// Checked is the last diagnostics check's files, with the source kind and thresholds it used; CheckNote says why
	// there are none.
	Checked    []CheckedFile
	CheckNote  string
	SourceKind *measure.SourceKind
	Thresholds *measure.DiagnosticOptions

	// Review is nil when there is no review store; ReviewNote then says why.
	Review     ReviewLookup
	ReviewNote string

	// Assets are the installed assets; AssetsNote says why the list is not available (Assets is then ignored).
	Assets     []Asset
	AssetsNote string
}

// Build turns the input into the report model. It never fails: what could not be measured or checked is listed with
// its reason instead.
func Build(in Input) Report {
	scrub := newScrubber(in)
	files, refs := buildFiles(in, scrub)
	all := collectFindings(in, refs, scrub)
	for i := range files {
		files[i].finish(all)
	}
	profile := profileOf(in, files, scrub)
	return Report{
		SchemaVersion: SchemaVersion,
		GeneratedAt:   in.GeneratedAt,
		App:           App{Name: "Narration Utils", Version: in.AppVersion},
		Analyzers: []Analyzer{
			{Name: "measure", Version: measure.AnalyzerVersion, Description: "Integrated loudness (ITU-R BS.1770-4), RMS, sample and true peak, noise floor and duration of each whole file"},
			{Name: "diagnostics", Version: measure.AnalyzerVersion, Description: "Clipping, short-term loudness shifts, silences and room-tone changes, against the thresholds listed"},
		},
		Notice:      notice,
		Scope:       Scope{Kind: "chosen_files", Description: scopeDescription},
		Privacy:     privacyOf(in.Options),
		Units:       units(),
		Definitions: definitions(),
		Profile:     profile,
		Diagnostics: diagnosticsOf(in, scrub),
		Review:      reviewOf(in, scrub),
		Summary:     summarise(files, all, profile),
		Files:       files,
		Findings:    all,
		Assets:      assetsOf(in, scrub),
	}
}

// JSON renders the report as indented JSON with a trailing newline.
func (r Report) JSON() ([]byte, error) {
	encoded, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("could not write the report as JSON: %w", err)
	}
	return append(encoded, '\n'), nil
}

// buildFiles joins the measured and checked files by path, sorted by name then path, and numbers them F1, F2, ...
func buildFiles(in Input, scrub scrubber) ([]File, map[string]string) {
	byPath := map[string]*File{}
	order := []string{}
	entry := func(path, name string) *File {
		if file, ok := byPath[path]; ok {
			return file
		}
		file := &File{Name: name, path: path, Measurement: FileMeasurement{Status: "not_measured", Reason: "Not in the last measurement.", Rules: []RuleResult{}},
			Diagnostics: FileCheck{Status: "not_checked", Reason: "Not in the last diagnostics check."}}
		if in.Options.IncludePaths {
			file.Path = path
		}
		byPath[path] = file
		order = append(order, path)
		return file
	}
	for _, measured := range in.Measured {
		entry(measured.Path, measured.Name).Measurement = measurementOf(measured, in.Profile, scrub)
	}
	for _, checked := range in.Checked {
		entry(checked.Path, checked.Name).Diagnostics = checkOf(checked, scrub)
	}
	files := make([]File, 0, len(order))
	for _, path := range order {
		files = append(files, *byPath[path])
	}
	slices.SortFunc(files, func(a, b File) int { return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.path, b.path)) })
	refs := map[string]string{}
	for i := range files {
		files[i].Ref = fmt.Sprintf("F%d", i+1)
		refs[files[i].path] = files[i].Ref
	}
	return files, refs
}

func measurementOf(file MeasuredFile, profile deliveryprofile.Profile, scrub scrubber) FileMeasurement {
	switch file.Status {
	case "measured":
		if file.Report == nil {
			return FileMeasurement{Status: "failed", Reason: "The measurement has no report.", Rules: []RuleResult{}}
		}
		report := *file.Report
		report.File = ""
		results := deliveryprofile.EvaluateFile(*file.Report, profile).Results
		return FileMeasurement{Status: "measured", Report: &report, Fingerprint: file.Fingerprint, Rules: ruleResults(results)}
	case "failed":
		return FileMeasurement{Status: "failed", Reason: "Could not be measured: " + scrub.text(file.Error), Rules: []RuleResult{}}
	}
	return FileMeasurement{Status: "not_measured", Reason: "The measurement was cancelled before this file was read.", Rules: []RuleResult{}}
}

func ruleResults(results []deliveryprofile.Result) []RuleResult {
	out := make([]RuleResult, len(results))
	for i, result := range results {
		out[i] = RuleResult{Rule: result.RuleID, Status: string(result.Status), Value: result.Value, Violation: result.Violation, Why: result.Why, Advice: result.Advice}
	}
	return out
}

func checkOf(file CheckedFile, scrub scrubber) FileCheck {
	switch file.Status {
	case "checked":
		return FileCheck{Status: "checked", Summary: file.Summary}
	case "failed":
		return FileCheck{Status: "failed", Reason: "Could not be checked: " + scrub.text(file.Error)}
	}
	return FileCheck{Status: "not_checked", Reason: "The diagnostics check was cancelled before this file was read."}
}

// collectFindings judges every measured report against the profile (deliveryprofile.EvaluateFile, the same judgement
// as the page's) and adds the diagnostics findings, each with its review state, in file then time order.
func collectFindings(in Input, refs map[string]string, scrub scrubber) []Finding {
	out := []Finding{}
	labels := map[string]string{}
	for _, rule := range in.Profile.Rules {
		labels[rule.ID] = rule.Label
	}
	platform := in.Profile.Platform
	if !in.Profile.BuiltIn {
		platform = "the profile"
	}
	add := func(path string, finding findings.Finding) {
		out = append(out, findingOf(finding, refs[path], in.Review, scrub, labels, platform))
	}
	for _, file := range in.Measured {
		if file.Status == "measured" && file.Report != nil {
			for _, finding := range deliveryprofile.EvaluateFile(*file.Report, in.Profile).Findings {
				add(file.Path, finding)
			}
		}
	}
	for _, file := range in.Checked {
		if file.Status == "checked" {
			for _, finding := range file.Findings {
				add(file.Path, finding)
			}
		}
	}
	slices.SortStableFunc(out, compareFindings)
	return out
}

func compareFindings(a, b Finding) int {
	return cmp.Or(
		cmp.Compare(fileNumber(a.File), fileNumber(b.File)),
		cmp.Compare(startOf(a), startOf(b)),
		cmp.Compare(a.Category, b.Category),
		cmp.Compare(a.ID, b.ID),
	)
}

func fileNumber(ref string) int {
	var n int
	_, _ = fmt.Sscanf(ref, "F%d", &n)
	return n
}

// startOf sorts a finding without a time (a whole-file measurement) before the timed ones.
func startOf(f Finding) float64 {
	if f.TimeRange == nil {
		return -1
	}
	return f.TimeRange.Start
}

func findingOf(f findings.Finding, ref string, review ReviewLookup, scrub scrubber, labels map[string]string, platform string) Finding {
	state := f.Review
	if review != nil {
		if stored, ok := review(f.ID); ok {
			state = stored
		}
	}
	state.Note = scrub.text(state.Note)
	out := Finding{
		ID: f.ID, Analyzer: f.Analyzer, Category: string(f.Category), Severity: string(f.Severity), File: ref,
		Title: titleOf(f, labels, platform), TimeRange: f.TimeRange, Confidence: f.Confidence, ConfidenceReason: scrub.text(f.ConfidenceReason),
		Evidence: scrub.evidence(f.Evidence), Review: state, Open: state.Status != findings.StatusDismissed,
	}
	if f.Manuscript != nil && (f.Manuscript.ChapterID != "" || f.Manuscript.ChapterTitle != "") {
		// The chapter only: a manuscript excerpt is never written into a report.
		out.Chapter = &Chapter{ID: f.Manuscript.ChapterID, Title: f.Manuscript.ChapterTitle}
	}
	return out
}

func (f *File) finish(all []Finding) {
	for _, finding := range all {
		if finding.File == f.Ref && finding.Open {
			f.OpenFindings++
		}
	}
	measured, checked := f.Measurement.Status == "measured", f.Diagnostics.Status == "checked"
	switch {
	case f.OpenFindings > 0:
		f.Status = FileOpenFindings
	case !measured || !checked:
		f.Status = FileIncomplete
	default:
		f.Status = FileNoOpenFindings
	}
}

func summarise(files []File, all []Finding, profile ProfileInfo) Summary {
	summary := Summary{Files: len(files), ByReview: map[string]int{}, BySeverity: map[string]int{}}
	for _, rule := range profile.Rules {
		if rule.Scope == string(deliveryprofile.ScopeFile) {
			summary.RuleResults.add(rule.Results)
		}
	}
	for _, file := range files {
		if file.Measurement.Status == "measured" {
			summary.Measured++
		}
		for _, result := range file.Measurement.Rules {
			if result.Status == string(deliveryprofile.StatusNotMet) {
				summary.FilesNotMet++
				break
			}
		}
		if file.Diagnostics.Status == "checked" {
			summary.Checked++
		}
	}
	summary.NotMeasured, summary.NotChecked = summary.Files-summary.Measured, summary.Files-summary.Checked
	for _, finding := range all {
		summary.Findings++
		if finding.Open {
			summary.OpenFindings++
		}
		summary.ByReview[string(finding.Review.Status)]++
		summary.BySeverity[finding.Severity]++
	}
	return summary
}

// profileOf describes the profile and counts each rule's results over the measured files, and judges the book rules.
func profileOf(in Input, files []File, scrub scrubber) ProfileInfo {
	profile := in.Profile
	info := ProfileInfo{
		Key: profile.Key(), ID: profile.ID, Version: profile.Version, Revision: profile.Revision, Title: profile.Title(),
		Platform: profile.Platform, BuiltIn: profile.BuiltIn, BasedOn: profile.BasedOn, Note: profile.Note,
		Notice: scrub.text(in.ProfileNotice), SourceTitle: profile.Source.Title, SourceURL: profile.Source.URL,
		ReadOn: profile.Source.ReadOn, Rules: []ProfileRule{},
	}
	if !profile.BuiltIn {
		info.Version = ""
	}
	counts := map[string]*RuleCount{}
	reports := []measure.Report{}
	for _, file := range in.Measured {
		if file.Status == "measured" && file.Report != nil {
			reports = append(reports, *file.Report)
		}
	}
	for _, file := range files {
		for _, result := range file.Measurement.Rules {
			if counts[result.Rule] == nil {
				counts[result.Rule] = &RuleCount{}
			}
			counts[result.Rule].count(result.Status)
		}
	}
	info.Book = ruleResults(deliveryprofile.EvaluateBook(reports, profile))
	for _, result := range info.Book {
		counts[result.Rule] = &RuleCount{}
		counts[result.Rule].count(result.Status)
	}
	for _, rule := range profile.Rules {
		row := ProfileRule{
			ID: rule.ID, Label: rule.Label, Scope: string(rule.Scope), Metric: rule.Metric, Unit: rule.Unit, Min: rule.Min, Max: rule.Max,
			OneOf: rule.OneOf, Bound: boundText(rule), Level: string(rule.Level), CheckedBy: string(rule.CheckedBy), Off: rule.Off,
			Requirement: rule.Source.Requirement, Quoted: rule.Source.Quoted, SourceURL: rule.Source.URL, ReadOn: rule.Source.ReadOn,
			Verification: string(rule.Verification), VerificationNote: rule.VerificationNote,
		}
		if count := counts[rule.ID]; count != nil {
			row.Results = *count
		}
		info.Rules = append(info.Rules, row)
	}
	return info
}

func (c *RuleCount) count(status string) {
	switch deliveryprofile.Status(status) {
	case deliveryprofile.StatusMet:
		c.Met++
	case deliveryprofile.StatusNotMet:
		c.NotMet++
	case deliveryprofile.StatusNotMeasurable:
		c.NotMeasurable++
	case deliveryprofile.StatusNotChecked:
		c.NotChecked++
	case deliveryprofile.StatusOff:
		c.Off++
	}
}

func (c *RuleCount) add(other RuleCount) {
	c.Met += other.Met
	c.NotMet += other.NotMet
	c.NotMeasurable += other.NotMeasurable
	c.NotChecked += other.NotChecked
	c.Off += other.Off
}

// boundText writes a rule's bound in words: "-23 to -18 dBFS", "at most -3 dBFS", "one of 44100 Hz".
func boundText(rule deliveryprofile.Rule) string {
	unit := ""
	if rule.Unit != "" {
		unit = " " + rule.Unit
	}
	switch {
	case rule.BoundText != "":
		return rule.BoundText
	case len(rule.OneOf) > 0:
		values := make([]string, len(rule.OneOf))
		for i, value := range rule.OneOf {
			values[i] = strconv.FormatFloat(value, 'f', -1, 64)
		}
		text := "one of " + strings.Join(values, ", ") + unit
		if rule.SameAcrossFiles {
			text += ", the same in every file"
		}
		return text
	case rule.Min != nil && rule.Max != nil:
		return fmt.Sprintf("%g to %g%s", *rule.Min, *rule.Max, unit)
	case rule.Min != nil:
		return fmt.Sprintf("at least %g%s", *rule.Min, unit)
	case rule.Max != nil:
		return fmt.Sprintf("at most %g%s", *rule.Max, unit)
	}
	return ""
}

func diagnosticsOf(in Input, scrub scrubber) DiagnosticsInfo {
	if len(in.Checked) == 0 {
		return DiagnosticsInfo{Note: scrub.text(in.CheckNote)}
	}
	return DiagnosticsInfo{Run: true, SourceKind: in.SourceKind, Thresholds: in.Thresholds,
		Note: "Findings are candidates to listen to against these thresholds, never verdicts."}
}

func reviewOf(in Input, scrub scrubber) ReviewInfo {
	if in.Review == nil {
		return ReviewInfo{Note: scrub.text(in.ReviewNote)}
	}
	return ReviewInfo{Available: true, Note: "Each finding carries the narrator's latest decision from this project's review store; one never decided is unreviewed."}
}

func assetsOf(in Input, scrub scrubber) AssetsInfo {
	if in.AssetsNote != "" {
		return AssetsInfo{Note: scrub.text(in.AssetsNote), Items: []Asset{}}
	}
	items := make([]Asset, 0, len(in.Assets))
	for _, asset := range in.Assets {
		if !in.Options.IncludePaths {
			asset.Path = ""
		}
		items = append(items, asset)
	}
	slices.SortFunc(items, func(a, b Asset) int { return cmp.Or(cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.ID, b.ID)) })
	return AssetsInfo{Available: true, Items: items}
}

func privacyOf(options Options) Privacy {
	note := "Files are named by their file name only; no folder or full path is written, and any path in a message is replaced."
	if options.IncludePaths {
		note = "The narrator chose to include each file's full path."
	}
	return Privacy{PathsIncluded: options.IncludePaths, Note: note + " No audio is embedded or linked, and no manuscript text is written."}
}
