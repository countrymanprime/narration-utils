package deliveryprofile

import (
	"fmt"
	"math"
	"strconv"
)

// The narrator's old delivery limits (ADR 0155 decision 5, superseded by ADR 0179): seven number settings in the
// layered settings' Delivery section. They are read once more, to move them into a profile (PRD P6), and never again:
// the keys stay in the settings files, unread.

// legacyNote marks a custom profile moved from the old limits.
const legacyNote = "Moved from your old Delivery limits."

// LegacyKeys are the old settings keys, in a fixed order.
var LegacyKeys = []string{
	"integrated_lufs_min", "integrated_lufs_max", "rms_dbfs_min", "rms_dbfs_max", "sample_peak_dbfs_max",
	"true_peak_dbtp_max", "noise_floor_dbfs_max",
}

// LegacyLimits are the old limits as numbers; a nil one was not set.
type LegacyLimits map[string]*float64

// ParseLegacyLimits reads the old limits from their settings values. A missing or blank value is no limit; one that is
// not a finite number, or a lowest above its highest, is an error (a hand-edited settings file can hold either), so a
// move never guesses.
func ParseLegacyLimits(values map[string]string) (LegacyLimits, error) {
	limits := LegacyLimits{}
	for _, key := range LegacyKeys {
		text := values[key]
		if text == "" {
			continue
		}
		value, err := strconv.ParseFloat(text, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("delivery limit %s is %q, which is not a finite number", key, text)
		}
		limits[key] = &value
	}
	for _, pair := range [][2]string{{"integrated_lufs_min", "integrated_lufs_max"}, {"rms_dbfs_min", "rms_dbfs_max"}} {
		if low, high := limits[pair[0]], limits[pair[1]]; low != nil && high != nil && *low > *high {
			return nil, fmt.Errorf("delivery limit %s (%s) is above %s (%s)", pair[0], values[pair[0]], pair[1], values[pair[1]])
		}
	}
	return limits, nil
}

// Set reports whether any limit was set.
func (l LegacyLimits) Set() bool {
	return len(l) > 0
}

// acxLegacyEquivalent is ACX's numbers as the old limits would hold them.
var acxLegacyEquivalent = map[string]float64{"rms_dbfs_min": -23, "rms_dbfs_max": -18, "sample_peak_dbfs_max": -3, "noise_floor_dbfs_max": -60}

// EqualsACX reports whether the limits are exactly ACX's numbers and nothing else (no loudness or true-peak limit):
// only then does a project move to ACX itself.
func (l LegacyLimits) EqualsACX() bool {
	if len(l) != len(acxLegacyEquivalent) {
		return false
	}
	for key, want := range acxLegacyEquivalent {
		if got := l[key]; got == nil || *got != want {
			return false
		}
	}
	return true
}

// Profile builds the custom profile the limits move into: ACX's rules with the level numbers replaced by the old ones,
// a level rule with no old limit turned off, and ACX's true-peak advice dropped, so the levels are judged exactly as
// before; plus a rule for an old loudness or true-peak limit, which ACX has no rule for. ACX's other rules (sample
// rate, file length, room tone, format, the book rules) are kept.
func (l LegacyLimits) Profile(name string) Profile {
	profile := newCustom(ACX(), name, legacyNote)
	for i := range profile.Rules {
		rule := &profile.Rules[i]
		switch rule.ID {
		case "acx.rms":
			rule.Min, rule.Max = copyFloat(l["rms_dbfs_min"]), copyFloat(l["rms_dbfs_max"])
		case "acx.peak":
			rule.Min, rule.Max, rule.Advice = nil, copyFloat(l["sample_peak_dbfs_max"]), nil
		case "acx.noise_floor":
			rule.Max = copyFloat(l["noise_floor_dbfs_max"])
		default:
			continue
		}
		if rule.Min == nil && rule.Max == nil {
			// Off keeps the rule's ACX numbers out of sight but not its bounds: a rule turned back on judges ACX's.
			original, _ := ACX().Rule(rule.ID)
			rule.Min, rule.Max, rule.Off = original.Min, original.Max, true
		}
	}
	source := Source{Title: "Your old Delivery limits", Requirement: "A limit you set in Settings > Delivery before delivery profiles."}
	if low, high := l["integrated_lufs_min"], l["integrated_lufs_max"]; low != nil || high != nil {
		profile.Rules = append(profile.Rules, Rule{
			ID: "limits.integrated_lufs", Label: "Integrated loudness", Scope: ScopeFile, Metric: "integrated_lufs", Unit: "LUFS",
			Min: copyFloat(low), Max: copyFloat(high), Level: LevelRequired, CheckedBy: CheckedMeasured, Source: source, Verification: Verified,
		})
	}
	if high := l["true_peak_dbtp_max"]; high != nil {
		profile.Rules = append(profile.Rules, Rule{
			ID: "limits.true_peak", Label: "True peak", Scope: ScopeFile, Metric: "true_peak_dbtp", Unit: "dBTP",
			Max: copyFloat(high), Level: LevelRequired, CheckedBy: CheckedMeasured, Source: source, Verification: Verified,
		})
	}
	return profile
}

// Matches reports whether profile judges the levels exactly as these limits would (the same level rules, on with the
// same numbers or off), so a second project with the same limits reuses one moved profile.
func (l LegacyLimits) Matches(profile Profile) bool {
	built := l.Profile("")
	if len(built.Rules) != len(profile.Rules) {
		return false
	}
	for i, want := range built.Rules {
		got := profile.Rules[i]
		if got.ID != want.ID || got.Off != want.Off || !sameBound(got.Min, want.Min) || !sameBound(got.Max, want.Max) {
			return false
		}
	}
	return true
}

func sameBound(a, b *float64) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}
