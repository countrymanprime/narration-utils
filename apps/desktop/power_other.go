//go:build !windows

package main

import "github.com/countrymanprime/narration-utils/shell/internal/coverage"

// platformPower is unknown off Windows: the app does not read the power state there yet, so background recording
// checks, which never run on battery (D27), do not run (ADR 0211).
func platformPower() coverage.Power { return coverage.PowerUnknown }
