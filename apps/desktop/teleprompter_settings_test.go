package main

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The Teleprompter device setting (docs/prds/teleprompter-engines-and-input-devices.prd.md, "Where the device, engine
// and model choices are stored"): a global-only machine fact, so it survives an app restart and is never a per-project
// override.
func newTestHostForTeleprompterSettings(t *testing.T, projectFolder string) *Host {
	t.Helper()
	// The global settings file lives under APPDATA, not under the repo root Store.New takes (store.go's globalPath):
	// isolate it per test or these tests collide with each other and with a real machine's settings file.
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := &Host{settings: settings.New(t.TempDir(), projectFolder)}
	host.config.projectFolder = projectFolder
	return host
}

func TestSaveSettingsAcceptsAndPersistsTheTeleprompterInputDevice(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")

	value := "Microphone Array (Realtek(R) Audio)"
	if err := host.saveSettings("Teleprompter", "global", map[string]*string{"input_device": &value}); err != nil {
		t.Fatalf("saveSettings() = %v, want the free-text device to be accepted", err)
	}

	effective, source := host.settings.Effective("Teleprompter", "input_device", "")
	if effective != value || source != "global" {
		t.Fatalf("Effective() = (%q, %q), want (%q, %q)", effective, source, value, "global")
	}
}

func TestSaveSettingsAcceptsAnEmptyTeleprompterInputDevice(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")

	empty := ""
	if err := host.saveSettings("Teleprompter", "global", map[string]*string{"input_device": &empty}); err != nil {
		t.Fatalf("saveSettings() = %v, want an empty device (nothing chosen yet) to be accepted", err)
	}
}

func TestSaveSettingsRejectsAProjectScopedTeleprompterDevice(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, t.TempDir())

	value := "Microphone Array (Realtek(R) Audio)"
	err := host.saveSettings("Teleprompter", "project", map[string]*string{"input_device": &value})
	if err == nil || !strings.Contains(err.Error(), "global") {
		t.Fatalf("saveSettings() = %v, want a rejection naming the setting as global-only", err)
	}
}

func TestSaveSettingsRejectsAnUnknownTeleprompterField(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")

	value := "24khz"
	if err := host.saveSettings("Teleprompter", "global", map[string]*string{"sample_rate": &value}); err == nil || !strings.Contains(err.Error(), "unsupported setting") {
		t.Fatalf("saveSettings() = %v, want an unknown field rejected", err)
	}
}

// Phase 3 ("Teleprompter settings section") added the engine choice; Phase 7 ("Engine choice end to end") offers
// Moonshine in it wherever the sidecar ships it (Windows, ADR 0107).
func TestSaveSettingsAcceptsAndPersistsTheTeleprompterEngineChoice(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")
	host.platform = "windows"

	for _, value := range []string{"whisper", "moonshine"} {
		if err := host.saveSettings("Teleprompter", "global", map[string]*string{"engine": &value}); err != nil {
			t.Fatalf("saveSettings(%q) = %v, want the engine choice accepted on Windows", value, err)
		}
		effective, source := host.settings.Effective("Teleprompter", "engine", "")
		if effective != value || source != "global" {
			t.Fatalf("Effective() = (%q, %q), want (%q, %q)", effective, source, value, "global")
		}
	}
}

func TestSaveSettingsRejectsAnEngineThisPlatformCannotLaunch(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")
	host.platform = "darwin"

	value := "moonshine"
	if err := host.saveSettings("Teleprompter", "global", map[string]*string{"engine": &value}); err == nil || !strings.Contains(err.Error(), "unsupported value") {
		t.Fatalf("saveSettings() = %v, want moonshine rejected where the sidecar does not ship it", err)
	}
}

func TestTheEngineChoicesAreTheEnginesThisPlatformCanLaunch(t *testing.T) {
	for platform, want := range map[string]string{"windows": "whisper,moonshine", "linux": "whisper"} {
		host := newTestHostForTeleprompterSettings(t, "")
		host.platform = platform
		for _, field := range host.settingsSchemas()["Teleprompter"] {
			if field.key == "engine" && strings.Join(field.choices, ",") != want {
				t.Errorf("%s: engine choices = %v, want %s", platform, field.choices, want)
			}
		}
	}
}

// Model choices exposed per engine (the PRD's Decisions Log recommendation): tiny and small only, for either engine
// (both catalogs have them), since only those have measured live-lag data.
func TestSaveSettingsAcceptsAndPersistsTheTeleprompterModelChoice(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")

	value := "small"
	if err := host.saveSettings("Teleprompter", "global", map[string]*string{"model": &value}); err != nil {
		t.Fatalf("saveSettings() = %v, want the small model choice accepted", err)
	}

	effective, source := host.settings.Effective("Teleprompter", "model", "")
	if effective != value || source != "global" {
		t.Fatalf("Effective() = (%q, %q), want (%q, %q)", effective, source, value, "global")
	}
}

func TestSaveSettingsRejectsATeleprompterModelOutsideTinyOrSmall(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")

	value := "medium"
	if err := host.saveSettings("Teleprompter", "global", map[string]*string{"model": &value}); err == nil || !strings.Contains(err.Error(), "unsupported value") {
		t.Fatalf("saveSettings() = %v, want a model outside tiny/small rejected: no live-lag data for it", err)
	}
}

func TestSaveSettingsRejectsAProjectScopedTeleprompterEngineOrModel(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, t.TempDir())

	engine := "whisper"
	if err := host.saveSettings("Teleprompter", "project", map[string]*string{"engine": &engine}); err == nil || !strings.Contains(err.Error(), "global") {
		t.Fatalf("saveSettings() = %v, want the engine rejected as global-only, same as the device", err)
	}
	model := "small"
	if err := host.saveSettings("Teleprompter", "project", map[string]*string{"model": &model}); err == nil || !strings.Contains(err.Error(), "global") {
		t.Fatalf("saveSettings() = %v, want the model rejected as global-only, same as the device", err)
	}
}

func TestSettingsForScopeReportsTheTeleprompterInputDeviceField(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")

	scoped, err := host.settingsForScope("global")
	if err != nil {
		t.Fatal(err)
	}
	fields, _ := scoped["Teleprompter"].([]map[string]any)
	if len(fields) != 3 {
		t.Fatalf("Teleprompter fields = %v, want exactly input_device, engine and model", scoped["Teleprompter"])
	}
	byKey := map[string]map[string]any{}
	for _, field := range fields {
		byKey[field["key"].(string)] = field
	}
	device := byKey["input_device"]
	if device["kind"] != "text" || device["isSet"] != false {
		t.Fatalf("input_device field = %v, want an unset text field before any device is chosen", device)
	}
	engine := byKey["engine"]
	if engine["kind"] != "choice" || engine["isSet"] != false || engine["effectiveValue"] != "whisper" || engine["effectiveSource"] != "repo_default" {
		t.Fatalf("engine field = %v, want an unset choice field defaulting to whisper from the repo defaults", engine)
	}
	model := byKey["model"]
	if model["kind"] != "choice" || model["isSet"] != false || model["effectiveValue"] != "tiny" || model["effectiveSource"] != "repo_default" {
		t.Fatalf("model field = %v, want an unset choice field defaulting to tiny from the repo defaults", model)
	}
}
