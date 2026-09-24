package deliveryreport

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// The golden files are written by this test, never by hand: run it with UPDATE_GOLDEN=1 after an intended change and
// read the diff.

const (
	chapterOne   = `C:\Users\AdaLovelace\Renders\Alice\Chapter 01.wav`
	chapterTwo   = `C:\Users\AdaLovelace\Renders\Alice\Chapter 02.wav`
	chapterThree = `C:\Users\AdaLovelace\Renders\Alice\Chapter 03.mp3`
	chapterFour  = `C:\Users\AdaLovelace\Renders\Alice\Chapter 04.wav`
)

func number(v float64) *float64 { return &v }

func measuredReport(path string, lufs, truePeak *float64) *measure.Report {
	return &measure.Report{
		File: path, SampleRate: 48000, Channels: 2, DurationSeconds: 1843.5,
		IntegratedLUFS: lufs, RMSdBFS: number(-21.2), SamplePeakdBFS: number(-3.6), TruePeakdBTP: truePeak,
		NoiseFloordBFS: number(-66.8), ClipRuns: []measure.ClipRun{},
	}
}

func clipFinding(path string, start float64) findings.Finding {
	end := start + 0.002
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion, ID: findings.StableID("diagnostics", path, "clipping", "1"), Analyzer: "diagnostics",
		Source: findings.Source{File: path}, TimeRange: &findings.TimeRange{Start: start, End: end, SourceStart: &start, SourceEnd: &end},
		Category: findings.CategoryAudioQuality, Severity: findings.SeverityWarning, Confidence: number(1),
		ConfidenceReason: "deterministic: runs of 3 or more samples at or above the ceiling",
		Evidence:         map[string]any{"kind": "clipping", "ceiling_dbfs": 0.0, "source_kind": "processed_render", "note": "read from " + path},
		Manuscript:       &findings.Manuscript{ChapterID: "ch-1", ChapterTitle: "Down the Rabbit-Hole", Expected: "a private manuscript line"},
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}

func sampleInput() Input {
	profile := deliveryprofile.ACX()
	kind := measure.SourceProcessedRender
	thresholds := measure.DefaultDiagnosticOptions()
	summary := &measure.DiagnosticSummary{DurationSeconds: 1843.5, SampleRate: 48000, Channels: 2, ClipRegions: 1,
		Pacing: measure.Evidence{Status: measure.StatusUnavailable, Reason: "no transcript timing"}}
	return Input{
		GeneratedAt: "2026-09-23T14:00:00Z", AppVersion: "0.9.0", Profile: profile,
		Measured: []MeasuredFile{
			{Path: chapterTwo, Name: "Chapter 02.wav", Status: "measured", Report: measuredReport(chapterTwo, nil, nil),
				Fingerprint: &measure.Fingerprint{SizeBytes: 176_444, ModifiedAt: "2026-09-23T14:05:00Z", SHA256: strings.Repeat("e3", 32)}},
			{Path: chapterOne, Name: "Chapter 01.wav", Status: "measured", Report: measuredReport(chapterOne, number(-19.4), number(-2.4)),
				Fingerprint: &measure.Fingerprint{SizeBytes: 530_928_044, ModifiedAt: "2026-09-23T14:02:11.5Z", SHA256: strings.Repeat("9f", 32)}},
			{Path: chapterThree, Name: "Chapter 03.mp3", Status: "failed", Error: "open " + chapterThree + ": not a RIFF/WAVE file"},
			{Path: chapterFour, Name: "Chapter 04.wav", Status: "cancelled"},
		},
		Checked: []CheckedFile{
			{Path: chapterOne, Name: "Chapter 01.wav", Status: "checked", Summary: summary, Findings: []findings.Finding{clipFinding(chapterOne, 612.25)}},
			{Path: chapterTwo, Name: "Chapter 02.wav", Status: "checked", Summary: summary, Findings: []findings.Finding{}},
		},
		SourceKind: &kind, Thresholds: &thresholds,
		Review: func(string) (findings.ReviewState, bool) { return findings.ReviewState{}, false },
		Assets: []Asset{
			{Kind: "whisper", ID: "small", Name: "Whisper small", Version: "1.0", Publisher: "OpenAI", ProvenanceURL: "https://huggingface.co/openai/whisper-small", Path: `C:\Users\AdaLovelace\AppData\Local\narration-utils\whisper\small`},
			{Kind: "piper", ID: "en_US-ljspeech-high", Name: "LJSpeech", Version: "1.0.0"},
		},
	}
}

