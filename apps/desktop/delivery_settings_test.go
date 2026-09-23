package main

import (
	"sort"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The number kind (docs/prds/diagnostics-delivery-and-cleanup-tools.prd.md Phase 2): a finite decimal written as plain
// text, inside the field's range and on its step. Any other feature's numeric setting uses the same kind.
func TestValidateNumberSettingAcceptsOnlyAPlainNumberInRangeAndOnStep(t *testing.T) {
	minimum, maximum, tenth, whole := -60.0, 0.0, 0.1, 1.0
	peak := numberSpec{min: &minimum, max: &maximum, step: &tenth, unit: "dBTP"}
	count := numberSpec{min: &maximum, step: &whole, unit: "words"}
	free := numberSpec{}
	cases := []struct {
		name    string
		spec    numberSpec
		value   string
		wantErr string
	}{
		{"a negative decimal", peak, "-3.5", ""},
		{"the minimum itself", peak, "-60", ""},
		{"the maximum itself", peak, "0", ""},
		{"a leading zero decimal", peak, "-0.1", ""},
		{"a value computed with float error still on step", peak, "-2.3", ""},
		{"empty", peak, "", "must be a number"},
		{"a word", peak, "loud", "must be a number"},
		{"a unit suffix", peak, "-3 dB", "must be a number"},
		{"surrounding space", peak, " -3", "must be a number"},
		{"an exponent", peak, "-3e0", "must be a number"},
		{"a hex float", peak, "0x1p-2", "must be a number"},
		{"NaN", peak, "NaN", "must be a number"},
		{"Inf", peak, "Inf", "must be a number"},
		{"a plus sign", peak, "+1", "must be a number"},
		{"a comma decimal", peak, "-3,5", "must be a number"},
		{"below the minimum", peak, "-60.1", "between -60 and 0 dBTP"},
		{"above the maximum", peak, "0.5", "between -60 and 0 dBTP"},
		{"off the step", peak, "-3.25", "in steps of 0.1"},
		{"a whole count", count, "3", ""},
		{"a fractional count", count, "2.5", "in steps of 1"},
		{"a count below its minimum", count, "-1", "at least 0 words"},
		{"no range at all", free, "123456.789", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateNumberSetting("limit", tc.spec, tc.value)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("validateNumberSetting(%q) = %v, want no error", tc.value, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) || !strings.Contains(err.Error(), "limit") {
				t.Fatalf("validateNumberSetting(%q) = %v, want an error naming the setting and containing %q", tc.value, err, tc.wantErr)
			}
		})
	}
}

// Every number field declares its range, and every declared range belongs to a number field, so a field can never
// reach the page (or a save) without the bounds that validate it.
func TestEveryNumberFieldHasARangeAndEveryRangeAField(t *testing.T) {
	for tool, schemas := range fieldSchemas {
		for _, schema := range schemas {
			_, declared := numberSpecs[tool][schema.key]
			if schema.kind == "number" && !declared {
				t.Errorf("%s.%s is a number field with no numberSpecs entry", tool, schema.key)
			}
			if schema.kind != "number" && declared {
				t.Errorf("%s.%s has a numberSpecs entry but kind %q", tool, schema.key, schema.kind)
			}
		}
	}
	for tool, specs := range numberSpecs {
		for key := range specs {
			if _, ok := schemaFor(tool, key); !ok {
				t.Errorf("numberSpecs names %s.%s, which is not a field", tool, key)
			}
		}
	}
}

// The Delivery section is exactly the limits measure.ProfileFromLimits reads: a field it did not read would be a setting
// that changes nothing, and a limit with no field could only be set by hand-editing a file.
func TestTheDeliveryFieldsAreTheMeasurementLimits(t *testing.T) {
	var fields []string
	for _, schema := range fieldSchemas["Delivery"] {
		fields = append(fields, schema.key)
	}
	keys := measure.LimitKeys()
	sort.Strings(fields)
	sort.Strings(keys)
	if strings.Join(fields, ",") != strings.Join(keys, ",") {
		t.Fatalf("Delivery fields = %v, measure.LimitKeys() = %v", fields, keys)
	}
}

func TestTheDeliverySectionShipsNoLimitsSoAnEmptyProfileRaisesNothing(t *testing.T) {
	host := newTestHostForDeliverySettings(t, t.TempDir())
	profile, err := measure.ProfileFromLimits("narrator limits", effectiveValues(host, "Delivery"))
	if err != nil {
		t.Fatal(err)
	}
	if profile.HasLimits() {
		t.Fatalf("profile = %+v, want no limits: no distributor numbers ship (ADR 0025)", profile)
	}
	if got := measure.Evaluate(measure.Report{File: "chapter-01.wav"}, profile); len(got) != 0 {
		t.Fatalf("Evaluate() = %+v, want nothing", got)
	}
}

func TestSettingsForScopeSendsTheRangeOfANumberField(t *testing.T) {
	host := newTestHostForDeliverySettings(t, t.TempDir())
	result, err := host.settingsForScope("global")
	if err != nil {
		t.Fatal(err)
	}
	fields, _ := result["Delivery"].([]map[string]any)
	var peak map[string]any
	for _, field := range fields {
		if field["key"] == "true_peak_dbtp_max" {
			peak = field
		}
	}
	if peak == nil || peak["kind"] != "number" {
		t.Fatalf("Delivery fields = %v, want true_peak_dbtp_max as a number", fields)
	}
	number, _ := peak["number"].(map[string]any)
	if number["unit"] != "dBTP" || number["step"] != 0.1 || number["min"] == nil || number["max"] == nil {
		t.Fatalf("number = %v, want its range, step and unit", peak["number"])
	}
	general, _ := result["General"].([]map[string]any)
	if _, ok := general[0]["number"]; ok {
		t.Fatalf("a non-number field must not carry a range: %v", general[0])
	}
}

