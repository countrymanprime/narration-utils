package coverage

import (
	"fmt"
	"math"
	"strconv"
)

// SettingsTool is the settings.Store tool the recording check's four settings
// live under (docs/utilities/recording-coverage.md Q3, ADR 0131), layered project
// over global over the built-in defaults in config/defaults.json like every
// other tool.
const SettingsTool = "RecordingCoverage"

// The four setting keys (Q3). The first two are thresholds, applied on read;
// the last two are alignment parameters, which change which words count and
// so are in a result's parameter hash (Q13 B).
const (
	SettingMinParagraphPresent = "min_paragraph_present"
	SettingMaxMissingRun       = "max_missing_run"
	SettingMaxMisreadRun       = "max_misread_run"
	SettingMinAnchorRun        = "min_anchor_run"
)

// Settings are everything the narrator sets for the recording check: how the
// transcript is aligned to the text, and when a chapter counts as recorded.
type Settings struct {
	Alignment  AlignmentParams
	Thresholds Thresholds
}

// DefaultSettings are 0.8, 3, 8 and 3, chosen by running the synthetic
// fixtures through the shipped path under simulated transcriber error (ADR
// 0132; Q3 started at 0.95, 3, 8 and 3). No real narration has checked them,
// so they stay Proposed and labelled uncalibrated (Q15).
var DefaultSettings = Settings{Alignment: DefaultAlignmentParams, Thresholds: DefaultThresholds}

func (t Thresholds) validate() error {
	if math.IsNaN(t.MinParagraphPresent) || t.MinParagraphPresent < 0 || t.MinParagraphPresent > 1 || t.MaxMissingRun < 0 {
		return fmt.Errorf("thresholds must be a paragraph share from 0 to 1 and a missing run of 0 or more (got %g and %d)", t.MinParagraphPresent, t.MaxMissingRun)
	}
	return nil
}

// ResolveSettings reads the four settings through lookup (the effective value
// of one key, "" when none is set anywhere). A value that is missing, not a
// number, or out of range - a hand-edited or corrupt settings file, since the
// Settings page refuses one - falls back to that one setting's default, so a
// typo degrades to the conservative value instead of failing every check.
func ResolveSettings(lookup func(key string) string) Settings {
	defaults := DefaultSettings
	return Settings{
		Alignment: AlignmentParams{
			MaxMisreadRun: wholeSetting(lookup(SettingMaxMisreadRun), 0, defaults.Alignment.MaxMisreadRun),
			MinAnchorRun:  wholeSetting(lookup(SettingMinAnchorRun), 1, defaults.Alignment.MinAnchorRun),
		},
		Thresholds: Thresholds{
			MinParagraphPresent: shareSetting(lookup(SettingMinParagraphPresent), defaults.Thresholds.MinParagraphPresent),
			MaxMissingRun:       wholeSetting(lookup(SettingMaxMissingRun), 0, defaults.Thresholds.MaxMissingRun),
		},
	}
}

func wholeSetting(raw string, minimum, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum {
		return fallback
	}
	return value
}

func shareSetting(raw string, fallback float64) float64 {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || value < 0 || value > 1 {
		return fallback
	}
	return value
}
