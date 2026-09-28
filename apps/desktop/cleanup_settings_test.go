package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The silence cleanup analyzer's own thresholds (diagnostics-delivery-and-cleanup-tools.prd.md Phase 9 remainder,
// ADR 0238 decision 4): a narrator's settings resolve to measure.CleanupOptions the same way coverageSettings
// resolves the recording check's, with config/defaults.json seeding every key so an untouched store still answers
// measure.DefaultCleanupOptions.

func TestCleanupSettingsWithNothingSetAnswersTheDefaults(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never read the real machine's global-settings.json
	store := settings.New(t.TempDir(), "")
	if got := cleanupSettings(store); got != measure.DefaultCleanupOptions() {
		t.Fatalf("cleanupSettings = %+v, want the defaults %+v", got, measure.DefaultCleanupOptions())
	}
}

func TestCleanupSettingsReadsANarratorsOwnValues(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	store := settings.New(t.TempDir(), "")
	if err := store.Save(cleanupSettingsTool, "global", map[string]*string{
		settingCleanupPadSeconds:          strPtr("0.2"),
		settingCleanupMinBreathSeconds:    strPtr("0.1"),
		settingCleanupMaxBreathSeconds:    strPtr("1.2"),
		settingCleanupBreathBelowSpeechDB: strPtr("10"),
		settingCleanupClickAboveSilenceDB: strPtr("25"),
	}); err != nil {
		t.Fatal(err)
	}
	want := measure.CleanupOptions{PadSeconds: 0.2, MinBreathSeconds: 0.1, MaxBreathSeconds: 1.2, BreathBelowSpeechDB: 10, ClickAboveSilenceDB: 25}
	if got := cleanupSettings(store); got != want {
		t.Fatalf("cleanupSettings = %+v, want %+v", got, want)
	}
}

// A project override beats the global value, which beats the repo default, like every other layered setting.
func TestCleanupSettingsLayersProjectOverGlobalOverDefault(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	store := settings.New(t.TempDir(), t.TempDir())
	if err := store.Save(cleanupSettingsTool, "global", map[string]*string{settingCleanupPadSeconds: strPtr("0.3")}); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(cleanupSettingsTool, "project", map[string]*string{settingCleanupPadSeconds: strPtr("0.4")}); err != nil {
		t.Fatal(err)
	}
	if got := cleanupSettings(store).PadSeconds; got != 0.4 {
		t.Fatalf("pad_seconds = %v, want the project's own 0.4", got)
	}
}

// A value that is missing, not a number, or out of CleanupOptions.resolve's own per-field range degrades to that
// one field's default instead of failing the whole set (a hand-edited or corrupt settings file, the same rule
// coverage.ResolveSettings follows) - so one bad field never breaks every other threshold.
func TestCleanupSettingsFallsBackFieldByFieldOnAnInvalidValue(t *testing.T) {
	defaults := measure.DefaultCleanupOptions()
	cases := map[string]struct {
		key   string
		raw   string
		field func(measure.CleanupOptions) float64
	}{
		"pad_seconds not a number":         {settingCleanupPadSeconds, "not a number", func(o measure.CleanupOptions) float64 { return o.PadSeconds }},
		"pad_seconds out of range":         {settingCleanupPadSeconds, "5", func(o measure.CleanupOptions) float64 { return o.PadSeconds }},
		"pad_seconds negative":             {settingCleanupPadSeconds, "-0.1", func(o measure.CleanupOptions) float64 { return o.PadSeconds }},
		"min_breath_seconds zero":          {settingCleanupMinBreathSeconds, "0", func(o measure.CleanupOptions) float64 { return o.MinBreathSeconds }},
		"min_breath_seconds not a number":  {settingCleanupMinBreathSeconds, "x", func(o measure.CleanupOptions) float64 { return o.MinBreathSeconds }},
		"max_breath_seconds below min":     {settingCleanupMaxBreathSeconds, "0.01", func(o measure.CleanupOptions) float64 { return o.MaxBreathSeconds }},
		"max_breath_seconds above 5":       {settingCleanupMaxBreathSeconds, "6", func(o measure.CleanupOptions) float64 { return o.MaxBreathSeconds }},
		"breath_below_speech_db zero":      {settingCleanupBreathBelowSpeechDB, "0", func(o measure.CleanupOptions) float64 { return o.BreathBelowSpeechDB }},
		"click_above_silence_db negative":  {settingCleanupClickAboveSilenceDB, "-5", func(o measure.CleanupOptions) float64 { return o.ClickAboveSilenceDB }},
		"click_above_silence_db not a num": {settingCleanupClickAboveSilenceDB, "loud", func(o measure.CleanupOptions) float64 { return o.ClickAboveSilenceDB }},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
			store := settings.New(t.TempDir(), "")
			if err := store.Save(cleanupSettingsTool, "global", map[string]*string{tc.key: strPtr(tc.raw)}); err != nil {
				t.Fatal(err)
			}
			got := cleanupSettings(store)
			if want := tc.field(defaults); tc.field(got) != want {
				t.Fatalf("%s = %+v, want the field's own default %v", name, got, want)
			}
		})
	}
}

// max_breath_seconds validates against the resolved min_breath_seconds (which may itself already have fallen back
// to its own default), never against a narrator's out-of-range attempt at the minimum.
func TestCleanupSettingsMaxBreathValidatesAgainstTheResolvedMinimum(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	store := settings.New(t.TempDir(), "")
	if err := store.Save(cleanupSettingsTool, "global", map[string]*string{
		settingCleanupMinBreathSeconds: strPtr("not a number"), // falls back to the default, 0.12
		settingCleanupMaxBreathSeconds: strPtr("0.5"),          // valid against the resolved 0.12
	}); err != nil {
		t.Fatal(err)
	}
	got := cleanupSettings(store)
	if got.MinBreathSeconds != measure.DefaultCleanupOptions().MinBreathSeconds || got.MaxBreathSeconds != 0.5 {
		t.Fatalf("cleanupSettings = %+v", got)
	}
}
