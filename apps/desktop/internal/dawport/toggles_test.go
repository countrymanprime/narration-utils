package dawport

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// settingsOf is settings.Store.Effective over one tool's values, with the store's fallback when a key is missing.
func settingsOf(values map[string]string) func(tool, key, fallback string) (string, string) {
	return func(tool, key, fallback string) (string, string) {
		if v, ok := values[tool+"."+key]; ok && tool == SettingsTool {
			return v, "global"
		}
		return fallback, "hardcoded"
	}
}

func TestToggleKeyIsTheCapabilityRow(t *testing.T) {
	if got := ToggleKey(CapPunch); got != "capability.punch" {
		t.Fatalf("ToggleKey(punch) = %q, want capability.punch", got)
	}
	if SettingsTool != "DAW" {
		t.Fatalf("SettingsTool = %q, want DAW (the section the old switch lives in)", SettingsTool)
	}
}

func TestSettingsTogglesReadEachCapabilitysRow(t *testing.T) {
	toggles := SettingsToggles(settingsOf(map[string]string{
		"DAW.capability.punch":     "on",
		"DAW.capability.fx_chains": "off",
		"DAW.capability.review":    "auto",
		"DAW.capability.record":    " On ",
	}))
	for c, want := range map[Capability]Toggle{
		CapPunch: ToggleOn, CapFXChains: ToggleOff, CapReview: ToggleAuto, CapRecord: ToggleOn,
		// No row at all (a settings file from before P3) is auto.
		CapRegions: ToggleAuto,
	} {
		if got := toggles(c); got != want {
			t.Errorf("toggle(%s) = %q, want %q", c, got, want)
		}
	}
}

// The old DAW.experimental_reaper_actions switch keeps working (PRD open question 1): while it is on, every Experimental capability
// left on auto is on. Settings files hold it as text, and a hand-edited one as a boolean the store reads back as "true".
func TestSettingsExperimentalReadsTheOldSwitch(t *testing.T) {
	for value, want := range map[string]bool{"true": true, "True": true, "false": false, "": false, "yes": false} {
		experimental := SettingsExperimental(settingsOf(map[string]string{"DAW." + bridge.ExperimentalSettingKey: value}))
		if got := experimental(); got != want {
			t.Errorf("experimental_reaper_actions = %q reads %v, want %v", value, got, want)
		}
	}
	if SettingsExperimental(settingsOf(nil))() {
		t.Error("with no row the old switch is on; it defaults off (owner decision D38)")
	}
}

// Every settings read happens on the call, never cached, so a settings save is in the resolver's next answer.
func TestSettingsInputsAreReadOnEveryCall(t *testing.T) {
	values := map[string]string{}
	r := NewResolver(ResolverConfig{
		Adapter:      plainAdapter{stubAdapter{kind: KindREAPER, declares: map[Capability]Level{CapPunch: Experimental}}},
		Toggle:       SettingsToggles(settingsOf(values)),
		Experimental: SettingsExperimental(settingsOf(values)),
	})
	if err := r.Allowed(CapPunch); !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatalf("Allowed(punch) on defaults = %v, want experimental_off", err)
	}
	values["DAW.capability.punch"] = "on"
	if err := r.Allowed(CapPunch); err != nil {
		t.Fatalf("Allowed(punch) after switching punch on = %v, want nil", err)
	}
	values["DAW.capability.punch"] = "auto"
	values["DAW."+bridge.ExperimentalSettingKey] = "true"
	if err := r.Allowed(CapPunch); err != nil {
		t.Fatalf("Allowed(punch) on auto with the old switch on = %v, want nil", err)
	}
}

// config/defaults.json has a DAW.capability.<name> row for every capability in the catalog, on auto, so a narrator on default
// settings sees today's behaviour (PRD D4). The settings store's own test holds its built-in copy to the same file.
func TestDefaultsHaveAnAutoRowForEveryCapability(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "config", "defaults.json"))
	if err != nil {
		t.Fatal(err)
	}
	var defaults map[string]map[string]string
	if err := json.Unmarshal(raw, &defaults); err != nil {
		t.Fatal(err)
	}
	daw := defaults[SettingsTool]
	want := map[string]bool{}
	for _, spec := range Capabilities() {
		key := ToggleKey(spec.Capability)
		want[key] = true
		if got, ok := daw[key]; !ok || Toggle(got) != ToggleAuto {
			t.Errorf("defaults.json DAW.%s = %q (present %v), want %q", key, got, ok, ToggleAuto)
		}
	}
	for key := range daw {
		if len(key) > len("capability.") && key[:len("capability.")] == "capability." && !want[key] {
			t.Errorf("defaults.json has DAW.%s, which is no capability in the catalog", key)
		}
	}
}
