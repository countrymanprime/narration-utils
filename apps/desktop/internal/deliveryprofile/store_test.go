package deliveryprofile

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), FileName)
	store := NewStore(path)
	store.SetPersist(&persist.Reporter{})
	return store, path
}

func TestANewStoreOffersTheBuiltInsWithACXAsTheDefaultAndWritesNothing(t *testing.T) {
	store, path := newTestStore(t)
	catalog, err := store.Catalog()
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Profiles) != 1 || catalog.Profiles[0].Key() != "acx@2026-09" || catalog.Default != (Ref{ID: "acx", Version: "2026-09"}) {
		t.Fatalf("catalog = %d profiles, default %+v; want ACX only, and ACX the default", len(catalog.Profiles), catalog.Default)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("reading the catalog wrote %s (err %v)", path, err)
	}
}

func TestDuplicateEditAndDeleteACustomProfile(t *testing.T) {
	store, _ := newTestStore(t)
	copied, err := store.Duplicate(Ref{ID: "acx"})
	if err != nil {
		t.Fatal(err)
	}
	if copied.BuiltIn || copied.BasedOn != "acx@2026-09" || copied.Revision != 1 || copied.Name != "ACX (September 2026) copy" || !strings.HasPrefix(copied.ID, "custom-") {
		t.Fatalf("duplicate = %+v, want a custom revision 1 copy based on acx@2026-09", copied)
	}
	edited := copied.Clone()
	edited.Name = "My ACX, tighter peak"
	*edited.Rules[1].Max = -3.5
	edited.Rules[5].Off = true
	edited.Rules[3].OneOf = []float64{48000} // not adjustable: ignored
	saved, err := store.Save(edited)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 2 || saved.Name != "My ACX, tighter peak" || *saved.Rules[1].Max != -3.5 || !saved.Rules[5].Off || saved.Rules[3].OneOf[0] != 44100 {
		t.Fatalf("saved = %+v, want revision 2 with the new name, peak and room tone off, sample rate unchanged", saved)
	}
	resolved, found, err := store.Resolve(Ref{ID: saved.ID})
	if err != nil || !found || resolved.Revision != 2 {
		t.Fatalf("Resolve = %+v %v %v, want the latest revision", resolved.Key(), found, err)
	}
	if _, err := store.SetDefault(Ref{ID: saved.ID}); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(saved.ID); err != nil {
		t.Fatal(err)
	}
	catalog, _ := store.Catalog()
	if len(catalog.Profiles) != 1 || catalog.Default.ID != "acx" {
		t.Fatalf("after deleting the default: %d profiles, default %+v; want ACX only and the default back to ACX", len(catalog.Profiles), catalog.Default)
	}
	if _, found, _ := store.Resolve(Ref{ID: saved.ID}); found {
		t.Fatal("a deleted profile still resolves")
	}
}

func TestAnEditCannotAddDropOrReshapeARuleOrChangeABuiltIn(t *testing.T) {
	store, _ := newTestStore(t)
	copied, _ := store.Duplicate(Ref{ID: "acx"})
	cases := map[string]func(p *Profile){
		"a dropped rule":         func(p *Profile) { p.Rules = p.Rules[1:] },
		"a renamed rule":         func(p *Profile) { p.Rules[0].ID = "acx.other" },
		"an added bound":         func(p *Profile) { p.Rules[1].Min = v(-40) },
		"a lowest above highest": func(p *Profile) { p.Rules[0].Min = v(-10) },
		"an empty name":          func(p *Profile) { p.Name = "  " },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			edited := copied.Clone()
			change(&edited)
			if _, err := store.Save(edited); err == nil {
				t.Fatal("the edit was saved")
			}
		})
	}
	builtIn := ACX()
	if _, err := store.Save(builtIn); err == nil || !strings.Contains(err.Error(), "built-in") {
		t.Fatalf("saving ACX = %v, want a refusal", err)
	}
	if err := store.Delete("acx"); err == nil {
		t.Fatal("ACX was deleted")
	}
}