func render(t *testing.T, in Input) (string, string) {
	t.Helper()
	report := Build(in)
	encoded, err := report.JSON()
	if err != nil {
		t.Fatal(err)
	}
	page, err := report.HTML()
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded), string(page)
}

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v (run with UPDATE_GOLDEN=1 to write it)", path, err)
	}
	if !bytes.Equal(bytes.ReplaceAll(want, []byte("\r\n"), []byte("\n")), []byte(got)) {
		t.Fatalf("%s differs from what the report writes now; run with UPDATE_GOLDEN=1 if the change is intended", path)
	}
}

func TestTheReportMatchesItsGoldenFiles(t *testing.T) {
	encoded, page := render(t, sampleInput())
	golden(t, "report.golden.json", encoded)
	golden(t, "report.golden.html", page)
}

func TestTheSameInputGivesTheSameBytesApartFromTheTimestamp(t *testing.T) {
	first, firstPage := render(t, sampleInput())
	again, againPage := render(t, sampleInput())
	if first != again || firstPage != againPage {
		t.Fatal("two reports of the same input differ")
	}
	later := sampleInput()
	later.GeneratedAt = "2026-09-24T09:30:00Z"
	laterJSON, _ := render(t, later)
	if strings.Replace(laterJSON, later.GeneratedAt, sampleInput().GeneratedAt, 1) != first {
		t.Fatal("a later report differs by more than generated_at")
	}
}

// absoluteOrPrivate is anything a redacted report must not hold: a drive path, the folder, the user name, or the
// manuscript line.
var absoluteOrPrivate = regexp.MustCompile(`(?i)\b[a-z]:[\\/]|\\\\|/users/|AdaLovelace|Alice|AppData|private manuscript line`)

func TestARedactedReportHoldsNoPathUserNameOrManuscriptText(t *testing.T) {
	encoded, page := render(t, sampleInput())
	for name, text := range map[string]string{"json": encoded, "html": page} {
		if found := absoluteOrPrivate.FindString(text); found != "" {
			t.Errorf("the redacted %s report holds %q", name, found)
		}
	}
	if !strings.Contains(encoded, "Could not be measured: open Chapter 03.mp3: not a RIFF/WAVE file") {
		t.Error("the failed file's reason should keep its file name in place of its path")
	}
	if !strings.Contains(encoded, `"note": "read from Chapter 01.wav"`) {
		t.Error("a path in evidence should become the file name")
	}
	if !strings.Contains(encoded, `"title": "Down the Rabbit-Hole"`) {
		t.Error("the chapter is always written")
	}
}

func TestIncludingPathsWritesEachFilesFullPathButNeverTheManuscriptText(t *testing.T) {
	in := sampleInput()
	in.Options.IncludePaths = true
	encoded, page := render(t, in)
	report := Build(in)
	if report.Files[0].Path != chapterOne || !report.Privacy.PathsIncluded {
		t.Fatalf("the first file's path = %q, paths included = %v", report.Files[0].Path, report.Privacy.PathsIncluded)
	}
	if !strings.Contains(page, `C:\Users\AdaLovelace\Renders\Alice\Chapter 01.wav`) || !strings.Contains(encoded, `AppData`) {
		t.Error("the paths the narrator chose to include are missing")
	}
	if strings.Contains(encoded+page, "private manuscript line") {
		t.Error("a manuscript excerpt is never written")
	}
}

func TestAPathNobodyNamedIsStillRemoved(t *testing.T) {
	scrub := newScrubber(Input{})
	for _, text := range []string{`failed at D:\Other\take.wav`, `see \\server\share\x.wav`, "under /Users/someone/x.wav", "at /home/someone/x.wav"} {
		if got := scrub.text(text); absoluteOrPrivate.MatchString(got) || !strings.Contains(got, removedPath) {
			t.Errorf("scrub(%q) = %q", text, got)
		}
	}
}

