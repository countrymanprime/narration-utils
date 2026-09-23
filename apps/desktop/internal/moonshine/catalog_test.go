package moonshine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

func TestCatalogExposesOnlyVerifiedState(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "catalog.json")
	if err := os.WriteFile(path, []byte(`{"catalogVersion":1,"models":[{"id":"tiny","provider":"moonshine","displayName":"Tiny","version":"1","files":[{"name":"encoder.ort","url":"https://example.invalid/encoder.ort","sha256":"00","size":1}]}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := New(path, root)
	if err != nil {
		t.Fatal(err)
	}
	model, _ := m.Model("tiny")
	if got := m.State(model); got != "not_installed" {
		t.Fatal(got)
	}
}

func TestUnknownModelNeverResolvesADirectory(t *testing.T) {
	m := &Manager{root: t.TempDir(), catalog: Catalog{Version: 1}}
	if _, err := m.Dir("unknown"); err == nil {
		t.Fatal("an unknown model must not resolve an install directory")
	}
}

func TestDirRequiresEveryFileVerified(t *testing.T) {
	root := t.TempDir()
	m := &Manager{root: root, catalog: Catalog{Version: 1, Models: []Model{{ID: "tiny", Provider: "moonshine", Version: "1", Files: []File{{Name: "encoder.ort", SHA256: "00", Size: 1}}}}}}
	if _, err := m.Dir("tiny"); err == nil {
		t.Fatal("an uninstalled model must not resolve an install directory")
	}
}

func TestInstallVerifiesBeforeActivationThenResolvesDir(t *testing.T) {
	body := []byte("model-bytes")
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	root := t.TempDir()
	m := &Manager{root: root, catalog: Catalog{Version: 1, Models: []Model{{ID: "tiny", Provider: "moonshine", Version: "1", Files: []File{{Name: "encoder.ort", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}}}}}}
	if err := m.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}
	dir, err := m.Dir("tiny")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "encoder.ort")); err != nil {
		t.Fatal(err)
	}
	if err := m.Remove("tiny"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Dir("tiny"); err == nil {
		t.Fatal("a removed model must not resolve an install directory")
	}
}

// A model is read in full the first time a session uses it: damage is found before the engine loads it, and only once per session.
func TestDirReadsTheModelInFullOncePerSessionAndRepairFixesIt(t *testing.T) {
	body := []byte("model-bytes")
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	m := &Manager{root: t.TempDir(), catalog: Catalog{Version: 1, Models: []Model{{ID: "tiny", Provider: "moonshine", Version: "1", Files: []File{{Name: "encoder.ort", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}}}}}}
	if err := m.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}
	model, _ := m.Model("tiny")
	path := filepath.Join(assets.Dir(m.root, model.Provider, model.ID, model.Version), "encoder.ort")
	assets.Forget(m.root, model.Provider, model.ID, model.Version)
	info, _ := os.Stat(path)
	if err := os.WriteFile(path, []byte("MODEL-BYTES"), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(path, info.ModTime(), info.ModTime())
	if m.State(model) != "installed" {
		t.Fatal("the listing trusts the manifest and reads nothing")
	}
	if _, err := m.Dir("tiny"); err == nil {
		t.Fatal("the first use of a session must hash the model and refuse a damaged one")
	}
	if got, err := m.Verify("tiny"); err != nil || got != "verification_failed" {
		t.Fatalf("Verify = %s, %v", got, err)
	}
	if err := m.Repair(context.Background(), "tiny", assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Dir("tiny"); err != nil {
		t.Fatalf("a repaired model must resolve: %v", err)
	}
}

// A hash mismatch (a corrupted or tampered download) must never become launchable: this is the catalog's whole reason for pinning SHA-256.
func TestAHashMismatchIsNeverLaunchable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("wrong-bytes")) }))
	defer server.Close()
	root := t.TempDir()
	wantSum := sha256.Sum256([]byte("model-bytes"))
	m := &Manager{root: root, catalog: Catalog{Version: 1, Models: []Model{{ID: "tiny", Provider: "moonshine", Version: "1", Files: []File{{Name: "encoder.ort", URL: server.URL, SHA256: hex.EncodeToString(wantSum[:]), Size: 11}}}}}}
	if err := m.Install(context.Background(), "tiny"); err == nil {
		t.Fatal("a checksum mismatch must fail Install, not install anyway")
	}
	if _, err := m.Dir("tiny"); err == nil {
		t.Fatal("a hash mismatch must never resolve an install directory")
	}
}

// The catalog schema mirrors internal/whisper's exactly, so the asset registry's generic assetProvider interface wraps it the same way and
// no third bespoke binding family is needed (teleprompter-engines-and-input-devices.prd.md phase 5 "Depends" note).
func TestRealCatalogLoadsAndEveryModelListsTheWordTimestampFile(t *testing.T) {
	m, err := New(layout.RepoFile(layout.MoonshineCatalogFile), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	models := m.Models()
	if len(models) == 0 {
		t.Fatal("the approved catalog has no models")
	}
	for _, model := range models {
		if model.Provider != "moonshine" {
			t.Errorf("%s: provider = %q, want \"moonshine\" so its install directory never collides with the Whisper catalog's own %q id", model.ID, model.Provider, model.ID)
		}
		if model.License != "MIT" {
			t.Errorf("%s: license = %q, want MIT (verified at the pinned artifact; only the excluded non-English legacy models are not)", model.ID, model.License)
		}
		found := false
		for _, file := range model.Files {
			if file.Name == "decoder_kv_with_attention.ort" {
				found = true
			}
			if file.SHA256 == "" || file.Size == 0 || file.URL == "" {
				t.Errorf("%s/%s: an approved catalog file must have a URL, size and SHA-256", model.ID, file.Name)
			}
		}
		if !found {
			t.Errorf("%s: the catalog must list the word-timestamp attention decoder (decoder_kv_with_attention.ort), or timestamps silently degrade", model.ID)
		}
	}
}
