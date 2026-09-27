package main

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Companion mode resizes and pins the app's one existing window; it never opens a second one (ADR 0401, reconciling
// with docs/prds/wails-v3-migration.prd.md's "no second window" decision). CompanionModeEnter and CompanionModeExit
// are the only two bindings this needs: the layout that fills the narrowed window (CompactShell) is a later phase.

// companionModeWidth is the fixed width Companion mode narrows the window to (PRD Open Question 3), matching the
// atlas's narrow-width convention (ADR 0061).
const companionModeWidth = 380

// windowBounds is a window's size and position, saved by CompanionModeEnter so CompanionModeExit can put the window
// back exactly where the narrator left it.
type windowBounds struct {
	width, height int
	x, y          int
}

// companionWindow is the subset of application.Window Companion mode's window mechanics need. Outside a running Wails
// host application.Get() returns nil (wailsapp.go), so there is no real window to test the save/restore/clamp logic
// against; it is written here against this narrower interface instead and exercised with a fake
// (bindings_companion_test.go). A real application.Window satisfies it with no adapter, since every method below has
// the same signature as its counterpart on application.Window.
type companionWindow interface {
	Size() (width, height int)
	Position() (x, y int)
	GetScreen() (*application.Screen, error)
	SetSize(width, height int) application.Window
	SetPosition(x, y int)
	SetAlwaysOnTop(b bool) application.Window
}

// companionModeState remembers the window's bounds from before Companion mode narrowed it. One instance (companion,
// below) backs the real bindings; tests use their own so cases never see another case's saved bounds.
type companionModeState struct {
	mu sync.Mutex
	// +checklocks:mu
	saved *windowBounds
}

// companion is Companion mode's state for the app's one window.
var companion companionModeState

// enter saves the window's current bounds, narrows it to companionModeWidth (kept inside the window's current screen),
// and pins it always-on-top. Companion mode is already active, a second Enter is a no-op: overwriting the saved bounds
// with the already-narrowed ones would lose what Exit needs to restore.
func (s *companionModeState) enter(window companionWindow) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved != nil {
		return
	}
	width, height := window.Size()
	x, y := window.Position()
	s.saved = &windowBounds{width: width, height: height, x: x, y: y}

	newX, newY := x, y
	if screen, err := window.GetScreen(); err == nil && screen != nil {
		newX, newY = clampPositionToScreen(x, y, companionModeWidth, height, screen.WorkArea)
	}
	window.SetSize(companionModeWidth, height)
	window.SetPosition(newX, newY)
	window.SetAlwaysOnTop(true)
}

// exit restores the bounds enter saved and un-pins the window. Exiting with nothing saved (Companion mode was never
// entered, or was already exited) is a no-op: "Full app" and the double-Escape rule (Open Question 5) can both reach
// this on the same window.
func (s *companionModeState) exit(window companionWindow) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved == nil {
		return
	}
	saved := *s.saved
	s.saved = nil
	window.SetSize(saved.width, saved.height)
	window.SetPosition(saved.x, saved.y)
	window.SetAlwaysOnTop(false)
}

// clampPositionToScreen moves a width×height rectangle as little as possible so it fits inside area, aligning to
// area's top-left corner if the rectangle is bigger than area along an axis. Companion mode only ever shrinks the
// window's width and keeps its height, so this only has work to do if the screen itself changed since the position
// being placed was valid: a display was disconnected, or GetScreen answers for a different monitor than the one the
// window last sat on.
func clampPositionToScreen(x, y, width, height int, area application.Rect) (int, int) {
	if maxX := area.X + area.Width - width; x > maxX {
		x = maxX
	}
	if x < area.X {
		x = area.X
	}
	if maxY := area.Y + area.Height - height; y > maxY {
		y = maxY
	}
	if y < area.Y {
		y = area.Y
	}
	return x, y
}

// CompanionModeEnter narrows the app's one window to the companion width and pins it always-on-top, saving its prior
// size and position so CompanionModeExit can restore them. It never opens a second window (ADR 0401).
func (h *Host) CompanionModeEnter() error {
	window, ok := mainWindow()
	if !ok {
		return errHostNotReady
	}
	companion.enter(window)
	return nil
}

// CompanionModeExit restores the window's size, position and always-on-top state to what they were before
// CompanionModeEnter: the "Full app" action and the double-Escape rule (Open Question 5) both call this.
func (h *Host) CompanionModeExit() error {
	window, ok := mainWindow()
	if !ok {
		return errHostNotReady
	}
	companion.exit(window)
	return nil
}
