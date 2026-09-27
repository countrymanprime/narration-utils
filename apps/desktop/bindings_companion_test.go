package main

import (
	"errors"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// fakeCompanionWindow is a companionWindow whose size, position and screen are whatever a test wants, recording every
// SetSize/SetPosition/SetAlwaysOnTop call so a test can assert exactly what Companion mode's window mechanics did
// without a real Wails host: application.Get() returns nil in every test (wailsapp_test.go), so mainWindow() never
// succeeds outside a running app, and the real application.Window can't be constructed here either.
type fakeCompanionWindow struct {
	width, height int
	x, y          int
	screen        *application.Screen
	screenErr     error

	sizesSet     [][2]int
	positionsSet [][2]int
	alwaysOnTop  []bool
}

func newFakeCompanionWindow(width, height, x, y int) *fakeCompanionWindow {
	return &fakeCompanionWindow{
		width: width, height: height, x: x, y: y,
		screen: &application.Screen{WorkArea: application.Rect{X: 0, Y: 0, Width: 1920, Height: 1080}},
	}
}

func (f *fakeCompanionWindow) Size() (int, int)     { return f.width, f.height }
func (f *fakeCompanionWindow) Position() (int, int) { return f.x, f.y }
func (f *fakeCompanionWindow) GetScreen() (*application.Screen, error) {
	return f.screen, f.screenErr
}

func (f *fakeCompanionWindow) SetSize(width, height int) application.Window {
	f.sizesSet = append(f.sizesSet, [2]int{width, height})
	f.width, f.height = width, height
	return nil
}

func (f *fakeCompanionWindow) SetPosition(x, y int) {
	f.positionsSet = append(f.positionsSet, [2]int{x, y})
	f.x, f.y = x, y
}

func (f *fakeCompanionWindow) SetAlwaysOnTop(on bool) application.Window {
	f.alwaysOnTop = append(f.alwaysOnTop, on)
	return nil
}

func TestCompanionModeEnterSavesBoundsNarrowsAndPins(t *testing.T) {
	window := newFakeCompanionWindow(1280, 860, 100, 50)
	var state companionModeState

	state.enter(window)

	if len(window.sizesSet) != 1 || window.sizesSet[0] != [2]int{companionModeWidth, 860} {
		t.Fatalf("SetSize calls = %v, want one call to (%d, 860)", window.sizesSet, companionModeWidth)
	}
	if len(window.positionsSet) != 1 || window.positionsSet[0] != [2]int{100, 50} {
		t.Fatalf("SetPosition calls = %v, want one call to (100, 50): narrowing the window shouldn't move its top-left corner", window.positionsSet)
	}
	if len(window.alwaysOnTop) != 1 || !window.alwaysOnTop[0] {
		t.Fatalf("SetAlwaysOnTop calls = %v, want one call pinning the window", window.alwaysOnTop)
	}
	want := windowBounds{width: 1280, height: 860, x: 100, y: 50}
	if state.saved == nil || *state.saved != want {
		t.Fatalf("saved bounds = %+v, want %+v (the window's size and position before entering)", state.saved, want)
	}
}

func TestCompanionModeExitRestoresTheSavedBounds(t *testing.T) {
	window := newFakeCompanionWindow(1280, 860, 100, 50)
	var state companionModeState
	state.enter(window)

	state.exit(window)

	if got := window.sizesSet[len(window.sizesSet)-1]; got != [2]int{1280, 860} {
		t.Fatalf("last SetSize call = %v, want the saved (1280, 860)", got)
	}
	if got := window.positionsSet[len(window.positionsSet)-1]; got != [2]int{100, 50} {
		t.Fatalf("last SetPosition call = %v, want the saved (100, 50)", got)
	}
	if got := window.alwaysOnTop[len(window.alwaysOnTop)-1]; got {
		t.Fatalf("last SetAlwaysOnTop call = %v, want false: Exit un-pins the window", got)
	}
	if state.saved != nil {
		t.Fatalf("saved bounds = %+v after Exit, want nil: Exit clears what it restored", state.saved)
	}
}

func TestCompanionModeExitWithNothingSavedIsANoOp(t *testing.T) {
	window := newFakeCompanionWindow(1280, 860, 100, 50)
	var state companionModeState

	state.exit(window)

	if len(window.sizesSet) != 0 || len(window.positionsSet) != 0 || len(window.alwaysOnTop) != 0 {
		t.Fatalf("Exit with nothing saved touched the window: sizes %v, positions %v, alwaysOnTop %v",
			window.sizesSet, window.positionsSet, window.alwaysOnTop)
	}
}

func TestCompanionModeEnterTwiceKeepsTheFirstSavedBounds(t *testing.T) {
	window := newFakeCompanionWindow(1280, 860, 100, 50)
	var state companionModeState
	state.enter(window)

	// A second Enter (a double-fired toggle) must not overwrite the saved bounds with the already-narrowed ones.
	state.enter(window)

	if len(window.sizesSet) != 1 {
		t.Fatalf("SetSize called %d times on a second Enter, want 1: re-entering must be a no-op", len(window.sizesSet))
	}
	state.exit(window)
	if got := window.sizesSet[len(window.sizesSet)-1]; got != [2]int{1280, 860} {
		t.Fatalf("Exit restored %v, want the original (1280, 860), not the already-narrowed size", got)
	}
}

func TestCompanionModeEnterClampsPositionWhenTheWindowWouldLandOffScreen(t *testing.T) {
	window := newFakeCompanionWindow(1280, 860, 1700, 50)
	var state companionModeState

	state.enter(window)

	// 1700 + 380 = 2080, past the 1920-wide work area: Enter must pull the window back onto the screen rather than
	// shrink it in place and leave part of it hanging off the right edge.
	want := [2]int{1920 - companionModeWidth, 50}
	if got := window.positionsSet[0]; got != want {
		t.Fatalf("SetPosition = %v, want %v (clamped to the work area's right edge)", got, want)
	}
}

func TestCompanionModeEnterKeepsThePositionWhenTheScreenIsUnavailable(t *testing.T) {
	window := newFakeCompanionWindow(1280, 860, 1700, 50)
	window.screen = nil
	window.screenErr = errors.New("no screen for this window")
	var state companionModeState

	state.enter(window)

	if got := window.positionsSet[0]; got != [2]int{1700, 50} {
		t.Fatalf("SetPosition = %v, want the original position unchanged when the screen can't be read", got)
	}
}

func TestClampPositionToScreenKeepsARectangleInsideItsArea(t *testing.T) {
	area := application.Rect{X: 0, Y: 0, Width: 1920, Height: 1080}
	tests := []struct {
		name         string
		x, y         int
		wantX, wantY int
	}{
		{"already inside, unchanged", 100, 50, 100, 50},
		{"past the right edge, pulled back", 1700, 50, 1920 - 380, 50},
		{"past the bottom edge, pulled up", 100, 1000, 100, 1080 - 200},
		{"negative x, pulled to the left edge", -50, 50, 0, 50},
		{"negative y, pulled to the top edge", 100, -50, 100, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotX, gotY := clampPositionToScreen(tt.x, tt.y, 380, 200, area)
			if gotX != tt.wantX || gotY != tt.wantY {
				t.Errorf("clampPositionToScreen(%d, %d, ...) = (%d, %d), want (%d, %d)", tt.x, tt.y, gotX, gotY, tt.wantX, tt.wantY)
			}
		})
	}
}

func TestClampPositionToScreenAlignsAnOversizedWindowToTheAreasTopLeft(t *testing.T) {
	area := application.Rect{X: 100, Y: 100, Width: 300, Height: 200}

	gotX, gotY := clampPositionToScreen(50, 50, 380, 250, area)

	if gotX != area.X || gotY != area.Y {
		t.Errorf("clampPositionToScreen = (%d, %d), want (%d, %d): a window bigger than the area aligns to its top-left corner", gotX, gotY, area.X, area.Y)
	}
}

// With no application (every test) mainWindow() never succeeds, so both bindings answer errHostNotReady, the same
// contract every other window-touching binding in wailsapp.go already keeps (TestTheWailsHelpersNeedNoApplication).
func TestCompanionModeBindingsNeedTheHost(t *testing.T) {
	host := &Host{}
	if err := host.CompanionModeEnter(); !errors.Is(err, errHostNotReady) {
		t.Errorf("CompanionModeEnter() = %v, want errHostNotReady", err)
	}
	if err := host.CompanionModeExit(); !errors.Is(err, errHostNotReady) {
		t.Errorf("CompanionModeExit() = %v, want errHostNotReady", err)
	}
}
