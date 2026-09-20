package main

import (
	"net/http"
	"os"
	"path/filepath"
)

const mediaRoute = "/media"

// mediaMiddleware serves local media files referenced by the current
// project's parsed tracks directly to the embedded webview, entirely
// in-process: Wails' AssetServer intercepts webview resource requests (on
// Windows, WebView2's virtual-host-mapped scheme handler), not a bound TCP
// socket - see docs/architecture/daw-integration.md's "no loopback server"
// rule. http.ServeContent gives Range-request support for free, which the
// track player needs to seek without loading a whole chapter-length file
// into memory.
func (h *Host) mediaMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != mediaRoute {
			next.ServeHTTP(w, r)
			return
		}
		path, ok := h.authorizedMediaSource(filepath.Clean(r.URL.Query().Get("path")))
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		file, err := os.Open(path)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.ServeContent(w, r, filepath.Base(path), info.ModTime(), file)
	})
}

// authorizedMediaSource refuses to serve anything that is not a source file
// the current project's currently selected .rpp actually references -
// otherwise the media route would be an arbitrary local file read. It
// re-resolves the project's tracks on every request rather than trusting a
// cache, so a project switch or an .rpp re-selection takes effect
// immediately instead of leaving a stale file servable. It returns the
// project's own copy of the matched path, never the requested string, so
// the file that gets opened is always one the parsed project vouched for.
func (h *Host) authorizedMediaSource(requested string) (string, bool) {
	project, err := h.tracksList()
	if err != nil {
		return "", false
	}
	for _, track := range project.Tracks {
		for _, item := range track.Items {
			if item.SourceFile != "" && item.SourceFile == requested {
				return item.SourceFile, true
			}
		}
	}
	return "", false
}
