//go:build windows

package main

import (
	"unsafe"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"golang.org/x/sys/windows"
)

// systemPowerStatus is Win32's SYSTEM_POWER_STATUS.
type systemPowerStatus struct {
	ACLineStatus        byte
	BatteryFlag         byte
	BatteryLifePercent  byte
	SystemStatusFlag    byte
	BatteryLifeTime     uint32
	BatteryFullLifeTime uint32
}

var procGetSystemPowerStatus = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetSystemPowerStatus")

// platformPower reads whether the computer runs on mains power (GetSystemPowerStatus): AC line online, or no system
// battery at all (a desktop), is mains; AC offline is battery; anything else is unknown, which background checks treat
// as battery (D27).
func platformPower() coverage.Power {
	var status systemPowerStatus
	if ok, _, _ := procGetSystemPowerStatus.Call(uintptr(unsafe.Pointer(&status))); ok == 0 {
		return coverage.PowerUnknown
	}
	return powerFrom(status.ACLineStatus, status.BatteryFlag)
}
