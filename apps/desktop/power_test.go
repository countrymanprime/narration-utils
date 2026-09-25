package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
)

func TestPowerFromReadsTheACLineAndANoBatteryDesktop(t *testing.T) {
	for _, tc := range []struct {
		ac, flag byte
		want     coverage.Power
	}{
		{1, 8, coverage.PowerMains},     // plugged in, charging
		{0, 1, coverage.PowerBattery},   // unplugged laptop
		{255, 128, coverage.PowerMains}, // a desktop with no system battery
		{255, 255, coverage.PowerUnknown},
		{255, 1, coverage.PowerUnknown},
	} {
		if got := powerFrom(tc.ac, tc.flag); got != tc.want {
			t.Fatalf("powerFrom(%d, %d) = %q, want %q", tc.ac, tc.flag, got, tc.want)
		}
	}
}
