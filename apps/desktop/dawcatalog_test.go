package main

import (
	"context"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawcatalog"
)

// fakeDetector returns a Detector that reports installed at path/source when installed is true, and "not found"
// (an error, like a real registry miss) otherwise.
func fakeDetector(installed bool, path, source string) dawcatalog.Detector {
	return func() (string, string, error) {
		if !installed {
			return "", "", nil
		}
		return path, source, nil
	}
}

func TestDawCatalogListReportsEveryEntryWithItsDetectionState(t *testing.T) {
	detectors := map[string]dawcatalog.Detector{
		dawcatalog.REAPER.ID: fakeDetector(true, `C:\Program Files\REAPER (x64)\reaper.exe`, "uninstall_registry"),
	}
	entries := dawCatalogList(detectors)
	if len(entries) != len(dawcatalog.Catalog) {
		t.Fatalf("got %d entries, want %d (one per catalog entry)", len(entries), len(dawcatalog.Catalog))
	}
	reaper := entries[0]
	if reaper.ID != dawcatalog.REAPER.ID || reaper.Name != dawcatalog.REAPER.Name || reaper.Publisher != dawcatalog.REAPER.Publisher ||
		reaper.LicenseNote != dawcatalog.REAPER.LicenseNote {
		t.Fatalf("catalog copy did not survive: %+v", reaper)
	}
	if !reaper.Installed || reaper.Path != `C:\Program Files\REAPER (x64)\reaper.exe` || reaper.Source != "uninstall_registry" {
		t.Fatalf("detection state not reported: %+v", reaper)
	}
}

func TestDawCatalogListReportsNotInstalledWithoutClaimingAPath(t *testing.T) {
	detectors := map[string]dawcatalog.Detector{
		dawcatalog.REAPER.ID: fakeDetector(false, "", ""),
	}
	entries := dawCatalogList(detectors)
	if entries[0].Installed || entries[0].Path != "" || entries[0].Source != "" {
		t.Fatalf("not-detected entry must report no path or source: %+v", entries[0])
	}
}

// TestDawCatalogListWithNilDetectorsUsesTheDefaults is the production path DawCatalogList takes: it must not
// panic and must still answer one entry per catalog entry, whatever the real registry/path lookup on this
// machine finds (Technical Risks: a portable install is a documented soft false negative, never a crash).
func TestDawCatalogListWithNilDetectorsUsesTheDefaults(t *testing.T) {
	entries := dawCatalogList(nil)
	if len(entries) != len(dawcatalog.Catalog) {
		t.Fatalf("got %d entries, want %d", len(entries), len(dawcatalog.Catalog))
	}
	for i, entry := range entries {
		if entry.ID != dawcatalog.Catalog[i].ID {
			t.Errorf("entries[%d].ID = %q, want %q", i, entry.ID, dawcatalog.Catalog[i].ID)
		}
	}
}

// TestDawCatalogListMethodEncodesTheHostsDetectors exercises the exported binding itself, through its
// h.dawCatalogDetectors seam, and checks the JSON it hands back decodes to the same facts.
func TestDawCatalogListMethodEncodesTheHostsDetectors(t *testing.T) {
	host := NewHost()
	host.dawCatalogDetectors = map[string]dawcatalog.Detector{
		dawcatalog.REAPER.ID: fakeDetector(true, `C:\Program Files\REAPER (x64)\reaper.exe`, "file_association"),
	}
	text, err := host.DawCatalogList()
	if err != nil {
		t.Fatalf("DawCatalogList: %v", err)
	}
	if text == "" {
		t.Fatal("DawCatalogList returned empty JSON")
	}
}

func TestDawCatalogOpenDownloadPageOpensOnlyTheCatalogsOwnURLForAKnownID(t *testing.T) {
	host := NewHost()
	host.ctx = context.Background()
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.DawCatalogOpenDownloadPage(dawcatalog.REAPER.ID); err != nil {
		t.Fatalf("DawCatalogOpenDownloadPage: %v", err)
	}
	if len(opened) != 1 || opened[0] != dawcatalog.REAPER.DownloadURL {
		t.Fatalf("opened %v, want exactly [%q]", opened, dawcatalog.REAPER.DownloadURL)
	}
}

func TestDawCatalogOpenDownloadPageRefusesAnUnknownID(t *testing.T) {
	host := NewHost()
	host.ctx = context.Background()
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.DawCatalogOpenDownloadPage("not-a-real-daw"); err == nil {
		t.Fatal("want an error for an unknown catalog id")
	}
	if len(opened) != 0 {
		t.Fatalf("an unknown id must never open anything, opened %v", opened)
	}
}

// TestDawCatalogOpenDownloadPageRefusesBeforeTheHostIsReady mirrors openReleaseNotes's own guard: with no
// openURL seam and no ctx (Startup has not run), the binding must refuse rather than pass a nil context to the
// Wails runtime.
func TestDawCatalogOpenDownloadPageRefusesBeforeTheHostIsReady(t *testing.T) {
	host := NewHost()
	if _, err := host.DawCatalogOpenDownloadPage(dawcatalog.REAPER.ID); err == nil {
		t.Fatal("want an error before Startup has set a context")
	}
}
