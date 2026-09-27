// Command spike-globalhotkeys is a throwaway proof-of-concept for Phase 12 of the
// Input Commands and Pedals PRD (docs/prds/input-commands-and-pedals.prd.md, tracking
// issue #646): can Wails v3 or the OS register a hotkey that still fires while another
// application (REAPER) has OS focus?
//
// It is NOT wired into the shipped narration-utils binary (cmd/narration-utils), is not
// built by any CI job, and is not meant to ship. It exists only so this spike's answer
// rests on a program that actually compiles against the exact pinned Wails v3 dependency
// (github.com/wailsapp/wails/v3 v3.0.0-beta.25), not on reading its source in isolation.
//
// What this proves: the app.GlobalShortcut API this app would call for a real companion-panel
// feature is present in the pinned Wails version and builds clean for Windows (this app's only
// shipped target — see .github/workflows/ci.yml, `runs-on: windows-latest`) with the same
// CGO_ENABLED=0 cross-compilation this repository already uses for its real Windows build.
// See docs/research/global-hotkeys-while-reaper-has-focus.md for what it does NOT prove (no
// Windows/macOS/Linux desktop session or REAPER process was available in this container to
// click-test focus behaviour or run REAPER itself).
package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	app := application.New(application.Options{
		Name:        "Global Hotkey Spike",
		Description: "Phase 12 spike: does a global shortcut fire while another app has focus?",
	})

	app.Window.New()

	// The accelerator a companion-panel pedal binding would use. CmdOrCtrl resolves to
	// Command on macOS and Control elsewhere (pkg/application/global_shortcut_manager.go).
	const accel = "CmdOrCtrl+Shift+F13"

	if err := app.GlobalShortcut.Register(accel, func() {
		log.Printf("spike: global shortcut %q fired", accel)
		// A real binding would post this into the same command router the keymap (Phase 1)
		// already dispatches keyboard/MIDI/HID presses through, not emit a page event directly.
		app.Event.Emit("spike:fired", accel)
	}); err != nil {
		log.Fatalf("spike: could not register %q: %v", accel, err)
	}

	log.Printf("spike: registered %v — switch focus to another window (in a real session, REAPER) and press %s", app.GlobalShortcut.GetAll(), accel)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
