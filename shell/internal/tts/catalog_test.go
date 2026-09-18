package tts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
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
