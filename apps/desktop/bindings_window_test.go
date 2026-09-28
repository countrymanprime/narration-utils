package main

import (
	"errors"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// fakeZoomWindow is a zoomWindow whose zoom level is whatever a test wants, recording every SetZoom call - the same
// approach bindings_companion_test.go's fakeCompanionWindow uses, since a real application.Window can't be
// constructed outside a running Wails host (application.Get() is nil in every test, wailsapp_test.go).
type fakeZoomWindow struct {
	level    float64
	setCalls []float64
}

func (f *fakeZoomWindow) GetZoom() float64 { return f.level }

func (f *fakeZoomWindow) SetZoom(magnification float64) application.Window {
	f.setCalls = append(f.setCalls, magnification)
	f.level = magnification
	return nil
}

func TestNearestZoomStepSnapsToTheClosestStep(t *testing.T) {
	tests := []struct {
		name   string
		factor float64
		want   float64
	}{
		{"an exact step is unchanged", 1.25, 1.25},
		{"below the lowest step clamps to 100%", 0.5, zoomMin},
		{"above the highest step clamps to 200%", 3.0, zoomMax},
		{"closer to the lower neighbour snaps down", 1.15, 1.10},
		{"closer to the higher neighbour snaps up", 1.20, 1.25},
		{"exactly between two steps keeps the lower one", 1.175, 1.10},
		{"a reset factor snaps to 100%", 1.0, 1.0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := nearestZoomStep(tt.factor); got != tt.want {
				t.Errorf("nearestZoomStep(%v) = %v, want %v", tt.factor, got, tt.want)
			}
		})
	}
}

func TestReadZoomReportsTheWindowsCurrentLevel(t *testing.T) {
	window := &fakeZoomWindow{level: 1.5}
	if got := readZoom(window); got.Level != 1.5 {
		t.Errorf("readZoom(window).Level = %v, want 1.5", got.Level)
	}
}

// With no application (every test) mainWindow() never succeeds, so both bindings answer errHostNotReady, the same
// contract every other window-touching binding keeps (TestCompanionModeBindingsNeedTheHost,
// TestTheWailsHelpersNeedNoApplication).
func TestWindowZoomBindingsNeedTheHost(t *testing.T) {
	host := &Host{}
	if _, err := host.WindowZoom(); !errors.Is(err, errHostNotReady) {
		t.Errorf("WindowZoom() error = %v, want errHostNotReady", err)
	}
	if _, err := host.WindowSetZoom(1.25); !errors.Is(err, errHostNotReady) {
		t.Errorf("WindowSetZoom() error = %v, want errHostNotReady", err)
	}
}