func TestEveryFileIsListedWithWhyItWasNotMeasuredOrChecked(t *testing.T) {
	report := Build(sampleInput())
	names := []string{}
	for _, file := range report.Files {
		names = append(names, file.Ref+" "+file.Name+" "+file.Status)
	}
	want := []string{"F1 Chapter 01.wav open_findings", "F2 Chapter 02.wav open_findings", "F3 Chapter 03.mp3 incomplete", "F4 Chapter 04.wav incomplete"}
	if strings.Join(names, "|") != strings.Join(want, "|") {
		t.Fatalf("files = %v, want %v", names, want)
	}
	three, four := report.Files[2], report.Files[3]
	if three.Measurement.Status != "failed" || three.Diagnostics.Status != "not_checked" || four.Measurement.Status != "not_measured" {
		t.Fatalf("file 3 = %+v, file 4 = %+v", three, four)
	}
	if four.Measurement.Reason == "" || three.Diagnostics.Reason == "" {
		t.Fatal("a file not measured or not checked says why")
	}
	s := report.Summary
	if s.Files != 4 || s.Measured != 2 || s.NotMeasured != 2 || s.Checked != 2 || s.NotChecked != 2 {
		t.Fatalf("summary = %+v", s)
	}
}

func TestMeasurementsAreJudgedByTheSameRulesAndIDsAsTheHost(t *testing.T) {
	in := sampleInput()
	report := Build(in)
	want := map[string]string{}
	for _, file := range in.Measured {
		if file.Report != nil {
			for _, f := range deliveryprofile.EvaluateFile(*file.Report, in.Profile).Findings {
				want[f.ID] = string(f.Severity)
			}
		}
	}
	got := map[string]string{}
	titles := []string{}
	for _, f := range report.Findings {
		if f.Category == string(findings.CategoryDeliveryQC) {
			got[f.ID] = f.Severity
			titles = append(titles, f.File+" "+f.Title)
		}
	}
	if len(want) != 3 || len(got) != len(want) {
		t.Fatalf("delivery_qc findings = %v, want the %v Evaluate raises", got, want)
	}
	for id, severity := range want {
		if got[id] != severity {
			t.Errorf("finding %s = %q, want %q", id, got[id], severity)
		}
	}
	slices.Sort(titles)
	wantTitles := "F1 Peak: advice|F1 Sample rate not one ACX accepts|F2 Sample rate not one ACX accepts"
	if strings.Join(titles, "|") != wantTitles {
		t.Errorf("titles = %v", titles)
	}
}

func TestAReviewDecisionFromTheStoreIsCarriedAndADismissalClosesTheFinding(t *testing.T) {
	in := sampleInput()
	clip := clipFinding(chapterOne, 612.25).ID
	in.Review = func(id string) (findings.ReviewState, bool) {
		if id == clip {
			return findings.ReviewState{Status: findings.StatusDismissed, Note: "intended, see " + chapterOne, Timestamp: "2026-09-23T15:00:00Z"}, true
		}
		return findings.ReviewState{}, false
	}
	report := Build(in)
	for _, f := range report.Findings {
		if f.ID != clip {
			continue
		}
		if f.Open || f.Review.Status != findings.StatusDismissed || f.Review.Note != "intended, see Chapter 01.wav" {
			t.Fatalf("the dismissed finding = %+v", f)
		}
	}
	if report.Summary.OpenFindings != 3 || report.Summary.ByReview["dismissed"] != 1 || report.Files[0].OpenFindings != 2 {
		t.Fatalf("summary = %+v, file 1 = %+v", report.Summary, report.Files[0])
	}
	in.Review, in.ReviewNote = nil, "No project is open, so there are no review decisions."
	if review := Build(in).Review; review.Available || review.Note == "" {
		t.Fatalf("without a store the report says why: %+v", review)
	}
}