func TestATamperedFileIsReportedAndTheBuiltInsStillWork(t *testing.T) {
	store, path := newTestStore(t)
	copied, _ := store.Duplicate(Ref{ID: "acx"})
	raw, _ := os.ReadFile(path)
	var file map[string]any
	_ = json.Unmarshal(raw, &file)
	file["profiles"].([]any)[0].(map[string]any)["rules"].([]any)[0].(map[string]any)["metric"] = "rm -rf"
	tampered, _ := json.Marshal(file)
	if err := os.WriteFile(path, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := store.Resolve(Ref{ID: copied.ID}); found {
		t.Fatal("a profile from a tampered file was used")
	}
	if profile, found, err := store.Resolve(Ref{ID: "acx", Version: "2026-09"}); err != nil || !found || profile.Key() != "acx@2026-09" {
		t.Fatalf("ACX = %s %v %v, want it to resolve", profile.Key(), found, err)
	}
}

// oldJudgement is how the old limits judged a report (measure.Evaluate before ADR 0179): per metric, above or below.
func oldJudgement(limits map[string]string, report measure.Report) map[string]string {
	parsed, _ := ParseLegacyLimits(limits)
	values := map[string]*float64{
		"integrated_lufs": report.IntegratedLUFS, "rms_dbfs": report.RMSdBFS, "sample_peak_dbfs": report.SamplePeakdBFS,
		"true_peak_dbtp": report.TruePeakdBTP, "noise_floor_dbfs": report.NoiseFloordBFS,
	}
	out := map[string]string{}
	for metric, value := range values {
		low, high := parsed[metric+"_min"], parsed[metric+"_max"]
		if metric == "true_peak_dbtp" {
			high = parsed["true_peak_dbtp_max"]
		}
		switch {
		case (low != nil || high != nil) && !finite(value):
			out[metric] = "unavailable"
		case high != nil && *value > *high:
			out[metric] = ViolationAboveMax
		case low != nil && *value < *low:
			out[metric] = ViolationBelowMin
		}
	}
	return out
}

// newJudgement is how a profile judges the same levels: per metric, from its findings.
func newJudgement(profile Profile, report measure.Report) map[string]string {
	out := map[string]string{}
	for _, finding := range EvaluateFile(report, profile).Findings {
		metric, _ := finding.Evidence["metric"].(string)
		if _, isLevel := map[string]bool{"integrated_lufs": true, "rms_dbfs": true, "sample_peak_dbfs": true, "true_peak_dbtp": true, "noise_floor_dbfs": true}[metric]; !isLevel {
			continue
		}
		if violation, ok := finding.Evidence["violation"].(string); ok {
			out[metric] = violation
		} else {
			out[metric] = "unavailable"
		}
	}
	return out
}

func TestMovedLimitsJudgeTheLevelsExactlyAsBefore(t *testing.T) {
	sets := map[string]map[string]string{
		"rms only":            {"rms_dbfs_min": "-25"},
		"true peak and lufs":  {"true_peak_dbtp_max": "-3.5", "integrated_lufs_min": "-21", "integrated_lufs_max": "-17"},
		"everything":          {"integrated_lufs_min": "-22", "integrated_lufs_max": "-16", "rms_dbfs_min": "-24", "rms_dbfs_max": "-17", "sample_peak_dbfs_max": "-2", "true_peak_dbtp_max": "-1", "noise_floor_dbfs_max": "-55"},
		"acx and a true peak": {"rms_dbfs_min": "-23", "rms_dbfs_max": "-18", "sample_peak_dbfs_max": "-3", "noise_floor_dbfs_max": "-60", "true_peak_dbtp_max": "-3"},
	}
	reports := []measure.Report{
		passingReport(),
		{File: "loud.wav", SampleRate: 44100, Channels: 1, DurationSeconds: 60, IntegratedLUFS: v(-12), RMSdBFS: v(-14), SamplePeakdBFS: v(-0.5), TruePeakdBTP: v(0.3), NoiseFloordBFS: v(-50)},
		{File: "quiet.wav", SampleRate: 44100, Channels: 1, DurationSeconds: 60, IntegratedLUFS: v(-30), RMSdBFS: v(-33), SamplePeakdBFS: v(-12), TruePeakdBTP: v(-11.5), NoiseFloordBFS: v(-80)},
		{File: "silent.wav", SampleRate: 44100, Channels: 1, DurationSeconds: 2},
	}
	for name, limits := range sets {
		t.Run(name, func(t *testing.T) {
			parsed, err := ParseLegacyLimits(limits)
			if err != nil {
				t.Fatal(err)
			}
			profile := parsed.Profile("Your limits")
			if err := validateProfile(profile); err != nil {
				t.Fatalf("the moved profile is not valid: %v", err)
			}
			for _, report := range reports {
				before, after := oldJudgement(limits, report), newJudgement(profile, report)
				if len(before) != len(after) {
					t.Fatalf("%s: before %v, after %v", report.File, before, after)
				}
				for metric, verdict := range before {
					if after[metric] != verdict {
						t.Errorf("%s %s: before %s, after %s", report.File, metric, verdict, after[metric])
					}
				}
			}
		})
	}
}

func TestTheGlobalLimitsMoveOnce(t *testing.T) {
	cases := []struct {
		name        string
		values      map[string]string
		wantDefault string
		wantMade    bool
		wantErr     bool
	}{
		{"none set", map[string]string{}, "acx", false, false},
		{"acx's numbers", map[string]string{"rms_dbfs_min": "-23", "rms_dbfs_max": "-18", "sample_peak_dbfs_max": "-3", "noise_floor_dbfs_max": "-60"}, "acx", false, false},
		{"their own", map[string]string{"rms_dbfs_min": "-24", "true_peak_dbtp_max": "-3.5"}, "custom-", true, false},
		{"a hand-edited word", map[string]string{"rms_dbfs_min": "loud"}, "acx", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store, _ := newTestStore(t)
			made, err := store.MoveGlobalLimits(tc.values)
			if (err != nil) != tc.wantErr || (made != nil) != tc.wantMade {
				t.Fatalf("MoveGlobalLimits = %v, %v; want made %v, error %v", made, err, tc.wantMade, tc.wantErr)
			}
			catalog, _ := store.Catalog()
			if !strings.HasPrefix(catalog.Default.ID, tc.wantDefault) {
				t.Fatalf("default = %+v, want %s", catalog.Default, tc.wantDefault)
			}
			if made != nil && (made.Name != "Your limits" || made.Note == "") {
				t.Errorf("made %q (%q), want \"Your limits\" noting where it came from", made.Name, made.Note)
			}
			again, _ := store.MoveGlobalLimits(map[string]string{"rms_dbfs_min": "-30"})
			if !tc.wantErr && again != nil {
				t.Fatal("the Global limits moved a second time")
			}
		})
	}
}

