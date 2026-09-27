package wiktextract

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// TestTheProductionCatalogParsesAndIsPending checks config/wiktextract-assets.json itself: it must parse (one archive per
// source), and (until docs/research/wiktextract-pronunciation-source.md's follow-up fills in the real URL and SHA-256) its
// one row must read as Pending, so nothing downloads a guessed value.
func TestTheProductionCatalogParsesAndIsPending(t *testing.T) {
	manager, err := New(layout.RepoFile(layout.WiktextractCatalogFile), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source, ok := manager.Default()
	if !ok {
		t.Fatal("the production catalog has no source")
	}
	if !source.Pending() {
		t.Fatalf("the production catalog's %q row is no longer Pending: fill in its verified URL/SHA-256 and update this test", source.ID)
	}
}

// zipFixture is wiktextractFixture as a release archive: one file, "en-extract.jsonl", inside a "release" folder, the
// shape a real kaikki.org zip release would unpack to.
func zipFixture(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("en-extract.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte(wiktextractFixture)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// testManager is a manager over a one-source catalog whose archive is the fixture, served by a test server that counts
// requests. Unlike the production config/wiktextract-assets.json, this catalog's URL and SHA-256 are real (computed from
// the served fixture), so the full install pipeline is exercised end to end (docs/research/wiktextract-pronunciation-source.md).
func testManager(t *testing.T) (*Manager, *atomic.Int64) {
	t.Helper()
	archive := zipFixture(t)
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_, _ = w.Write(archive)
	}))
	t.Cleanup(server.Close)
	sum := sha256.Sum256(archive)
	catalog := map[string]any{"catalogVersion": 1, "sources": []map[string]any{{
		"id": "wiktextract-test", "provider": "wiktextract", "displayName": "Test Wiktextract", "version": "test",
		"publisher": "Wiktionary contributors", "license": "CC-BY-SA-4.0", "attribution": "Test Wiktextract (CC BY-SA 4.0)",
		"installedSize": 100,
		"files": []map[string]any{{
			"name": "wiktextract.zip", "url": server.URL, "sha256": hex.EncodeToString(sum[:]), "size": len(archive),
			"extract": "wiktextract", "expand": 2000,
		}},
	}}}
	path := filepath.Join(t.TempDir(), "wiktextract-assets.json")
	body, _ := json.Marshal(catalog)
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(path, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return manager, &requests
}

func TestNothingIsDownloadedUntilTheSourceIsInstalled(t *testing.T) {
	manager, requests := testManager(t)
	if _, err := manager.Installed("wiktextract-test"); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("err = %v, want ErrNotInstalled", err)
	}
	source, ok := manager.Default()
	if !ok || source.ID != "wiktextract-test" || manager.State(source) != "not_installed" {
		t.Fatalf("Default = %+v, %v", source, ok)
	}
	if requests.Load() != 0 {
		t.Fatalf("%d requests before an install was asked for", requests.Load())
	}
}

func TestInstallingBuildsTheIndexAndKeepsOnlyIt(t *testing.T) {
	manager, _ := testManager(t)
	if err := manager.Install(context.Background(), "wiktextract-test"); err != nil {
		t.Fatal(err)
	}
	dir := manager.InstallDir("wiktextract-test")
	entries, err := os.ReadDir(filepath.Join(dir, "wiktextract"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != IndexName {
		t.Fatalf("the install keeps %v, want only the index", entries)
	}
	path, err := manager.Installed("wiktextract-test")
	if err != nil {
		t.Fatal(err)
	}
	words, err := LoadIndex(path)
	if err != nil {
		t.Fatal(err)
	}
	if words["happy"].IPA != "/ˈhæpi/" {
		t.Fatalf("words[happy] = %+v", words["happy"])
	}
}

func TestIndexPathMatchesWhatInstalledReturnsOnceInstalled(t *testing.T) {
	manager, _ := testManager(t)
	before, err := manager.IndexPath("wiktextract-test")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Install(context.Background(), "wiktextract-test"); err != nil {
		t.Fatal(err)
	}
	after, err := manager.Installed("wiktextract-test")
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("IndexPath (before install) = %q, Installed (after install) = %q, want equal", before, after)
	}
}

func TestAPendingSourceRefusesToInstallOrRepair(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wiktextract-assets.json")
	body, _ := json.Marshal(map[string]any{"catalogVersion": 1, "sources": []map[string]any{{
		"id": "wiktextract-en-pronunciation", "provider": "wiktextract", "displayName": "Wiktionary pronunciations",
		"version": Pending,
		"files":   []map[string]any{{"name": "x.zip", "url": Pending, "sha256": Pending, "size": 0, "extract": "wiktextract"}},
	}}})
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(path, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Install(context.Background(), "wiktextract-en-pronunciation"); !errors.Is(err, ErrPendingVerification) {
		t.Fatalf("Install = %v, want ErrPendingVerification", err)
	}
	if err := manager.Repair(context.Background(), "wiktextract-en-pronunciation", assets.Options{}); !errors.Is(err, ErrPendingVerification) {
		t.Fatalf("Repair = %v, want ErrPendingVerification", err)
	}
}

func TestANotApprovedSourceIsRefused(t *testing.T) {
	manager, _ := testManager(t)
	if _, err := manager.Installed("nope"); err == nil {
		t.Fatal("want an error for an unapproved id")
	}
	if err := manager.Remove("nope"); err == nil {
		t.Fatal("want an error for an unapproved id")
	}
}
