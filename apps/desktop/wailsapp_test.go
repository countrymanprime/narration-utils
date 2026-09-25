package main

import (
	"errors"
	"testing"
)

// The window options that differ from Wails v3's defaults are deliberate (main.go, docs/adr/0200). Each one silently changes what the
// narrator gets if it is lost, so each is held here.
func TestMainWindowKeepsCtrlWheelZoomAndHidesTheBrowserMenu(t *testing.T) {
	options := mainWindowOptions()
	if !options.ZoomControlEnabled {
		t.Error("ZoomControlEnabled is off: Wails v3 turns WebView2's Ctrl+wheel zoom off unless it is asked for")
	}
	if !options.DefaultContextMenuDisabled {
		t.Error("the browser's right-click menu (Reload, Inspect) is shown; v2 hid it in a production build")
	}
	if options.Name != mainWindowName {
		t.Errorf("window name = %q, want %q: the host finds the window by this name", options.Name, mainWindowName)
	}
	if options.Zoom != 0 {
		t.Errorf("startup zoom = %v, want WebView2's own (0): the remembered level is nav PRD Phase 3's", options.Zoom)
	}
	if options.MinWidth != 960 || options.MinHeight != 640 || options.Width != 1280 || options.Height != 860 {
		t.Errorf("window size changed: %d×%d, minimum %d×%d", options.Width, options.Height, options.MinWidth, options.MinHeight)
	}
}

// Wails v3's Windows dialog reports a cancel as an error; v2 reported an empty path, and the bindings still answer "nothing selected".
func TestADialogCancelIsNothingSelectedNotAnError(t *testing.T) {
	if err := cancelIsEmpty(errors.New(dialogCancelled)); err != nil {
		t.Errorf("cancel = %v, want nil", err)
	}
	if err := cancelIsEmpty(nil); err != nil {
		t.Errorf("nil = %v, want nil", err)
	}
	failure := errors.New("the dialog could not open")
	if err := cancelIsEmpty(failure); !errors.Is(err, failure) {
		t.Errorf("a real failure = %v, want it passed through", err)
	}
}

// With no application (every test, and the early modes before main.go creates it) the helpers never crash.
func TestTheWailsHelpersNeedNoApplication(t *testing.T) {
	emitEvent("system:notice", noticePayload("x"))
	bringWindowForward()
	quitApplication()
	if _, ok := mainWindow(); ok {
		t.Error("found a window with no application")
	}
	if _, err := pickFile("t", nil); !errors.Is(err, errHostNotReady) {
		t.Errorf("pickFile = %v, want errHostNotReady", err)
	}
	if _, err := pickFiles("t", nil); !errors.Is(err, errHostNotReady) {
		t.Errorf("pickFiles = %v, want errHostNotReady", err)
	}
	if _, err := pickFolder("t"); !errors.Is(err, errHostNotReady) {
		t.Errorf("pickFolder = %v, want errHostNotReady", err)
	}
	if err := openInBrowser("https://example.invalid/"); !errors.Is(err, errHostNotReady) {
		t.Errorf("openInBrowser = %v, want errHostNotReady", err)
	}
}
