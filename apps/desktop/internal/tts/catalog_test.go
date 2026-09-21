package tts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
	if err := os.WriteFile(path, []byte(`{"catalogVersion":1,"voices":[{"id":"v","provider":"p","displayName":"V","locale":"en","version":"1","files":[{"name":"x","url":"https://example.invalid/x","sha256":"00","size":1}]}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	m, err := New(path, root)
	if err != nil {
		t.Fatal(err)
	}
	v, _ := m.Voice("v")
	if got := m.State(v); got != "not_installed" {
		t.Fatal(got)
	}
}

func TestCatalogIncludesVoiceDownloadSize(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "catalog.json")
	if err := os.WriteFile(path, []byte(`{"catalogVersion":1,"voices":[{"id":"voice","files":[{"name":"one","size":7},{"name":"two","size":11}]}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(path, root)
	if err != nil {
		t.Fatal(err)
	}
	voices := manager.Catalog()["voices"].([]map[string]any)
	if voices[0]["downloadSize"] != int64(18) {
		t.Fatalf("download size = %#v", voices[0]["downloadSize"])
	}
}

func TestUnknownVoiceNeverLooksInstalled(t *testing.T) {
	m := &Manager{root: t.TempDir(), catalog: Catalog{Version: 1}}
	if _, _, err := m.Paths("unknown"); err == nil {
		t.Fatal("an unknown voice must not resolve asset paths")
	}
}

func TestInstallVerifiesBeforeActivation(t *testing.T) {
	body := []byte("voice")
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	m := &Manager{root: t.TempDir(), catalog: Catalog{Version: 1, Voices: []Voice{{ID: "v", Provider: "p", Version: "1", Files: []File{{Name: "v.onnx", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}}}}}}
	if err := m.Install(context.Background(), "v"); err != nil {
		t.Fatal(err)
	}
	v, _ := m.Voice("v")
	if m.State(v) != "installed" {
		t.Fatal(m.State(v))
	}
	if err := m.Remove("v"); err != nil {
		t.Fatal(err)
	}
	if m.State(v) != "not_installed" {
		t.Fatal(m.State(v))
	}
}

// A voice is read in full the first time a session uses it, so a file that was damaged after the install is found before Piper loads it.
func TestPathsReadsTheVoiceInFullOncePerSession(t *testing.T) {
	m, path := installedVoice(t)
	v, _ := m.Voice("v")
	assets.Forget(m.root, v.Provider, v.ID, v.Version)
	info, _ := os.Stat(path)
	if err := os.WriteFile(path, []byte("VOICE"), 0o600); err != nil { // same size, other bytes
		t.Fatal(err)
	}
	_ = os.Chtimes(path, info.ModTime(), info.ModTime())
	if m.State(v) != "installed" {
		t.Fatal("the listing trusts the manifest")
	}
	if _, _, err := m.Paths("v"); err == nil {
		t.Fatal("the first use of a session must hash the voice and refuse a damaged one")
	}
}

func TestVerifyAndRepairFixADamagedVoice(t *testing.T) {
	m, path := installedVoice(t)
	v, _ := m.Voice("v")
	if err := os.WriteFile(path, []byte("garbage"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := m.Verify("v"); err != nil || got != "verification_failed" {
		t.Fatalf("Verify = %s, %v", got, err)
	}
	if m.State(v) != "verification_failed" {
		t.Fatal("a damaged voice must be listed as needing repair")
	}
	if err := m.Repair(context.Background(), "v", assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if got, _ := m.Verify("v"); got != "installed" {
		t.Fatalf("after Repair Verify = %s", got)
	}
	if _, err := m.Verify("nope"); err == nil {
		t.Fatal("an unknown voice cannot be verified")
	}
}

// An install checks the disk first: a voice that does not fit is refused before anything is fetched.
func TestInstallRefusesADiskThatCannotHoldTheVoice(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++ }))
	defer server.Close()
	m := &Manager{root: t.TempDir(), catalog: Catalog{Version: 1, Voices: []Voice{{ID: "v", Provider: "p", Version: "1", Files: []File{{Name: "v.onnx", URL: server.URL, SHA256: "00", Size: 1 << 60}}}}}}
	err := m.Install(context.Background(), "v")
	var short *assets.InsufficientSpaceError
	if !errors.As(err, &short) {
		t.Fatalf("err = %v, want InsufficientSpaceError", err)
	}
	if requests != 0 {
		t.Fatal("nothing may be fetched when the disk is too small")
	}
}

func installedVoice(t *testing.T) (*Manager, string) {
	t.Helper()
	body := []byte("voice")
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(server.Close)
	m := &Manager{root: t.TempDir(), catalog: Catalog{Version: 1, Voices: []Voice{{ID: "v", Provider: "p", Version: "1", Files: []File{
		{Name: "v.onnx", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))},
		{Name: "v.onnx.json", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))},
	}}}}}
	if err := m.Install(context.Background(), "v"); err != nil {
		t.Fatal(err)
	}
	return m, filepath.Join(assets.Dir(m.root, "p", "v", "1"), "v.onnx")
}
