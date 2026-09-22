package takereview

import (
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// settingsTool is the settings.Store tool name for this package's Q12
// thresholds and Q3 pickup-scope settings, layered project/global/repo
// default/hardcoded like every other tool (settings.Store.Effective);
// defaults are mirrored in config/defaults.json's TakeReview entry.
const settingsTool = "TakeReview"

// ResolveThresholds reads Q12's layered detection thresholds from store. An
// unparseable or out-of-range stored value (a hand-edited settings file, or
// a corrupt one) falls back to the conservative built-in default for that
// one threshold rather than failing the scan - a narrator's typo should
// degrade gracefully, not silently produce zero findings or crash a scan.
func ResolveThresholds(store *settings.Store) repeats.Thresholds {
	defaults := repeats.DefaultThresholds()
	full, _ := store.Effective(settingsTool, "full_coverage_threshold", "")
	near, _ := store.Effective(settingsTool, "near_duplicate_quality_threshold", "")
	return repeats.Thresholds{
		FullCoverage:         parseFraction(full, defaults.FullCoverage),
		NearDuplicateQuality: parseFraction(near, defaults.NearDuplicateQuality),
	}
}

func parseFraction(raw string, fallback float64) float64 {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value < 0 || value > 1 {
		return fallback
	}
	return value
}

// ResolvePickupScope reads Q3's narrator-designated pickup track or time
// range from store, layered the same way as ResolveThresholds.
// chapterTrackName is supplied by the caller (which track this one scan
// covers), not stored: it names the scan, not a standing preference. A
// configured pickup track wins over a configured pickup range if somehow
// both are set (project settings hand-edited outside the app); an
// unparseable or backwards range (end at or before start) is treated as
// unset rather than failing the scan.
func ResolvePickupScope(store *settings.Store, chapterTrackName string) Scope {
	scope := Scope{ChapterTrackName: chapterTrackName}

	trackName, _ := store.Effective(settingsTool, "pickup_track_name", "")
	if trackName != "" {
		scope.PickupTrackName = trackName
		return scope
	}

	startRaw, _ := store.Effective(settingsTool, "pickup_range_start_seconds", "")
	endRaw, _ := store.Effective(settingsTool, "pickup_range_end_seconds", "")
	start, startErr := strconv.ParseFloat(startRaw, 64)
	end, endErr := strconv.ParseFloat(endRaw, 64)
	if startErr == nil && endErr == nil && start >= 0 && end > start {
		scope.PickupRangeStart, scope.PickupRangeEnd = &start, &end
	}
	return scope
}
