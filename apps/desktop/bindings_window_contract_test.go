package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// What WindowZoom and WindowSetZoom send (app-navigation-and-zoom-controls.prd.md Phase 2): one shape, the window's
// current zoom level as a fraction.
func TestContractWindowZoom(t *testing.T) {
	contractfile.Check(t, "window-zoom", WindowZoomResult{Level: 1.25})
}
