package main

import (
	"context"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
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
	app := NewHost()
	err := wails.Run(&options.App{
		Title:              "Narration Utils",
		Width:              1280,
		Height:             860,
		MinWidth:           960,
		MinHeight:          640,
		AssetServer:        &assetserver.Options{Assets: frontendAssets, Middleware: app.mediaMiddleware},
		OnStartup:          app.Startup,
		OnShutdown:         app.Shutdown,
		Bind:               []interface{}{app},
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: "b742fa00-67d8-4a0c-a290-b70b193cc785", OnSecondInstanceLaunch: app.onSecondInstance},
	})
	if err != nil {
		log.Fatal(err)
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
