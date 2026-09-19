package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// cmd/narration-utils/frontend/dist is populated from shared/ui/dist by the shell build script.
// Keeping the copy inside the Go module makes release artifacts independent
// of a checkout path.
//
//go:embed all:cmd/narration-utils/frontend/dist
var assets embed.FS

// Release preparation places the immutable Python sidecars and their runtime
// files here. They are embedded into the native application rather than read
// from a checkout at runtime.
//
//go:embed all:cmd/narration-utils/resources
var resources embed.FS

func main() {
	app := NewHost()
	err := wails.Run(&options.App{
		Title:              "Narration Utils",
		Width:              1280,
		Height:             860,
		MinWidth:           960,
		MinHeight:          640,
		AssetServer:        &assetserver.Options{Assets: assets, Middleware: app.mediaMiddleware},
		OnStartup:          app.Startup,
		OnShutdown:         app.Shutdown,
		Bind:               []interface{}{app},
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: "b742fa00-67d8-4a0c-a290-b70b193cc785", OnSecondInstanceLaunch: app.onSecondInstance},
	})
	if err != nil {
		log.Fatal(err)
	}
}
