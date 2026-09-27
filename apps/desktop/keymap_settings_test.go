package main

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// Keymap.overrides (docs/prds/input-commands-and-pedals.prd.md Phase 5, Open Question Q2): the narrator's remap
// changes from the input registry's default keymap, global scope only (Q3: a narrator's pedal belongs to the booth,
// not the book).
func newTestHostForKeymapSettings(t *testing.T, projectFolder string) *Host {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := &Host{settings: settings.New(t.TempDir(), projectFolder)}
	host.config.projectFolder = projectFolder
	return host
}

func TestSaveSettingsAcceptsAndPersistsKeymapOverrides(t *testing.T) {
	host := newTestHostForKeymapSettings(t, "")

	document := `{"version":1,"bindings":{"reading.toggle":["PageDown"]}}`
	if err := host.saveSettings("Keymap", "global", map[string]*string{"overrides": &document}); err != nil {
		t.Fatalf("saveSettings() = %v, want the overrides document to be accepted", err)
	}

	effective, source := host.settings.Effective("Keymap", "overrides", "")
	if effective != document || source != "global" {
		t.Fatalf("Effective() = (%q, %q), want (%q, %q)", effective, source, document, "global")
	}
}

func TestSaveSettingsDefaultsKeymapOverridesToNoBindings(t *testing.T) {
	host := newTestHostForKeymapSettings(t, "")

	effective, source := host.settings.Effective("Keymap", "overrides", "")
	if effective != `{"version":1,"bindings":{}}` || source != "repo_default" {
		t.Fatalf("Effective() = (%q, %q), want the empty-bindings repo default", effective, source)
	}
}

func TestSaveSettingsRejectsAProjectScopedKeymapOverride(t *testing.T) {
	host := newTestHostForKeymapSettings(t, t.TempDir())

	document := `{"version":1,"bindings":{}}`
	err := host.saveSettings("Keymap", "project", map[string]*string{"overrides": &document})
	if err == nil || !strings.Contains(err.Error(), "global") {
		t.Fatalf("saveSettings() = %v, want a rejection naming the setting as global-only", err)
	}
}

func TestSaveSettingsRejectsAKeymapOverridesDocumentLargerThanTheCap(t *testing.T) {
	host := newTestHostForKeymapSettings(t, "")

	oversized := strings.Repeat("x", 64*1024+1)
	err := host.saveSettings("Keymap", "global", map[string]*string{"overrides": &oversized})
	if err == nil || !strings.Contains(err.Error(), "overrides") || !strings.Contains(err.Error(), "65536") {
		t.Fatalf("saveSettings() = %v, want a rejection naming the setting and its size cap", err)
	}
}

func TestSaveSettingsAcceptsAKeymapOverridesDocumentAtExactlyTheCap(t *testing.T) {
	host := newTestHostForKeymapSettings(t, "")

	atCap := strings.Repeat("x", 64*1024)
	if err := host.saveSettings("Keymap", "global", map[string]*string{"overrides": &atCap}); err != nil {
		t.Fatalf("saveSettings() = %v, want a value exactly at the cap to be accepted", err)
	}
}
