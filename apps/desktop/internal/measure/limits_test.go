package measure

import (
	"strings"
	"testing"
)

func TestProfileFromLimitsWithNothingSetHasNoLimitsAndRaisesNothing(t *testing.T) {
	for name, values := range map[string]map[string]string{
		"no section":      nil,
		"empty section":   {},
		"every key blank": {"integrated_lufs_min": "", "true_peak_dbtp_max": ""},
	} {
		t.Run(name, func(t *testing.T) {
			profile, err := ProfileFromLimits("narrator limits", values)
			if err != nil {
				t.Fatalf("ProfileFromLimits() = %v, want no error", err)
			}
			if profile.HasLimits() {
				t.Fatalf("profile = %+v, want no limits", profile)
			}
			// Even a report with nothing measured raises nothing: no limit means no check, not "unavailable".
			if got := Evaluate(Report{File: "chapter-01.wav"}, profile); len(got) != 0 {
				t.Fatalf("Evaluate() = %+v, want no findings", got)
			}
		})
	}
}

func TestProfileFromLimitsReadsEveryLimitKey(t *testing.T) {
	values := map[string]string{
		"integrated_lufs_min":  "-23",
		"integrated_lufs_max":  "-18",
		"rms_dbfs_min":         "-23",
		"rms_dbfs_max":         "-18",
		"sample_peak_dbfs_max": "-1.5",
		"true_peak_dbtp_max":   "-3",
		"noise_floor_dbfs_max": "-60",
	}
	profile, err := ProfileFromLimits("narrator limits", values)
	if err != nil {
		t.Fatal(err)
	}
	check := func(name string, got *float64, want float64) {
		t.Helper()
		if got == nil || *got != want {
			t.Errorf("%s = %v, want %v", name, got, want)
		}
	}
	check("IntegratedLUFS.Min", profile.IntegratedLUFS.Min, -23)
	check("IntegratedLUFS.Max", profile.IntegratedLUFS.Max, -18)
	check("RMSdBFS.Min", profile.RMSdBFS.Min, -23)
	check("RMSdBFS.Max", profile.RMSdBFS.Max, -18)
	check("SamplePeakdBFS.Max", profile.SamplePeakdBFS.Max, -1.5)
	check("TruePeakdBTP.Max", profile.TruePeakdBTP.Max, -3)
	check("NoiseFloordBFS.Max", profile.NoiseFloordBFS.Max, -60)
	if profile.Name != "narrator limits" || !profile.HasLimits() {
		t.Errorf("profile = %+v", profile)
	}
	// Every key the builder reads is one LimitKeys names, so the settings schema can be checked against it.
	keys := map[string]bool{}
	for _, key := range LimitKeys() {
		keys[key] = true
	}
	for key := range values {
		if !keys[key] {
			t.Errorf("LimitKeys() does not list %s", key)
		}
	}
	if len(keys) != len(values) {
		t.Errorf("LimitKeys() = %v, want exactly the %d keys read here", LimitKeys(), len(values))
	}
}

func TestProfileFromLimitsRejectsAValueThatIsNotAFiniteNumber(t *testing.T) {
	for _, bad := range []string{"loud", "NaN", "Inf", "-Inf", "1e400", "-3 dB"} {
		t.Run(bad, func(t *testing.T) {
			_, err := ProfileFromLimits("p", map[string]string{"true_peak_dbtp_max": bad})
			if err == nil || !strings.Contains(err.Error(), "true_peak_dbtp_max") {
				t.Fatalf("ProfileFromLimits(%q) = %v, want an error naming the key", bad, err)
			}
		})
	}
}

func TestProfileFromLimitsRejectsAMinimumAboveItsMaximum(t *testing.T) {
	_, err := ProfileFromLimits("p", map[string]string{"rms_dbfs_min": "-18", "rms_dbfs_max": "-23"})
	if err == nil || !strings.Contains(err.Error(), "rms_dbfs_min") || !strings.Contains(err.Error(), "rms_dbfs_max") {
		t.Fatalf("ProfileFromLimits() = %v, want an error naming both keys", err)
	}
	if _, err := ProfileFromLimits("p", map[string]string{"rms_dbfs_min": "-20", "rms_dbfs_max": "-20"}); err != nil {
		t.Fatalf("an equal minimum and maximum is a valid (if strict) limit: %v", err)
	}
}

func TestProfileFromLimitsIgnoresKeysItDoesNotKnow(t *testing.T) {
	profile, err := ProfileFromLimits("p", map[string]string{"clipping_ceiling": "loud"})
	if err != nil || profile.HasLimits() {
		t.Fatalf("got %+v, %v; want an empty profile and no error", profile, err)
	}
}

func TestEvaluateChecksTheSamplePeakLimit(t *testing.T) {
	profile := Profile{Name: "peak-only", SamplePeakdBFS: Limit{Max: ptr(-1)}}
	got := Evaluate(Report{File: "a.wav", SamplePeakdBFS: ptr(-0.5)}, profile)
	if len(got) != 1 || got[0].Evidence["metric"] != "sample_peak_dbfs" || got[0].Evidence["violation"] != "above_max" {
		t.Fatalf("got %+v, want one sample peak violation", got)
	}
	if got := Evaluate(Report{File: "a.wav", SamplePeakdBFS: ptr(-1)}, profile); len(got) != 0 {
		t.Fatalf("a sample peak exactly on the limit must pass: %+v", got)
	}
	unavailable := Evaluate(Report{File: "a.wav"}, profile)
	if len(unavailable) != 1 || unavailable[0].Evidence["available"] != false {
		t.Fatalf("got %+v, want one unavailable finding", unavailable)
	}
}
