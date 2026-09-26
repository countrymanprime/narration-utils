package main

import "github.com/countrymanprime/narration-utils/shell/internal/coverage"

// powerFrom reads Win32's SYSTEM_POWER_STATUS fields: ACLineStatus 1 is on the AC line and 0 is not; BatteryFlag 128
// means the computer has no system battery, so it can only run on mains. Anything else (255, unknown) is unknown.
func powerFrom(acLineStatus, batteryFlag byte) coverage.Power {
	switch {
	case acLineStatus == 1:
		return coverage.PowerMains
	case acLineStatus == 0:
		return coverage.PowerBattery
	case batteryFlag != 255 && batteryFlag&128 != 0:
		return coverage.PowerMains
	}
	return coverage.PowerUnknown
}
