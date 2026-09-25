package main

import (
	"errors"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Every call the host makes into Wails goes through this file (docs/adr/0200). Wails v3 keeps one application per process, which
// application.New sets in main.go and application.Get returns; in a test there is none, so each helper here is a no-op or an error,
// never a crash. The host still keeps its own ctx: it is set in ServiceStartup and means "the window exists".

// mainWindowName names the one window main.go opens, so the host finds it again for a second launch, a dialog or zoom.
const mainWindowName = "main"

// errHostNotReady is what a binding that needs the window answers before the application exists.
var errHostNotReady = errors.New("the desktop host is not ready")

// emitEvent sends one live event to the window. The payload arrives in the UI as the event's `data` (apps/ui/src/api/wailsClient.ts).
func emitEvent(name string, data any) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, data)
	}
}

func mainWindow() (application.Window, bool) {
	app := application.Get()
	if app == nil {
		return nil, false
	}
	return app.Window.GetByName(mainWindowName)
}

// bringWindowForward shows the window in front of REAPER when a second launch hands this one a project (onSecondInstance).
func bringWindowForward() {
	window, ok := mainWindow()
	if !ok {
		return
	}
	window.Show()
	window.UnMinimise()
	window.SetAlwaysOnTop(true)
	window.SetAlwaysOnTop(false)
	window.Focus()
}

// fileFilter is one row of a file dialog's type list.
type fileFilter struct{ displayName, pattern string }

// openDialog starts a file dialog over the main window.
func openDialog(title string, filters []fileFilter) (*application.OpenFileDialogStruct, error) {
	app := application.Get()
	if app == nil {
		return nil, errHostNotReady
	}
	dialog := app.Dialog.OpenFile().SetTitle(title)
	for _, filter := range filters {
		dialog.AddFilter(filter.displayName, filter.pattern)
	}
	if window, ok := mainWindow(); ok {
		dialog.AttachToWindow(window)
	}
	return dialog, nil
}

// pickFile asks for one file; an empty path means the narrator cancelled.
func pickFile(title string, filters []fileFilter) (string, error) {
	dialog, err := openDialog(title, filters)
	if err != nil {
		return "", err
	}
	path, err := dialog.CanChooseFiles(true).PromptForSingleSelection()
	return path, cancelIsEmpty(err)
}

// pickFiles asks for any number of files; none means the narrator cancelled.
func pickFiles(title string, filters []fileFilter) ([]string, error) {
	dialog, err := openDialog(title, filters)
	if err != nil {
		return nil, err
	}
	paths, err := dialog.CanChooseFiles(true).PromptForMultipleSelection()
	if err = cancelIsEmpty(err); err != nil {
		return nil, err
	}
	return paths, nil
}

// pickFolder asks for a folder, and lets the narrator make a new one from the dialog.
func pickFolder(title string) (string, error) {
	dialog, err := openDialog(title, nil)
	if err != nil {
		return "", err
	}
	path, err := dialog.CanChooseFiles(false).CanChooseDirectories(true).CanCreateDirectories(true).PromptForSingleSelection()
	return path, cancelIsEmpty(err)
}

// dialogCancelled is the message Wails v3's Windows file dialog returns when the narrator closes it without choosing (its
// go-common-file-dialog ErrorCancelled, in an internal package this module cannot import). Wails v2 returned an empty path and no
// error instead, and the bindings above still answer that way: a cancel is "nothing selected", never an error the UI shows.
const dialogCancelled = "cancelled by user"

func cancelIsEmpty(err error) error {
	if err != nil && err.Error() == dialogCancelled {
		return nil
	}
	return err
}

// openInBrowser opens an address the host built itself (a release's notes, a DAW's download page) in the default browser.
func openInBrowser(address string) error {
	app := application.Get()
	if app == nil {
		return errHostNotReady
	}
	if err := app.Browser.OpenURL(address); err != nil {
		return fmt.Errorf("open %s in the browser: %w", address, err)
	}
	return nil
}

// quitApplication ends the program, as closing its window does: ServiceShutdown runs first.
func quitApplication() {
	if app := application.Get(); app != nil {
		app.Quit()
	}
}
