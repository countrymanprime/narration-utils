package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

func newTestHostForTranscriptStart(t *testing.T, body []byte, server *httptest.Server) *Host {
	t.Helper()
	repoRoot := t.TempDir()
	cacheRoot := t.TempDir()
	sum := sha256.Sum256(body)
	catalogPath := filepath.Join(t.TempDir(), "whisper-assets.json")
	catalog := map[string]any{
		"catalogVersion": 1,
		"models": []map[string]any{{
			"id": "tiny", "provider": "faster-whisper", "displayName": "Tiny", "version": "1", "publisher": "Systran", "license": "MIT",
			"files": []map[string]any{{"name": "model.bin", "url": server.URL, "sha256": hex.EncodeToString(sum[:]), "size": len(body)}},
		}},
	}
	bytes, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(catalogPath, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	whisperManager, err := whisper.New(catalogPath, cacheRoot)
	if err != nil {
		t.Fatal(err)
	}
	store := settings.New(repoRoot, "")
	transcriptService := transcript.New(transcript.Config{}, nil, store, process.NewSupervisor(), nil)
	return &Host{settings: store, whisper: whisperManager, transcript: transcriptService, whisperJobs: map[string]*whisperJob{}}
}

func TestTranscriptStartRequestsTheApprovedModelWhenNotInstalled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("model-bytes")) }))
	defer server.Close()
	host := newTestHostForTranscriptStart(t, []byte("model-bytes"), server)

	raw, err := host.TranscriptStart(map[string]string{"model": "tiny"})
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result["status"] != "asset_required" {
		t.Fatalf("status = %v, want asset_required", result["status"])
	}
	model, ok := result["model"].(map[string]any)
	if !ok || model["id"] != "tiny" {
		t.Fatalf("model = %#v", result["model"])
	}
}

func TestTranscriptStartRejectsAModelOutsideTheApprovedCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("model-bytes")) }))
	defer server.Close()
	host := newTestHostForTranscriptStart(t, []byte("model-bytes"), server)

	if _, err := host.TranscriptStart(map[string]string{"model": "not-a-real-model"}); err == nil {
		t.Fatal("expected an error for a model outside the approved catalog")
	}
}

// Once the selected model is installed and verified, TranscriptStart must
// clear the asset gate and reach transcript.Service.Start, whose own
// "save the REAPER project..." error (from an intentionally bare Config{})
// is the deterministic signal that the gate was passed rather than tripped.
func TestTranscriptStartProceedsOnceTheModelIsInstalled(t *testing.T) {
	body := []byte("model-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	host := newTestHostForTranscriptStart(t, body, server)
	if err := host.whisper.Install(context.Background(), "tiny"); err != nil {
		t.Fatal(err)
	}

	_, err := host.TranscriptStart(map[string]string{"model": "tiny"})
	if err == nil || !strings.Contains(err.Error(), "REAPER project") {
		t.Fatalf("expected the post-gate Start() project error, got %v", err)
	}
}
