package main

import (
	"math"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The header's zoom group and its Ctrl+=/-/0 shortcuts (app-navigation-and-zoom-controls.prd.md Phase 2, D29) read
// and set the window's real webview zoom through Wails v3's Window.SetZoom/GetZoom (ADR 0200 names the window
// "main"). Nothing here reads a project service, so a project switch never touches it.

// zoomSteps are the levels the header's buttons and Ctrl+=/-/0 step through (Q6 A, narrowed to Windows by ADR 0201):
// WebView2's own percentages from 100% to 200%. Ctrl+wheel and pinch are WebView2's own and never call
// WindowSetZoom, which is how a level under 100% (ADR 0201 item 2, "kept, because a smaller page cramps nothing")
// stays reachable outside the buttons.
var zoomSteps = []float64{1.0, 1.10, 1.25, 1.50, 1.75, 2.00}

// zoomMin and zoomMax bound WindowSetZoom's clamp. Wails v3's own SetZoom/ZoomOut already floor at 1.0 on Windows
// (ADR 0201); named here so nearestZoomStep and this file's tests read the same range the header promises.
const (
	zoomMin = 1.0
	zoomMax = 2.00
)

// zoomWindow is the subset of application.Window this file needs, narrowed the same way bindings_companion.go's
// companionWindow is: a real application.Window satisfies it with no adapter, and a test fakes it instead of the
// whole interface, since application.Get() is nil outside a running Wails host (wailsapp_test.go).
type zoomWindow interface {
	GetZoom() float64
	SetZoom(magnification float64) application.Window
}

// WindowZoomResult is what WindowZoom and WindowSetZoom answer: the window's real zoom level as a fraction (1.25 is
// 125%), however it got there - a header button, Ctrl+=/-/0, Ctrl+wheel or pinch.
type WindowZoomResult struct {
	Level float64 `json:"level"`
}

// WindowZoom reads the window's current zoom level (ADR 0201 item 3): the UI asks for this when it sees the page's
// own zoom change (a devicePixelRatio or resize event), since Wails v3 surfaces no zoom-changed callback on Windows.
func (h *Host) WindowZoom() (string, error) {
	window, ok := mainWindow()
	if !ok {
		return "", errHostNotReady
	}
	return encodeBinding(readZoom(window), nil)
}

// WindowSetZoom sets the window's zoom to the nearest of zoomSteps, clamped to [zoomMin, zoomMax] regardless of what
// factor the caller sends - the defensive floor and ceiling behind the header's own disabled-at-100%/never-past-200%
// promise (Q6, ADR 0201). The UI calls this from the header's buttons, Ctrl+=/-/0, reset, and the "set back to 200%"
// clamp it runs itself when it sees an external (Ctrl+wheel or pinch) zoom above the ceiling; Ctrl+wheel and pinch
// never call it directly.
func (h *Host) WindowSetZoom(factor float64) (string, error) {
	window, ok := mainWindow()
	if !ok {
		return "", errHostNotReady
	}
	window.SetZoom(nearestZoomStep(factor))
	return encodeBinding(readZoom(window), nil)
}

func readZoom(window zoomWindow) WindowZoomResult {
	return WindowZoomResult{Level: window.GetZoom()}
}

// nearestZoomStep clamps factor to [zoomMin, zoomMax] and snaps it to the closest value in zoomSteps. A tie (exactly
// between two steps) keeps the lower one, since the loop only replaces its running answer on a strictly closer step.
func nearestZoomStep(factor float64) float64 {
	switch {
	case factor < zoomMin:
		factor = zoomMin
	case factor > zoomMax:
		factor = zoomMax
	}
	nearest := zoomSteps[0]
	for _, step := range zoomSteps {
		if math.Abs(step-factor) < math.Abs(nearest-factor) {
			nearest = step
		}
	}
	return nearest
}
