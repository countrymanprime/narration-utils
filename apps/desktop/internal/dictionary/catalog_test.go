package dictionary

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// testManager is a manager over a one-dictionary catalog whose archive is the fixture, served by a test server that counts requests.
func testManager(t *testing.T) (*Manager, *atomic.Int64) {
	t.Helper()
	archive := zipFixture(t, oewnFixture)
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_, _ = w.Write(archive)
	}))
	t.Cleanup(server.Close)
	sum := sha256.Sum256(archive)
	catalog := map[string]any{"catalogVersion": 1, "dictionaries": []map[string]any{{
		"id": "oewn-test", "provider": "oewn", "displayName": "Test WordNet", "version": "2025", "publisher": "OEWN", "license": "CC-BY-4.0",
		"attribution": "Test WordNet (CC BY 4.0)", "installedSize": 4000,
		"files": []map[string]any{{"name": "wn.zip", "url": server.URL, "sha256": hex.EncodeToString(sum[:]), "size": len(archive), "extract": "wordnet", "expand": 20000}},
	}}}
	path := filepath.Join(t.TempDir(), "dictionary-assets.json")
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

func TestNothingIsDownloadedUntilTheDictionaryIsInstalled(t *testing.T) {
	manager, requests := testManager(t)
	if _, err := manager.Lookup("oewn-test", "happy"); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("err = %v, want ErrNotInstalled", err)
	}
	dictionary, ok := manager.Default()
	if !ok || dictionary.ID != "oewn-test" || manager.State(dictionary) != "not_installed" {
		t.Fatalf("Default = %+v, %v", dictionary, ok)
	}
	if requests.Load() != 0 {
		t.Fatalf("%d requests before an install was asked for", requests.Load())
	}
}

