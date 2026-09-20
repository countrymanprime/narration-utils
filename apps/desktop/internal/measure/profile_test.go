package measure

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

func ptr(v float64) *float64 { return &v }

// testProfile is invented for these tests. It is not any distributor's
// specification: no real profile ships until its rules are independently
// specified and validated.
func testProfile() Profile {
	return Profile{
		Name:           "test-profile",
		RMSdBFS:        Limit{Min: ptr(-23), Max: ptr(-18)},
		TruePeakdBTP:   Limit{Max: ptr(-3)},
		NoiseFloordBFS: Limit{Max: ptr(-60)},
	}
}

func compliantReport() Report {
	return Report{
		File:           "chapter-01.wav",
		RMSdBFS:        ptr(-20),
		TruePeakdBTP:   ptr(-4),
		NoiseFloordBFS: ptr(-65),
		IntegratedLUFS: ptr(-19),
	}
}

func TestEvaluateReturnsNothingForACompliantReport(t *testing.T) {
	if got := Evaluate(compliantReport(), testProfile()); len(got) != 0 {
		t.Fatalf("got %d findings, want none: %+v", len(got), got)
	}
}

func TestEvaluateFlagsEachViolatedLimitWithEvidence(t *testing.T) {
	tests := []struct {
		name      string
		mutate    func(*Report)
		metric    string
		violation string
		value     float64
	}{
		{"RMS too loud", func(r *Report) { r.RMSdBFS = ptr(-15) }, "rms_dbfs", "above_max", -15},
		{"RMS too quiet", func(r *Report) { r.RMSdBFS = ptr(-30) }, "rms_dbfs", "below_min", -30},
		{"true peak too high", func(r *Report) { r.TruePeakdBTP = ptr(-1) }, "true_peak_dbtp", "above_max", -1},
		{"noise floor too high", func(r *Report) { r.NoiseFloordBFS = ptr(-50) }, "noise_floor_dbfs", "above_max", -50},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := compliantReport()
			tt.mutate(&report)

			got := Evaluate(report, testProfile())
			if len(got) != 1 {
				t.Fatalf("got %d findings, want 1: %+v", len(got), got)
			}
			f := got[0]
			if err := f.Validate(); err != nil {
				t.Fatalf("finding is invalid: %v", err)
			}
			if f.Category != findings.CategoryDeliveryQC || f.Severity != findings.SeverityError {
				t.Errorf("category/severity = %s/%s", f.Category, f.Severity)
			}
			if f.Analyzer != "measure" || f.Source.File != "chapter-01.wav" {
				t.Errorf("analyzer/source = %q/%q", f.Analyzer, f.Source.File)
			}
			if f.Evidence["metric"] != tt.metric || f.Evidence["violation"] != tt.violation || f.Evidence["value"] != tt.value {
				t.Errorf("evidence = %+v", f.Evidence)
			}
			if f.Evidence["profile"] != "test-profile" {
				t.Errorf("evidence must name the profile: %+v", f.Evidence)
			}
			if f.Review.Status != findings.StatusUnreviewed {
				t.Errorf("review = %s, want unreviewed", f.Review.Status)
			}
			if f.SuggestedAction != nil {
				t.Errorf("a measurement cannot propose an audio edit: %+v", f.SuggestedAction)
			}
		})
	}
}

func TestEvaluateTreatsLimitsAsInclusive(t *testing.T) {
	report := compliantReport()
	report.RMSdBFS = ptr(-23)
	report.TruePeakdBTP = ptr(-3)
	if got := Evaluate(report, testProfile()); len(got) != 0 {
		t.Fatalf("values exactly on a limit must pass, got %+v", got)
	}
}

func TestEvaluateReportsAnUnavailableMeasurementInsteadOfPassingIt(t *testing.T) {
	report := compliantReport()
	report.NoiseFloordBFS = nil // e.g. the file was shorter than one window

	got := Evaluate(report, testProfile())
	if len(got) != 1 {
		t.Fatalf("got %d findings, want 1: %+v", len(got), got)
	}
	f := got[0]
	if err := f.Validate(); err != nil {
		t.Fatalf("finding is invalid: %v", err)
	}
	if f.Severity != findings.SeverityInfo || f.Evidence["available"] != false || f.Evidence["metric"] != "noise_floor_dbfs" {
		t.Fatalf("finding = %+v", f)
	}
}

func TestEvaluateIgnoresMetricsTheProfileDoesNotLimit(t *testing.T) {
	report := compliantReport()
	report.IntegratedLUFS = nil // testProfile sets no loudness limit
	if got := Evaluate(report, testProfile()); len(got) != 0 {
		t.Fatalf("an unlimited metric must not raise findings: %+v", got)
	}
}

func TestEvaluateIDsAreStableAndDistinctPerMetric(t *testing.T) {
	report := compliantReport()
	report.RMSdBFS = ptr(-15)
	report.TruePeakdBTP = ptr(-1)

	first := Evaluate(report, testProfile())
	second := Evaluate(report, testProfile())
	if len(first) != 2 || len(second) != 2 {
		t.Fatalf("want 2 findings each run, got %d and %d", len(first), len(second))
	}
	for i := range first {
		if first[i].ID != second[i].ID {
			t.Errorf("finding %d ID changed between runs", i)
		}
	}
	if first[0].ID == first[1].ID {
		t.Error("different metrics must get different IDs")
	}

	otherFile := report
	otherFile.File = "chapter-02.wav"
	if Evaluate(otherFile, testProfile())[0].ID == first[0].ID {
		t.Error("the same metric on a different file must get a different ID")
	}
}

func TestEvaluateSupportsLoudnessLimits(t *testing.T) {
	profile := Profile{Name: "loudness-only", IntegratedLUFS: Limit{Min: ptr(-24), Max: ptr(-22)}}
	report := Report{File: "a.wav", IntegratedLUFS: ptr(-19)}
	got := Evaluate(report, profile)
	if len(got) != 1 || got[0].Evidence["metric"] != "integrated_lufs" {
		t.Fatalf("got %+v", got)
	}
}

func TestEvaluateTreatsNonFiniteMeasurementsAsUnavailableNotAsPassing(t *testing.T) {
	for name, bad := range map[string]float64{"NaN": math.NaN(), "+Inf": math.Inf(1)} {
		t.Run(name, func(t *testing.T) {
			report := compliantReport()
			report.TruePeakdBTP = ptr(bad)

			got := Evaluate(report, testProfile())
			if len(got) != 1 || got[0].Evidence["available"] != false {
				t.Fatalf("got %+v, want one unavailable finding", got)
			}
			if _, err := json.Marshal(got[0]); err != nil {
				t.Fatalf("finding must marshal: %v", err)
			}
		})
	}
}