func TestAProjectsOwnLimitsChooseItsProfile(t *testing.T) {
	store, _ := newTestStore(t)
	acxNumbers := map[string]string{"rms_dbfs_min": "-23", "rms_dbfs_max": "-18", "sample_peak_dbfs_max": "-3", "noise_floor_dbfs_max": "-60"}
	if ref, err := store.ChooseForLegacyLimits(acxNumbers, "Alice"); err != nil || ref != (Ref{ID: "acx", Version: "2026-09"}) {
		t.Fatalf("ACX's numbers chose %+v %v, want ACX", ref, err)
	}
	own := map[string]string{"rms_dbfs_min": "-26"}
	first, err := store.ChooseForLegacyLimits(own, "Alice")
	if err != nil || !strings.HasPrefix(first.ID, "custom-") {
		t.Fatalf("own limits chose %+v %v, want a new custom profile", first, err)
	}
	second, _ := store.ChooseForLegacyLimits(own, "Bob")
	if second != first {
		t.Fatalf("a second project with the same limits chose %+v, want the first's %+v", second, first)
	}
	profile, _, _ := store.Resolve(first)
	if profile.Name != "Your limits (Alice)" {
		t.Fatalf("the moved profile is named %q", profile.Name)
	}
	if _, err := store.ChooseForLegacyLimits(map[string]string{"rms_dbfs_min": "-10", "rms_dbfs_max": "-20"}, "Carol"); err == nil {
		t.Fatal("a lowest above its highest was moved")
	}
}
