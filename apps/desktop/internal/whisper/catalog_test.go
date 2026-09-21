package whisper

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
)

func TestCatalogExposesOnlyVerifiedState(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "catalog.json")
	if err := os.WriteFile(path, []byte(`{"catalogVersion":1,"models":[{"id":"tiny","provider":"faster-whisper","displayName":"Tiny","version":"1","files":[{"name":"model.bin","url":"https://example.invalid/model.bin","sha256":"00","size":1}]}]}`), 0o600); err != nil {
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
	m := &Manager{root: root, catalog: Catalog{Version: 1, Models: []Model{{ID: "tiny", Provider: "faster-whisper", Version: "1", Files: []File{{Name: "model.bin", SHA256: "00", Size: 1}}}}}}
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
	m := &Manager{root: root, catalog: Catalog{Version: 1, Models: []Model{{ID: "tiny", Provider: "faster-whisper", Version: "1", Files: []File{{Name: "model.bin", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}}}}}}
	if err := m.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}
	dir, err := m.Dir("tiny")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "model.bin")); err != nil {
		t.Fatal(err)
	}
	if err := m.Remove("tiny"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Dir("tiny"); err == nil {
		t.Fatal("a removed model must not resolve an install directory")
	}
}

// A model is read in full the first time a session uses it: 3 GB of damage is found before the model is loaded, and only once.
func TestDirReadsTheModelInFullOncePerSessionAndRepairFixesIt(t *testing.T) {
	body := []byte("model-bytes")
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	m := &Manager{root: t.TempDir(), catalog: Catalog{Version: 1, Models: []Model{{ID: "tiny", Provider: "faster-whisper", Version: "1", Files: []File{{Name: "model.bin", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}}}}}}
	if err := m.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}
	model, _ := m.Model("tiny")
	path := filepath.Join(assets.Dir(m.root, model.Provider, model.ID, model.Version), "model.bin")
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
