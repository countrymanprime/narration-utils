package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/wiktextract"
)

// testWiktextractManager builds a manager whose default source is genuinely installed, through the real Install
// pipeline (an httptest server serving a hand-built archive in the real Wiktextract JSON Lines shape, then unpacked
// and derived exactly as a real install would be) - the same discipline the wiktextract package's own catalog_test.go
// uses (prep-depth Phase 8, #782) rather than a hand-faked manifest, which would risk diverging from what State/Ready
// actually check.
func testWiktextractManager(t *testing.T, words map[string]wiktextract.WordEntry) *wiktextract.Manager {
	t.Helper()
	archive := zipFixtureOf(t, words)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(archive) }))
	t.Cleanup(server.Close)
	sum := sha256.Sum256(archive)
	catalog := map[string]any{"catalogVersion": 1, "sources": []map[string]any{{
		"id": "wiktextract-test", "provider": "wiktextract", "displayName": "Test Wiktextract", "version": "1",
		"publisher": "Wiktionary contributors", "license": "CC-BY-SA-4.0", "attribution": "Test Wiktextract (CC BY-SA 4.0)",
		"installedSize": 100,
		"files": []map[string]any{{
			"name": "wiktextract.zip", "url": server.URL, "sha256": hex.EncodeToString(sum[:]), "size": len(archive),
			"extract": "wiktextract", "expand": 2000,
		}},
	}}}
	catalogPath := filepath.Join(t.TempDir(), "wiktextract-assets.json")
	body, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(catalogPath, body, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := wiktextract.New(catalogPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Install(context.Background(), "wiktextract-test"); err != nil {
		t.Fatal(err)
	}
	return manager
}

// zipFixtureOf is words as a release archive: one JSON Lines file, "en-extract.jsonl", inside a "release" folder,
// the shape BuildIndex reads (one wiktextractEntry-shaped line per word) and a real kaikki.org zip release unpacks to.
func zipFixtureOf(t *testing.T, words map[string]wiktextract.WordEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("en-extract.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	for word, data := range words {
		sounds := []map[string]string{}
		if data.IPA != "" || data.Audio != "" {
			sounds = append(sounds, map[string]string{"ipa": data.IPA, "audio": data.Audio})
		}
		line, err := json.Marshal(map[string]any{"word": word, "sounds": sounds})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(append(line, '\n')); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func hostWithWiktextract(manager *wiktextract.Manager) *Host {
	host := NewHost()
	host.ctx = context.Background()
	host.wiktextractManager = func() (*wiktextract.Manager, error) { return manager, nil }
	return host
}

func TestPronunciationCommonsAudioOpenOpensTheWordsCommonsFile(t *testing.T) {
	manager := testWiktextractManager(t, map[string]wiktextract.WordEntry{"happy": {IPA: "/ˈhæpi/", Audio: "En-us-happy.ogg"}})
	host := hostWithWiktextract(manager)
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationCommonsAudioOpen("Happy"); err != nil {
		t.Fatalf("PronunciationCommonsAudioOpen: %v", err)
	}
	want := "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-happy.ogg"
	if len(opened) != 1 || opened[0] != want {
		t.Fatalf("opened %v, want exactly [%q]", opened, want)
	}
}

func TestPronunciationCommonsAudioOpenRefusesAWordWithNoAudioFile(t *testing.T) {
	manager := testWiktextractManager(t, map[string]wiktextract.WordEntry{"stoic": {IPA: "/ˈstoʊɪk/"}})
	host := hostWithWiktextract(manager)
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationCommonsAudioOpen("stoic"); err == nil {
		t.Fatal("want an error for a word indexed with no audio file")
	}
	if len(opened) != 0 {
		t.Fatalf("a word with no audio must never open anything, opened %v", opened)
	}
}

func TestPronunciationCommonsAudioOpenRefusesAWordNotInTheIndex(t *testing.T) {
	manager := testWiktextractManager(t, map[string]wiktextract.WordEntry{"happy": {IPA: "/ˈhæpi/", Audio: "En-us-happy.ogg"}})
	host := hostWithWiktextract(manager)
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationCommonsAudioOpen("gloomy"); err == nil {
		t.Fatal("want an error for a word the index does not have")
	}
	if len(opened) != 0 {
		t.Fatalf("an unindexed word must never open anything, opened %v", opened)
	}
}

func TestPronunciationCommonsAudioOpenRefusesWhenNothingIsInstalled(t *testing.T) {
	manager, err := wiktextract.New(productionWiktextractCatalogFixture(t), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	host := hostWithWiktextract(manager)
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationCommonsAudioOpen("happy"); err == nil {
		t.Fatal("want an error when the Wiktextract source is not installed")
	}
	if len(opened) != 0 {
		t.Fatalf("must never open anything when nothing is installed, opened %v", opened)
	}
}

// productionWiktextractCatalogFixture writes a one-source catalog (Pending, like the real config/wiktextract-assets.json)
// so Installed reports ErrNotInstalled without touching the real catalog file.
func productionWiktextractCatalogFixture(t *testing.T) string {
	t.Helper()
	catalog := map[string]any{"catalogVersion": 1, "sources": []map[string]any{{
		"id": "wiktextract-en-pronunciation", "provider": "wiktextract", "displayName": "Wiktionary pronunciations",
		"version": wiktextract.Pending,
		"files":   []map[string]any{{"name": "x.zip", "url": wiktextract.Pending, "sha256": wiktextract.Pending, "size": 0, "extract": "wiktextract"}},
	}}}
	path := filepath.Join(t.TempDir(), "wiktextract-assets.json")
	body, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPronunciationCommonsAudioOpenRefusesBeforeTheHostIsReady(t *testing.T) {
	manager := testWiktextractManager(t, map[string]wiktextract.WordEntry{"happy": {IPA: "/ˈhæpi/", Audio: "En-us-happy.ogg"}})
	host := NewHost()
	host.wiktextractManager = func() (*wiktextract.Manager, error) { return manager, nil }
	if _, err := host.PronunciationCommonsAudioOpen("happy"); err == nil {
		t.Fatal("want an error before Startup has set a context")
	}
}
