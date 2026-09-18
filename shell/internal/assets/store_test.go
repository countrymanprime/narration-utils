package assets

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

func TestStateReportsNotInstalledWhenAbsent(t *testing.T) {
	root := t.TempDir()
	files := []File{{Name: "x", SHA256: "00", Size: 1}}
	if got := State(root, "p", "id", "1", files); got != "not_installed" {
		t.Fatal(got)
	}
}

func TestInstallVerifiesBeforeActivation(t *testing.T) {
	body := []byte("payload")
	sum := sha256.Sum256(body)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	root := t.TempDir()
	files := []File{{Name: "model.bin", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatal(err)
	}
	if got := State(root, "p", "id", "1", files); got != "installed" {
		t.Fatal(got)
	}
	if err := Remove(root, "p", "id", "1"); err != nil {
		t.Fatal(err)
	}
	if got := State(root, "p", "id", "1", files); got != "not_installed" {
		t.Fatal(got)
	}
}

func TestInstallLeavesNoPartialAssetOnHashMismatch(t *testing.T) {
	body := []byte("payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	root := t.TempDir()
	files := []File{{Name: "model.bin", URL: server.URL, SHA256: "0000000000000000000000000000000000000000000000000000000000000", Size: int64(len(body))}}
	if err := Install(context.Background(), root, "p", "id", "1", files); err == nil {
		t.Fatal("expected a hash mismatch to fail installation")
	}
	if _, err := os.Stat(Dir(root, "p", "id", "1")); !os.IsNotExist(err) {
		t.Fatal("a failed install must not leave a target directory behind")
	}
	if _, err := os.Stat(Dir(root, "p", "id", "1") + ".installing"); !os.IsNotExist(err) {
		t.Fatal("a failed install must clean up its staging directory")
	}
}

func TestInstallIsIdempotentOnceInstalled(t *testing.T) {
	body := []byte("payload")
	sum := sha256.Sum256(body)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; _, _ = w.Write(body) }))
	defer server.Close()
	root := t.TempDir()
	files := []File{{Name: "model.bin", URL: server.URL, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("expected a single download, got %d", calls)
	}
}

func TestDirIsScopedByProviderIDAndVersion(t *testing.T) {
	got := Dir("root", "provider", "id", "1.0")
	want := filepath.Join("root", "provider", "id", "1.0")
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