func TestTheReportNamesTheProfileAndEveryRuleWithItsSourceAndResults(t *testing.T) {
	report := Build(sampleInput())
	profile := report.Profile
	if profile.Key != "acx@2026-09" || profile.Title != "ACX (September 2026)" || !profile.BuiltIn || !strings.HasPrefix(profile.SourceURL, "https://help.acx.com/") {
		t.Fatalf("profile = %+v", profile)
	}
	if len(profile.Rules) != len(deliveryprofile.ACX().Rules) {
		t.Fatalf("%d rules, want every rule of ACX", len(profile.Rules))
	}
	byID := map[string]ProfileRule{}
	for _, rule := range profile.Rules {
		if rule.Requirement == "" || rule.Verification == "" || rule.CheckedBy == "" {
			t.Errorf("rule %s lacks its requirement, verification or check: %+v", rule.ID, rule)
		}
		byID[rule.ID] = rule
	}
	if got := byID["acx.sample_rate"].Results; got.NotMet != 2 || got.Met != 0 {
		t.Errorf("sample rate results = %+v, want 2 not met (48 kHz renders)", got)
	}
	if got := byID["acx.rms"].Results; got.Met != 2 {
		t.Errorf("RMS results = %+v, want 2 met", got)
	}
	if got := byID["acx.format"].Results; got.NotChecked != 2 || got.Met != 0 {
		t.Errorf("MP3 results = %+v, want 2 not checked and never met", got)
	}
	if got := byID["acx.channels"].Results; got.Met != 1 {
		t.Errorf("channels (book) results = %+v, want met once for the book", got)
	}
	if report.Summary.FilesNotMet != 2 || report.Summary.RuleResults.NotMet != 2 || report.Summary.RuleResults.NotChecked != 6 {
		t.Errorf("summary = %+v", report.Summary)
	}
	for _, file := range report.Files {
		if file.Measurement.Status == "measured" && len(file.Measurement.Rules) != 8 {
			t.Errorf("%s has %d rule results, want one per file rule", file.Name, len(file.Measurement.Rules))
		}
		if file.Measurement.Rules == nil {
			t.Errorf("%s writes its rules as null, want a list", file.Name)
		}
	}
	if !strings.Contains(report.Notice, "never counts as met") {
		t.Errorf("the notice %q does not say a rule not checked never counts as met", report.Notice)
	}
}

func TestACustomProfileAndANoticeAreNamed(t *testing.T) {
	in := sampleInput()
	custom := deliveryprofile.ACX().Clone()
	custom.ID, custom.BuiltIn, custom.Revision, custom.Name, custom.BasedOn, custom.Version = "custom-1", false, 3, "My ACX", "acx@2026-09", ""
	custom.Rules[3].Off = true // sample rate
	in.Profile, in.ProfileNotice = custom, "The delivery profile this project chose is no longer there, so it is judged against the Global default."
	report := Build(in)
	if report.Profile.Key != "custom-1@r3" || report.Profile.BuiltIn || report.Profile.BasedOn != "acx@2026-09" || report.Profile.Notice == "" {
		t.Fatalf("profile = %+v", report.Profile)
	}
	for _, f := range report.Findings {
		if f.Category == string(findings.CategoryDeliveryQC) && strings.Contains(f.Title, "Sample rate") {
			t.Fatalf("a rule turned off raised %q", f.Title)
		}
	}
	_, page := render(t, in)
	if !strings.Contains(page, "Judged against My ACX") || !strings.Contains(page, "no longer there") {
		t.Fatal("the HTML does not name the custom profile and the notice")
	}
}

func TestInstalledAssetsAreListedByVersionOrTheReportSaysWhyNot(t *testing.T) {
	report := Build(sampleInput())
	if !report.Assets.Available || len(report.Assets.Items) != 2 || report.Assets.Items[0].Kind != "piper" || report.Assets.Items[1].Path != "" {
		t.Fatalf("assets = %+v", report.Assets)
	}
	in := sampleInput()
	in.AssetsNote = "The approved asset catalog is unavailable."
	report = Build(in)
	if report.Assets.Available || len(report.Assets.Items) != 0 || report.Assets.Note == "" {
		t.Fatalf("assets = %+v", report.Assets)
	}
}

func TestNothingCheckedSaysSoAndAFileNameIsEscapedInTheHTML(t *testing.T) {
	in := sampleInput()
	in.Checked, in.CheckNote = nil, "No diagnostics check has run in this session."
	in.Measured = []MeasuredFile{{Path: `C:\r\<script>alert(1)</script>.wav`, Name: "<script>alert(1)</script>.wav", Status: "cancelled"}}
	encoded, page := render(t, in)
	if strings.Contains(page, "<script>") || !strings.Contains(page, "&lt;script&gt;") {
		t.Error("a file name is written as text, never as markup")
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(encoded), &decoded); err != nil {
		t.Fatal(err)
	}
	if diagnostics := decoded["diagnostics"].(map[string]any); diagnostics["run"] != false || diagnostics["note"] != in.CheckNote {
		t.Fatalf("diagnostics = %v", diagnostics)
	}
}
