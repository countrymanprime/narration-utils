// Package tracks reads REAPER project (.rpp) files directly from disk to
// list a project's tracks and the media each track's items reference. It
// does not depend on a running REAPER instance or the file-session Lua
// bridge (integrations/reaper/narration_ui_bridge.lua): that bridge only works
// while REAPER has NarrationUtils_Launcher.lua active for the current
// session, whereas a standalone-launched app (docs/architecture/
// standalone-launch.md) must be able to read tracks from a project folder
// on its own.
package tracks

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Item struct {
	Position        float64 `json:"position"`
	Length          float64 `json:"length"`
	Name            string  `json:"name"`
	SourceKind      string  `json:"sourceKind"`
	SourceFile      string  `json:"sourceFile"`
	SourceAvailable bool    `json:"sourceAvailable"`
	Supported       bool    `json:"supported"`
}

type Track struct {
	GUID   string `json:"guid"`
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Color  string `json:"color"`
	Muted  bool   `json:"muted"`
	Soloed bool   `json:"soloed"`
	Items  []Item `json:"items"`
}

type Project struct {
	Path   string  `json:"path"`
	Tracks []Track `json:"tracks"`
}

// Discover returns every top-level *.rpp project file directly inside
// folder, sorted by filename. It deliberately does not recurse: REAPER
// writes backup copies into a "Backups" subfolder and autosave/render
// output elsewhere under the project folder, and a nested "*.rpp" there is
// not a project the narrator opened.
func Discover(folder string) ([]string, error) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, err
	}
	var found []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".rpp") {
			found = append(found, filepath.Join(folder, entry.Name()))
		}
	}
	sort.Strings(found)
	return found, nil
}
