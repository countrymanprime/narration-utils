package main

import (
	"math"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The silence cleanup analyzer's own thresholds (diagnostics-delivery-and-cleanup-tools.prd.md Phase 9 remainder,
// ADR 0238 decision 4: "the settings keys and saved presets in the layered store... are the host's"). They live
// under their own "Cleanup" tool, layered project over global over config/defaults.json like every other tool
// (fieldSchemas["Cleanup"], numberSpecs["Cleanup"]); a saved preset is simply this set of values at a layer, the
// same way every other settings section already is one. The detector itself (internal/measure/cleanup.go) is not
// touched here: it already accepts measure.CleanupOptions as input and resolves an unset (zero-value) one to
// measure.DefaultCleanupOptions on its own.

const cleanupSettingsTool = "Cleanup"

const (
	settingCleanupPadSeconds          = "pad_seconds"
	settingCleanupMinBreathSeconds    = "min_breath_seconds"
	settingCleanupMaxBreathSeconds    = "max_breath_seconds"
	settingCleanupBreathBelowSpeechDB = "breath_below_speech_db"
	settingCleanupClickAboveSilenceDB = "click_above_silence_db"
)

// cleanupSettings reads the narrator's silence cleanup thresholds from the layered store, field by field. A value
// that is missing, not a number, or outside CleanupOptions.resolve's own per-field range - a hand-edited or corrupt
// settings file, since the Settings page refuses one - falls back to that one field's default (measure.
// DefaultCleanupOptions), the same conservative-degradation rule coverage.ResolveSettings follows, so one bad
// field never breaks every other threshold or fails the whole diagnostics check.
func cleanupSettings(store *settings.Store) measure.CleanupOptions {
	defaults := measure.DefaultCleanupOptions()
	minBreath := cleanupPositiveSetting(store, settingCleanupMinBreathSeconds, defaults.MinBreathSeconds)
	return measure.CleanupOptions{
		PadSeconds:          cleanupBoundedSetting(store, settingCleanupPadSeconds, defaults.PadSeconds, 0, 2),
		MinBreathSeconds:    minBreath,
		MaxBreathSeconds:    cleanupBoundedSetting(store, settingCleanupMaxBreathSeconds, defaults.MaxBreathSeconds, minBreath, 5),
		BreathBelowSpeechDB: cleanupPositiveSetting(store, settingCleanupBreathBelowSpeechDB, defaults.BreathBelowSpeechDB),
		ClickAboveSilenceDB: cleanupPositiveSetting(store, settingCleanupClickAboveSilenceDB, defaults.ClickAboveSilenceDB),
	}
}

func cleanupBoundedSetting(store *settings.Store, key string, fallback, min, max float64) float64 {
	raw, _ := store.Effective(cleanupSettingsTool, key, "")
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || value < min || value > max {
		return fallback
	}
	return value
}

func cleanupPositiveSetting(store *settings.Store, key string, fallback float64) float64 {
	raw, _ := store.Effective(cleanupSettingsTool, key, "")
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || value <= 0 {
		return fallback
	}
	return value
}
