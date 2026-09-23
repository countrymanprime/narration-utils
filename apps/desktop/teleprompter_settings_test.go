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

	value := "moonshine"
	if err := host.saveSettings("Teleprompter", "global", map[string]*string{"engine": &value}); err == nil || !strings.Contains(err.Error(), "unsupported setting") {
		t.Fatalf("saveSettings() = %v, want the engine field rejected: it is a later phase's scope, not this one's", err)
	}
}

func TestSettingsForScopeReportsTheTeleprompterInputDeviceField(t *testing.T) {
	host := newTestHostForTeleprompterSettings(t, "")

	scoped, err := host.settingsForScope("global")
	if err != nil {
		t.Fatal(err)
	}
	fields, _ := scoped["Teleprompter"].([]map[string]any)
	if len(fields) != 1 {
		t.Fatalf("Teleprompter fields = %v, want exactly input_device", scoped["Teleprompter"])
	}
	field := fields[0]
	if field["key"] != "input_device" || field["kind"] != "text" || field["isSet"] != false {
		t.Fatalf("input_device field = %v, want an unset text field before any device is chosen", field)
	}
}
