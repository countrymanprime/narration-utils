package main

import (
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// newTestHostForDawCapabilities builds a Host with no bridge and no session directory (a launch with no REAPER file
// bridge open), whose --daw label is daw: "" (standalone), "REAPER" (declared but not connected) or "Audacity"
// (declared, and never has a transport of its own). The real repo defaults (config/defaults.json) back its settings
// store, so every DAW.capability.<name> row reads its real default, "auto".
func newTestHostForDawCapabilities(t *testing.T, daw string) *Host {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := NewHost()
	host.config.daw = daw
	return host
}

// TestDawCapabilitiesGoldenIsCurrent pins DawCapabilities' payload for the three launch kinds a unit test can build
// without a real REAPER session: no DAW at all (every capability unsupported, standalone), REAPER declared but not
// connected (its Supported/Experimental declaration, refused standalone or experimental_off, except the offline
// project_read capability, which needs no bridge), and Audacity (navigate, markers and macro_render experimental and
// switched off, ADR 0355, ADR 0460; every other capability not_yet_available, ADR 0144's sentence). UPDATE_CONTRACTS=1
// rewrites tests/fixtures/contracts/daw-capabilities-*.json.
func TestDawCapabilitiesGoldenIsCurrent(t *testing.T) {
	cases := []struct{ name, daw string }{
		{"daw-capabilities-standalone", ""},
		{"daw-capabilities-reaper", "REAPER"},
		{"daw-capabilities-audacity", "Audacity"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			host := newTestHostForDawCapabilities(t, c.daw)
			raw, err := host.DawCapabilities()
			if err != nil {
				t.Fatalf("DawCapabilities() error = %v", err)
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
				t.Fatalf("DawCapabilities() = %q, not JSON: %v", raw, err)
			}
			contractfile.Check(t, c.name, decoded)
		})
	}
}

func TestDawCapabilitiesReportsTheLaunchKind(t *testing.T) {
	cases := []struct{ daw, want string }{{"", "none"}, {"REAPER", "REAPER"}, {"Audacity", "Audacity"}, {"reaper", "REAPER"}}
	for _, c := range cases {
		host := newTestHostForDawCapabilities(t, c.daw)
		raw, err := host.DawCapabilities()
		if err != nil {
			t.Fatalf("DawCapabilities() error = %v", err)
		}
		var decoded struct {
			Daw       string `json:"daw"`
			Reachable bool   `json:"reachable"`
		}
		if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded.Daw != c.want {
			t.Errorf("daw = %q, want %q", decoded.Daw, c.want)
		}
		if decoded.Reachable {
			t.Errorf("reachable = true, want false: no bridge is connected")
		}
	}
}

// TestDawCapabilitiesOfflineReadingNeedsAKnownDAW: project_read needs no running engine, but it still needs a DAW at
// all (dawport's Needs enum): reading a saved project means knowing its format, and a standalone launch has none.
func TestDawCapabilitiesOfflineReadingNeedsAKnownDAW(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "")
	raw, _ := host.DawCapabilities()
	var decoded struct {
		Capabilities map[string]struct {
			Available bool   `json:"available"`
			Reason    string `json:"reason"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatal(err)
	}
	projectRead := decoded.Capabilities[string(dawport.CapProjectRead)]
	if projectRead.Available || projectRead.Reason != "standalone" {
		t.Fatalf("project_read = %+v, want unavailable/standalone with no DAW at all", projectRead)
	}
}

// TestDawCapabilitiesOfflineReadingWorksWithNoBridge: the same capability is available on a REAPER launch even
// though nothing is connected, since it only needs to know REAPER's project format, not a live bridge.
func TestDawCapabilitiesOfflineReadingWorksWithNoBridge(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "REAPER")
	raw, _ := host.DawCapabilities()
	var decoded struct {
		Capabilities map[string]struct {
			Available bool `json:"available"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.Capabilities[string(dawport.CapProjectRead)].Available {
		t.Fatalf("project_read should be available offline on a REAPER launch")
	}
}

// TestSaveSettingsAcceptsACapabilityToggle: the row DAW port PRD P3 added to config/defaults.json is now exposed by
// settingsForScope and saveable, not only readable through Store.Effective.
func TestSaveSettingsAcceptsACapabilityToggle(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "REAPER")
	key := dawport.ToggleKey(dawport.CapPunch)
	on := "on"
	if err := host.saveSettings("DAW", "global", map[string]*string{key: &on}); err != nil {
		t.Fatalf("saveSettings(%s) = %v, want it accepted", key, err)
	}
	effective, source := host.settings.Effective("DAW", key, "auto")
	if effective != "on" || source != "global" {
		t.Fatalf("Effective(%s) = (%q, %q), want (%q, %q)", key, effective, source, "on", "global")
	}
	fields, err := host.settingsForScope("global")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, field := range fields["DAW"].([]map[string]any) {
		if field["key"] == key {
			found = true
			if field["value"] != "on" {
				t.Fatalf("field %s value = %v, want on", key, field["value"])
			}
		}
	}
	if !found {
		t.Fatalf("settingsForScope('DAW') has no row for %s", key)
	}
}

func TestSaveSettingsRejectsAnUnknownCapabilityToggleValue(t *testing.T) {
	host := newTestHostForDawCapabilities(t, "REAPER")
	key := dawport.ToggleKey(dawport.CapPunch)
	bogus := "sometimes"
	if err := host.saveSettings("DAW", "global", map[string]*string{key: &bogus}); err == nil {
		t.Fatalf("saveSettings(%s, %q) = nil, want a refusal", key, bogus)
	}
}
