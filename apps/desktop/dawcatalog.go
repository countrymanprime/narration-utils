package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/dawcatalog"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// DawCatalogEntry is what DawCatalogList answers per catalog entry: the
// catalog copy plus its on-demand detection fact
// (docs/architecture/daw-integration.md). Path and Source
// are empty when Installed is false.
type DawCatalogEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Publisher   string `json:"publisher"`
	LicenseNote string `json:"licenseNote"`
	Installed   bool   `json:"installed"`
	Path        string `json:"path,omitempty"`
	Source      string `json:"source,omitempty"`
}

// DawCatalogList answers today's DAW catalog (REAPER only) with each entry's
// detection state, so a narrator with nothing installed can see what to get
// and a narrator who already has REAPER sees it confirmed. Detection runs
// fresh on every call (on demand, not polled - PRD Open Question A7); it
// never blocks and never claims more certainty than
// dawcatalog.Detect/DetectAll already give it (any detector error or empty
// path is "not detected").
func (h *Host) DawCatalogList() (string, error) {
	return encodeBinding(dawCatalogList(h.dawCatalogDetectors), nil)
}

// dawCatalogList is DawCatalogList's pure logic, kept apart from the host so
// it can be unit tested with a fake detectors map: a nil map (what
// h.dawCatalogDetectors is in production) defaults to
// dawcatalog.DefaultDetectors(), exactly as a nil detectors argument means in
// dawcatalog.DetectAll for a single entry.
func dawCatalogList(detectors map[string]dawcatalog.Detector) []DawCatalogEntry {
	if detectors == nil {
		detectors = dawcatalog.DefaultDetectors()
	}
	results := dawcatalog.DetectAll(dawcatalog.Catalog, detectors)
	byID := make(map[string]dawcatalog.DetectionResult, len(results))
	for _, result := range results {
		byID[result.EntryID] = result
	}
	entries := make([]DawCatalogEntry, len(dawcatalog.Catalog))
	for i, entry := range dawcatalog.Catalog {
		result := byID[entry.ID]
		entries[i] = DawCatalogEntry{
			ID:          entry.ID,
			Name:        entry.Name,
			Publisher:   entry.Publisher,
			LicenseNote: entry.LicenseNote,
			Installed:   result.Installed,
			Path:        result.Path,
			Source:      result.Source,
		}
	}
	return entries
}

// DawCatalogOpenDownloadPage opens the catalog entry id's official download
// page in the narrator's default browser, and nothing else: it never
// downloads, verifies or executes an installer (PRD "What We're NOT
// Building"). id crosses the Wails boundary, never a URL - the destination
// is always looked up server-side in the hardcoded dawcatalog.Catalog by
// dawcatalog.Lookup, so nothing UI-supplied can pick an arbitrary
// destination (PRD architecture notes; mirrors update.go's
// openReleaseNotes, the same trusted-URL discipline for the same reason).
func (h *Host) DawCatalogOpenDownloadPage(id string) (string, error) {
	entry, ok := dawcatalog.Lookup(id)
	if !ok {
		return "", fmt.Errorf("unknown DAW catalog entry %q", id)
	}
	h.mu.RLock()
	ctx, open := h.ctx, h.openURL
	h.mu.RUnlock()
	if open != nil {
		open(ctx, entry.DownloadURL)
		return encodeBinding(nil, nil)
	}
	if ctx == nil {
		return "", fmt.Errorf("the desktop host is not ready")
	}
	runtime.BrowserOpenURL(ctx, entry.DownloadURL)
	return encodeBinding(nil, nil)
}
