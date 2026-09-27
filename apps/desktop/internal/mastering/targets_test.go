package mastering

import (
	"errors"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
)

func TestTargetsFromACX(t *testing.T) {
	targets, err := TargetsFrom(deliveryprofile.ACX())
	if err != nil {
		t.Fatal(err)
	}
	if *targets.RMSMin != -23 || *targets.RMSMax != -18 {
		t.Fatalf("RMS window = %g..%g, want -23..-18", *targets.RMSMin, *targets.RMSMax)
	}
	if targets.RMS != -20.5 {
		t.Fatalf("RMS target = %g, want the window's middle, -20.5", targets.RMS)
	}
	if targets.PeakMax != -3 || targets.Ceiling != -3-CeilingMargin {
		t.Fatalf("peak max %g, ceiling %g; want -3 and %g", targets.PeakMax, targets.Ceiling, -3-CeilingMargin)
	}
}

// customProfile is a narrator's copy of ACX with different numbers: another RMS window and peak limit.
func customProfile(rmsMin, rmsMax, peakMax float64) deliveryprofile.Profile {
	profile := deliveryprofile.ACX().Clone()
	profile.ID, profile.BuiltIn, profile.Name, profile.Revision = "custom-quiet", false, "Quiet platform", 1
	for i, rule := range profile.Rules {
		switch rule.Metric {
		case "rms_dbfs":
			profile.Rules[i].Min, profile.Rules[i].Max = &rmsMin, &rmsMax
		case "sample_peak_dbfs":
			profile.Rules[i].Max = &peakMax
		}
	}
	return profile
}

func TestTargetsFollowACustomProfilesNumbers(t *testing.T) {
	targets, err := TargetsFrom(customProfile(-28, -24, -8))
	if err != nil {
		t.Fatal(err)
	}
	if targets.RMS != -26 || *targets.RMSMin != -28 || *targets.RMSMax != -24 || targets.PeakMax != -8 {
		t.Fatalf("targets = %+v, want RMS -26 in -28..-24 and peak max -8", targets)
	}
}

func TestTargetsWithOneSidedWindow(t *testing.T) {
	onlyMax := customProfile(-23, -18, -3)
	for i := range onlyMax.Rules {
		if onlyMax.Rules[i].Metric == "rms_dbfs" {
			onlyMax.Rules[i].Min = nil
		}
	}
	targets, err := TargetsFrom(onlyMax)
	if err != nil {
		t.Fatal(err)
	}
	if targets.RMS != -18-OneSidedMargin || targets.RMSMin != nil {
		t.Fatalf("targets = %+v, want RMS %g under a max of -18 and no min", targets, -18-OneSidedMargin)
	}
}

func TestTargetsWithoutPeakRuleKeepClearOfFullScale(t *testing.T) {
	profile := deliveryprofile.ACX()
	for i := range profile.Rules {
		if profile.Rules[i].Metric == "sample_peak_dbfs" {
			profile.Rules[i].Off = true
		}
	}
	targets, err := TargetsFrom(profile)
	if err != nil {
		t.Fatal(err)
	}
	if targets.PeakMax != 0 || targets.Ceiling != -CeilingMargin {
		t.Fatalf("targets = %+v, want a ceiling of %g below full scale", targets, -CeilingMargin)
	}
}

func TestTargetsRefuseAProfileWithNoRMSRule(t *testing.T) {
	profile := deliveryprofile.ACX()
	for i := range profile.Rules {
		if profile.Rules[i].Metric == "rms_dbfs" {
			profile.Rules[i].Off = true
		}
	}
	if _, err := TargetsFrom(profile); !errors.Is(err, ErrNoRMSTarget) {
		t.Fatalf("err = %v, want ErrNoRMSTarget", err)
	}
}

func TestTargetsRefuseAnRMSWindowAboveThePeakCeiling(t *testing.T) {
	if _, err := TargetsFrom(customProfile(-10, -2, -6)); !errors.Is(err, ErrUnreachableTarget) {
		t.Fatalf("err = %v, want ErrUnreachableTarget", err)
	}
}
