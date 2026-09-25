package main

import (
	"context"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// cmd/narration-utils/frontend/dist is populated from apps/ui/dist by the shell build script.
// Keeping the copy inside the Go module makes release artifacts independent
// of a checkout path.
//
//go:embed all:cmd/narration-utils/frontend/dist
var frontendAssets embed.FS

// Release preparation places the immutable Python sidecars and their runtime
// files here. They are embedded into the native application rather than read
// from a checkout at runtime.
//
//go:embed all:cmd/narration-utils/resources
var resources embed.FS // its root inside the file system is resourcesRoot (smoke.go)

func main() {
	// The modes that answer and exit come before everything that starts the program for real: the update relaunch logic, the
	// single-instance lock and the window.
	if code, handled := runEarlyModes(os.Args[1:], resources, os.Stdout, os.Stderr); handled {
		os.Exit(code)
	}
	if !startAfterUpdate() {
		return
	}
	host := NewHost()
	app := application.New(application.Options{
		Name: "Narration Utils",
		// The Host is the one bound service: the page calls only its exported methods (docs/adr/0200).
		Services: []application.Service{application.NewService(host)},
		// Wails finds index.html inside the embedded folder, as v2 did; /media is the host's own route (media.go).
		Assets:         application.AssetOptions{Handler: application.AssetFileServerFS(frontendAssets), Middleware: host.mediaMiddleware},
		SingleInstance: &application.SingleInstanceOptions{UniqueID: "b742fa00-67d8-4a0c-a290-b70b193cc785", OnSecondInstanceLaunch: host.onSecondInstance},
		// Closing the window quits on every platform, as it did on v2 (a macOS app stays running by default under v3).
		Mac: application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	app.Window.NewWithOptions(mainWindowOptions())
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// mainWindowOptions is the app's one window. What differs from Wails v3's defaults is deliberate and kept as it was on v2
// (docs/adr/0200, main_test.go):
//   - ZoomControlEnabled: v3 turns WebView2's zoom control off unless asked, which would silently stop Ctrl+wheel zoom. Pinch zoom
//     stays on because v3 leaves WebView2's IsPinchZoomEnabled at its default. The header's zoom controls (nav PRD Phase 2) set the
//     level at runtime with Window.SetZoom on the window this names.
//   - DefaultContextMenuDisabled: v2 hid the browser's right-click menu (Reload, Inspect) in a production build; v3 shows it.
func mainWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Name:                       mainWindowName,
		Title:                      "Narration Utils",
		Width:                      1280,
		Height:                     860,
		MinWidth:                   960,
		MinHeight:                  640,
		URL:                        "/",
		ZoomControlEnabled:         true,
		DefaultContextMenuDisabled: true,
	}
}

// runEarlyModes runs the modes that print something and exit (`--version`, and `--smoke`, smoke.go) and reports whether the arguments
// were one of them, with the exit code. A program started any other way carries on to open its window.
func runEarlyModes(arguments []string, embedded fs.FS, stdout, stderr io.Writer) (code int, handled bool) {
	switch {
	case isVersionRequest(arguments):
		_, _ = fmt.Fprintln(stdout, version)
		return 0, true
	case isSmokeRequest(arguments):
		return runSmoke(context.Background(), arguments, embedded, stdout, stderr), true
	}
	return 0, false
}