func TestInstallingBuildsTheIndexAndKeepsOnlyIt(t *testing.T) {
	manager, _ := testManager(t)
	if err := manager.Install(context.Background(), "oewn-test"); err != nil {
		t.Fatal(err)
	}
	dir := manager.InstallDir("oewn-test")
	entries, err := os.ReadDir(filepath.Join(dir, "wordnet"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != IndexName {
		t.Fatalf("the install keeps %v, want only the index", entries)
	}
	result, err := manager.Lookup("oewn-test", "Happier")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Entries) != 1 || result.Entries[0].Headword != "happy" {
		t.Fatalf("result = %+v", result)
	}
}

func TestADamagedIndexIsFoundAndRepaired(t *testing.T) {
	manager, requests := testManager(t)
	if err := manager.Install(context.Background(), "oewn-test"); err != nil {
		t.Fatal(err)
	}
	index := filepath.Join(manager.InstallDir("oewn-test"), "wordnet", IndexName)
	if err := os.WriteFile(index, []byte("damaged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if state, err := manager.Verify("oewn-test"); err != nil || state != "verification_failed" {
		t.Fatalf("Verify = %s, %v", state, err)
	}
	if _, err := manager.Lookup("oewn-test", "happy"); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("a damaged dictionary answered a lookup: %v", err)
	}
	if err := manager.Repair(context.Background(), "oewn-test", assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 2 {
		t.Fatalf("%d downloads, want the install and the repair", requests.Load())
	}
	if _, err := manager.Lookup("oewn-test", "happy"); err != nil {
		t.Fatalf("after Repair: %v", err)
	}
}

// A lookup leaves nothing open, so the Manage local assets page can remove the dictionary straight after one (Windows refuses to remove an
// open file).
func TestAnInstalledDictionaryCanBeRemovedStraightAfterALookup(t *testing.T) {
	manager, _ := testManager(t)
	if err := manager.Install(context.Background(), "oewn-test"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Lookup("oewn-test", "run"); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remove("oewn-test"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(manager.InstallDir("oewn-test")); !os.IsNotExist(err) {
		t.Fatalf("the install is still there: %v", err)
	}
}

// The index was ready at the start of the lookup but is gone or unreadable when it is opened (a Remove or a Repair ran in between): the
// answer is "not installed", so the caller offers the download, not a raw file error.
func TestAnIndexThatVanishesAfterItWasReadyIsNotInstalled(t *testing.T) {
	manager, _ := testManager(t)
	if err := manager.Install(context.Background(), "oewn-test"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Lookup("oewn-test", "happy"); err != nil {
		t.Fatal(err) // the session's full read is done: later lookups trust the manifest
	}
	dictionary, _ := manager.Dictionary("oewn-test")
	index := manager.indexPath(dictionary)
	info, err := os.Stat(index)
	if err != nil {
		t.Fatal(err)
	}
	// Damage that keeps the size and time the manifest recorded, so State still trusts it: only the reads can find it.
	if err := os.WriteFile(index, make([]byte, info.Size()), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(index, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Lookup("oewn-test", "happy"); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("damaged: err = %v, want ErrNotInstalled", err)
	}
	if _, err := manager.Lookup("oewn-test", "happy"); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("the next lookup must read it in full again and find the damage: %v", err)
	}
	if err := manager.Repair(context.Background(), "oewn-test", assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Lookup("oewn-test", "happy"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(index); err != nil {
		t.Fatal(err)
	}
	if _, err := LookupFile(index, "happy"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("LookupFile of a missing index: %v", err)
	}
	if _, err := manager.Lookup("oewn-test", "happy"); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("missing: err = %v, want ErrNotInstalled", err)
	}
}

func TestADictionaryTheCatalogDoesNotNameIsRefused(t *testing.T) {
	manager, _ := testManager(t)
	for name, call := range map[string]func() error{
		"lookup":  func() error { _, err := manager.Lookup("other", "happy"); return err },
		"install": func() error { return manager.Install(context.Background(), "other") },
		"verify":  func() error { _, err := manager.Verify("other"); return err },
		"remove":  func() error { return manager.Remove("other") },
	} {
		if err := call(); err == nil || !strings.Contains(err.Error(), "not in the approved catalog") {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestTheDiskSizeIsTheIndexNotTheUnpackedDataset(t *testing.T) {
	manager, _ := testManager(t)
	dictionary, _ := manager.Dictionary("oewn-test")
	if dictionary.DiskSize() != 4000 || dictionary.DownloadSize() <= 0 {
		t.Fatalf("sizes = %d on disk, %d to download", dictionary.DiskSize(), dictionary.DownloadSize())
	}
}

func TestACatalogEntryThatIsNotOneUnpackedArchiveIsRefused(t *testing.T) {
	for name, files := range map[string][]map[string]any{
		"no files":       {},
		"not an archive": {{"name": "wn.json", "url": "https://example.test/wn.json", "sha256": strings.Repeat("a", 64), "size": 1}},
		"two archives": {
			{"name": "a.zip", "url": "https://example.test/a.zip", "sha256": strings.Repeat("a", 64), "size": 1, "extract": "a", "expand": 1},
			{"name": "b.zip", "url": "https://example.test/b.zip", "sha256": strings.Repeat("b", 64), "size": 1, "extract": "b", "expand": 1},
		},
	} {
		t.Run(name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{"catalogVersion": 1, "dictionaries": []map[string]any{{"id": "x", "provider": "oewn", "version": "1", "files": files}}})
			path := filepath.Join(t.TempDir(), "d.json")
			if err := os.WriteFile(path, body, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := New(path, t.TempDir()); err == nil {
				t.Fatal("the catalog was accepted")
			}
		})
	}
}

// The approved catalog: the Open English WordNet 2025 JSON release (ADR 0097), one pinned, hashed archive from the project's own release,
// with the licence and attribution the lookup UI and the notices show.
func TestTheApprovedCatalogIsThePinnedOpenEnglishWordNetRelease(t *testing.T) {
	manager, err := New(layout.RepoFile(layout.DictionaryCatalogFile), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dictionary, ok := manager.Default()
	if !ok || dictionary.ID != "oewn-2025" || dictionary.License != "CC-BY-4.0" {
		t.Fatalf("Default = %+v", dictionary)
	}
	file := dictionary.Files[0]
	if !strings.HasPrefix(file.URL, "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/") || len(file.SHA256) != 64 || file.Size <= 0 {
		t.Fatalf("the archive is not pinned to the 2025 release: %+v", file)
	}
	for _, credit := range []string{"Open English WordNet", "CC BY 4.0", "Princeton WordNet", "WordNet License"} {
		if !strings.Contains(dictionary.Attribution, credit) {
			t.Errorf("the attribution does not credit %q: %s", credit, dictionary.Attribution)
		}
	}
	if dictionary.InstalledSize <= 0 || dictionary.InstalledSize >= file.Expand {
		t.Fatalf("installedSize %d must be the measured index, smaller than the %d-byte dataset", dictionary.InstalledSize, file.Expand)
	}
}
