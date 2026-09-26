package dawport

import (
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// The narrator's per-capability settings live in the settings store's DAW section, beside the old single switch: one row per
// capability, DAW.capability.<name>, whose value is a Toggle and defaults to auto (config/defaults.json). The rows are append-only.
const SettingsTool = "DAW"

// ToggleKey is c's settings key in SettingsTool: capability.<name>.
func ToggleKey(c Capability) string { return "capability." + string(c) }

// Effective reads one setting through the store's layers (project, then global, then the repo defaults), with fallback when no layer
// has it. It is settings.Store.Effective; the second result, the layer, is not used here.
type Effective func(tool, key, fallback string) (string, string)

// SettingsToggles is the resolver's Toggle input over the settings store: each call reads c's row, so a settings save is in the next
// answer. A value it does not know, or no row, is ToggleAuto.
func SettingsToggles(effective Effective) func(Capability) Toggle {
	return func(c Capability) Toggle {
		value, _ := effective(SettingsTool, ToggleKey(c), string(ToggleAuto))
		switch t := Toggle(strings.ToLower(strings.TrimSpace(value))); t {
		case ToggleOn, ToggleOff:
			return t
		default:
			return ToggleAuto
		}
	}
}

// SettingsExperimental is the resolver's Experimental input over the settings store: the old DAW.experimental_reaper_actions switch,
// read on every call. While it is on, every Experimental capability left on auto is on (ADR 0300); it defaults off (owner decision
// D38). The settings rows are text, so it is on only for "true" in any case.
func SettingsExperimental(effective Effective) func() bool {
	return func() bool {
		value, _ := effective(SettingsTool, bridge.ExperimentalSettingKey, "false")
		return strings.EqualFold(strings.TrimSpace(value), "true")
	}
}
