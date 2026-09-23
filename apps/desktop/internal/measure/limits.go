package measure

import (
	"fmt"
	"math"
	"strconv"
)

// limitSetting names one bound of one metric as the narrator's delivery settings store it (the layered settings'
// Delivery section). Only the bounds that mean something are offered: a loudness or RMS level can be too quiet or too
// loud, but a peak or a noise floor is only ever too high.
type limitSetting struct {
	key   string
	apply func(profile Profile, value *float64) Profile
}

var limitSettings = []limitSetting{
	{"integrated_lufs_min", func(p Profile, v *float64) Profile { p.IntegratedLUFS.Min = v; return p }},
	{"integrated_lufs_max", func(p Profile, v *float64) Profile { p.IntegratedLUFS.Max = v; return p }},
	{"rms_dbfs_min", func(p Profile, v *float64) Profile { p.RMSdBFS.Min = v; return p }},
	{"rms_dbfs_max", func(p Profile, v *float64) Profile { p.RMSdBFS.Max = v; return p }},
	{"sample_peak_dbfs_max", func(p Profile, v *float64) Profile { p.SamplePeakdBFS.Max = v; return p }},
	{"true_peak_dbtp_max", func(p Profile, v *float64) Profile { p.TruePeakdBTP.Max = v; return p }},
	{"noise_floor_dbfs_max", func(p Profile, v *float64) Profile { p.NoiseFloordBFS.Max = v; return p }},
}

// limitPairs are the minimum and maximum keys of one metric: a minimum above its maximum can never pass.
var limitPairs = [][2]string{{"integrated_lufs_min", "integrated_lufs_max"}, {"rms_dbfs_min", "rms_dbfs_max"}}

// LimitKeys lists every settings key ProfileFromLimits reads, in a fixed order.
func LimitKeys() []string {
	keys := make([]string, len(limitSettings))
	for i, setting := range limitSettings {
		keys[i] = setting.key
	}
	return keys
}

// LimitPairs lists each metric's minimum and maximum keys, so settings can refuse a minimum above its maximum before
// it is saved.
func LimitPairs() [][2]string {
	return append([][2]string(nil), limitPairs...)
}

// ProfileFromLimits builds the profile a report is judged against from the narrator's own limit settings (effective
// values, one string per key). A missing or blank key is no limit, so empty settings give a profile with no limits: the
// package has no numeric defaults and no distributor's numbers (ADR 0025). A value that is not a finite number, or a
// minimum above its maximum, is an error rather than a silently dropped limit (a hand-edited settings file can hold
// either). Keys it does not know are ignored: the Delivery section may hold other settings.
func ProfileFromLimits(name string, values map[string]string) (Profile, error) {
	profile := Profile{Name: name}
	parsed := map[string]float64{}
	for _, setting := range limitSettings {
		text := values[setting.key]
		if text == "" {
			continue
		}
		value, err := strconv.ParseFloat(text, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return Profile{}, fmt.Errorf("delivery limit %s is %q, which is not a finite number", setting.key, text)
		}
		parsed[setting.key] = value
		profile = setting.apply(profile, &value)
	}
	for _, pair := range limitPairs {
		minimum, hasMinimum := parsed[pair[0]]
		maximum, hasMaximum := parsed[pair[1]]
		if hasMinimum && hasMaximum && minimum > maximum {
			return Profile{}, fmt.Errorf("delivery limit %s (%s) is above %s (%s)", pair[0], values[pair[0]], pair[1], values[pair[1]])
		}
	}
	return profile, nil
}