func TestSavingADeliveryLimitValidatesItAndStoresIt(t *testing.T) {
	host := newTestHostForDeliverySettings(t, t.TempDir())
	if err := host.saveSettings("Delivery", "global", map[string]*string{"true_peak_dbtp_max": ptr("loud")}); err == nil || !strings.Contains(err.Error(), "must be a number") {
		t.Fatalf("saveSettings(loud) = %v, want a non-numeric value rejected", err)
	}
	if err := host.saveSettings("Delivery", "global", map[string]*string{"true_peak_dbtp_max": ptr("-3")}); err != nil {
		t.Fatal(err)
	}
	if value, source := host.settings.Effective("Delivery", "true_peak_dbtp_max", ""); value != "-3" || source != "global" {
		t.Fatalf("Effective() = %q from %s, want -3 from global", value, source)
	}
	// A null clears a global limit (Save keeps it as the explicit JSON null reset), so it reads as no limit again.
	if err := host.saveSettings("Delivery", "global", map[string]*string{"true_peak_dbtp_max": nil}); err != nil {
		t.Fatal(err)
	}
	if value, _ := host.settings.Effective("Delivery", "true_peak_dbtp_max", ""); value != "" {
		t.Fatalf("Effective() = %q after clearing, want no limit", value)
	}
}

func TestSavingAMinimumAboveItsMaximumIsRejectedAcrossTheLayers(t *testing.T) {
	host := newTestHostForDeliverySettings(t, t.TempDir())
	if err := host.saveSettings("Delivery", "global", map[string]*string{"rms_dbfs_min": ptr("-18"), "rms_dbfs_max": ptr("-23")}); err == nil || !strings.Contains(err.Error(), "RMS level") {
		t.Fatalf("saveSettings() = %v, want min above max rejected by name", err)
	}
	if err := host.saveSettings("Delivery", "global", map[string]*string{"rms_dbfs_min": ptr("-23")}); err != nil {
		t.Fatal(err)
	}
	// The project's maximum is compared with the global minimum it would sit on top of.
	if err := host.saveSettings("Delivery", "project", map[string]*string{"rms_dbfs_max": ptr("-30")}); err == nil || !strings.Contains(err.Error(), "above") {
		t.Fatalf("saveSettings(project max below global min) = %v, want it rejected", err)
	}
	if err := host.saveSettings("Delivery", "project", map[string]*string{"rms_dbfs_max": ptr("-18")}); err != nil {
		t.Fatal(err)
	}
	// And a global change is compared with the project override that stays on top of it.
	if err := host.saveSettings("Delivery", "global", map[string]*string{"rms_dbfs_min": ptr("-10")}); err == nil {
		t.Fatal("a global minimum above the open project's maximum must be rejected")
	}
	// Removing the project override leaves the global minimum alone, which is valid.
	if err := host.saveSettings("Delivery", "project", map[string]*string{"rms_dbfs_max": nil}); err != nil {
		t.Fatal(err)
	}
}

// The success signal of Phase 2: a project override beats the global value, which beats the repository default.
func TestTheDeliveryProfileTakesProjectThenGlobalThenDefault(t *testing.T) {
	host := newTestHostForDeliverySettings(t, t.TempDir())
	if err := host.saveSettings("Delivery", "global", map[string]*string{"true_peak_dbtp_max": ptr("-3"), "noise_floor_dbfs_max": ptr("-60")}); err != nil {
		t.Fatal(err)
	}
	if err := host.saveSettings("Delivery", "project", map[string]*string{"true_peak_dbtp_max": ptr("-1.5")}); err != nil {
		t.Fatal(err)
	}
	profile, err := measure.ProfileFromLimits("narrator limits", effectiveValues(host, "Delivery"))
	if err != nil {
		t.Fatal(err)
	}
	if profile.TruePeakdBTP.Max == nil || *profile.TruePeakdBTP.Max != -1.5 {
		t.Errorf("true peak max = %v, want the project's -1.5", profile.TruePeakdBTP.Max)
	}
	if profile.NoiseFloordBFS.Max == nil || *profile.NoiseFloordBFS.Max != -60 {
		t.Errorf("noise floor max = %v, want the global -60", profile.NoiseFloordBFS.Max)
	}
	if profile.IntegratedLUFS.Min != nil || profile.IntegratedLUFS.Max != nil {
		t.Errorf("loudness = %+v, want no limit (the default is none)", profile.IntegratedLUFS)
	}
}

func newTestHostForDeliverySettings(t *testing.T, projectFolder string) *Host {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := &Host{settings: settings.New(t.TempDir(), projectFolder)}
	host.config.projectFolder = projectFolder
	return host
}

func effectiveValues(host *Host, tool string) map[string]string {
	values := map[string]string{}
	for _, schema := range fieldSchemas[tool] {
		values[schema.key], _ = host.settings.Effective(tool, schema.key, "")
	}
	return values
}
