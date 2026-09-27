package mastering

import (
	"errors"
	"fmt"
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
)

// The metrics the chain masters to, as internal/deliveryprofile names them. A rule is found by its metric, not its ID,
// so a custom profile (a copy with different numbers) or a later platform's profile is honoured with no change here.
const (
	metricRMS  = "rms_dbfs"
	metricPeak = "sample_peak_dbfs"
)

const (
	// CeilingMargin is how far under the profile's peak limit the limiter holds the sample peak, in dB: room for the
	// rounding of the written samples and for an MP3 encoder's overshoot (ADR 0321).
	CeilingMargin = 0.5
	// OneSidedMargin is how far inside a one-sided RMS bound the chain aims, in dB, when the profile gives no window.
	OneSidedMargin = 2.0
)

var (
	// ErrNoRMSTarget is a profile with no RMS rule the app measures and has not turned off: there is nothing to master to.
	ErrNoRMSTarget = errors.New("the delivery profile has no RMS rule to master to")
	// ErrUnreachableTarget is a profile whose RMS target is not under its peak ceiling: no audio can meet both.
	ErrUnreachableTarget = errors.New("the delivery profile's RMS target is not below its peak ceiling")
)

// Targets are the levels the chain masters to, all in dBFS as internal/measure reports them: RMS over every sample of
// every channel, silences included, and the sample peak over every channel.
type Targets struct {
	// RMS is the level the gain stage aims for: the middle of the profile's RMS window.
	RMS float64 `json:"rms"`
	// RMSMin and RMSMax are the profile's window; nil when the profile gives no such bound.
	RMSMin *float64 `json:"rmsMin"`
	RMSMax *float64 `json:"rmsMax"`
	// PeakMax is the profile's sample-peak limit, 0 (full scale) when the profile has none; Ceiling is where the
	// limiter holds the peak, CeilingMargin under it.
	PeakMax float64 `json:"peakMax"`
	Ceiling float64 `json:"ceiling"`
}

// TargetsFrom reads the chain's targets from a delivery profile's own RMS and sample-peak rules (PRD Q4: fixed chain,
// the profile's numbers).
func TargetsFrom(profile deliveryprofile.Profile) (Targets, error) {
	rms, ok := measuredRule(profile, metricRMS)
	if !ok || (rms.Min == nil && rms.Max == nil) {
		return Targets{}, fmt.Errorf("%s: %w", profile.Title(), ErrNoRMSTarget)
	}
	targets := Targets{RMSMin: copyBound(rms.Min), RMSMax: copyBound(rms.Max)}
	switch {
	case rms.Min != nil && rms.Max != nil:
		targets.RMS = (*rms.Min + *rms.Max) / 2
	case rms.Max != nil:
		targets.RMS = *rms.Max - OneSidedMargin
	default:
		targets.RMS = *rms.Min + OneSidedMargin
	}
	if peak, ok := measuredRule(profile, metricPeak); ok && peak.Max != nil {
		targets.PeakMax = math.Min(0, *peak.Max)
	}
	targets.Ceiling = targets.PeakMax - CeilingMargin
	if targets.RMS >= targets.Ceiling {
		return Targets{}, fmt.Errorf("%s: RMS %.1f dBFS, peak ceiling %.1f dBFS: %w", profile.Title(), targets.RMS, targets.Ceiling, ErrUnreachableTarget)
	}
	return targets, nil
}

// measuredRule finds the file rule the app measures for metric, unless the narrator turned it off.
func measuredRule(profile deliveryprofile.Profile, metric string) (deliveryprofile.Rule, bool) {
	for _, rule := range profile.Rules {
		if rule.Metric == metric && rule.Scope == deliveryprofile.ScopeFile && rule.CheckedBy == deliveryprofile.CheckedMeasured && !rule.Off {
			return rule, true
		}
	}
	return deliveryprofile.Rule{}, false
}

func copyBound(v *float64) *float64 {
	if v == nil {
		return nil
	}
	value := *v
	return &value
}
