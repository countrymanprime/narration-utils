package main

import (
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
	"strings"
	"sync/atomic"
	"testing"
)

// seedFixture is a fake checkout (three tiny catalogs) served by a local HTTP server, so the tests download nothing real.
type seedFixture struct {
	root, cache string
	requests    atomic.Int32
	corrupt     atomic.Bool
	bodies      map[string][]byte
}

func newSeedFixture(t *testing.T) *seedFixture {
	t.Helper()
	f := &seedFixture{root: t.TempDir(), cache: t.TempDir(), bodies: map[string][]byte{
		"/voice.onnx": []byte(strings.Repeat("v", 3000)),
		"/tiny.bin":   []byte(strings.Repeat("w", 2000)),
		"/model.txt":  []byte(strings.Repeat("s", 1000)),
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests.Add(1)
		body, ok := f.bodies[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if f.corrupt.Load() {
			body = bytes.Repeat([]byte("z"), len(body))
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	file := func(path string) []map[string]any {
		sum := sha256.Sum256(f.bodies[path])
		return []map[string]any{{"name": path[1:], "url": server.URL + path, "sha256": hex.EncodeToString(sum[:]), "size": len(f.bodies[path])}}
	}
	catalogs := map[string]any{
		"tts-assets.json":     map[string]any{"catalogVersion": 1, "voices": []map[string]any{{"id": "voice-a", "provider": "piper", "displayName": "A", "version": "1", "files": file("/voice.onnx")}}},
		"whisper-assets.json": map[string]any{"catalogVersion": 1, "models": []map[string]any{{"id": "tiny", "provider": "faster-whisper", "displayName": "T", "version": "1", "files": file("/tiny.bin")}, {"id": "small", "provider": "faster-whisper", "displayName": "S", "version": "1", "files": file("/tiny.bin")}}},
		"spacy-assets.json":   map[string]any{"catalogVersion": 1, "models": []map[string]any{{"id": "en_core_web_sm", "provider": "spacy", "displayName": "SM", "version": "1", "files": file("/model.txt")}}},
	}
	if err := os.MkdirAll(filepath.Join(f.root, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, catalog := range catalogs {
		encoded, err := json.Marshal(catalog)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(f.root, "config", name), encoded, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f *seedFixture) run(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var out, errOut bytes.Buffer
	err := run(context.Background(), append([]string{"--repo-root", f.root, "--cache-dir", f.cache}, args...), &out, &errOut)
	return out.String() + errOut.String(), err
}

func TestSeedingAVoiceInstallsItVerifiedInTheAssetCacheLayout(t *testing.T) {
	f := newSeedFixture(t)
	out, err := f.run(t, "tts/voice-a")
	if err != nil {
		t.Fatalf("seed: %v\n%s", err, out)
	}
	installed := filepath.Join(f.cache, "tts", "piper", "voice-a", "1")
	if _, statErr := os.Stat(filepath.Join(installed, "voice.onnx")); statErr != nil {
		t.Fatalf("the voice is not where the app looks for it (%s): %v", installed, statErr)
	}
	if _, statErr := os.Stat(filepath.Join(installed, "manifest.json")); statErr != nil {
		t.Fatalf("no manifest: the app could not tell it is verified: %v", statErr)
	}
	if !strings.Contains(out, "installed and verified") {
		t.Fatalf("output %q does not say it verified", out)
	}
}

func TestSeedingAKindInstallsEveryApprovedAssetOfThatKindAndNothingElse(t *testing.T) {
	f := newSeedFixture(t)
	if out, err := f.run(t, "whisper"); err != nil {
		t.Fatalf("seed: %v\n%s", err, out)
	}
	for _, id := range []string{"tiny", "small"} {
		if _, err := os.Stat(filepath.Join(f.cache, "whisper", "faster-whisper", id, "1", "tiny.bin")); err != nil {
			t.Fatalf("whisper %s missing: %v", id, err)
		}
	}
	for _, other := range []string{"tts", "spacy"} {
		if _, err := os.Stat(filepath.Join(f.cache, other)); err == nil {
			t.Fatalf("seeding whisper created the %s folder", other)
		}
	}
}

func TestSeedingAllInstallsEveryKind(t *testing.T) {
	f := newSeedFixture(t)
	if out, err := f.run(t, "all"); err != nil {
		t.Fatalf("seed: %v\n%s", err, out)
	}
	for _, path := range []string{"tts/piper/voice-a/1/voice.onnx", "whisper/faster-whisper/tiny/1/tiny.bin", "spacy/spacy/en_core_web_sm/1/model.txt"} {
		if _, err := os.Stat(filepath.Join(f.cache, filepath.FromSlash(path))); err != nil {
			t.Fatalf("%s missing: %v", path, err)
		}
	}
}

func TestSeedingAnInstalledAssetAgainDownloadsNothing(t *testing.T) {
	f := newSeedFixture(t)
	if out, err := f.run(t, "tts"); err != nil {
		t.Fatalf("first seed: %v\n%s", err, out)
	}
	before := f.requests.Load()
	out, err := f.run(t, "tts")
	if err != nil {
		t.Fatalf("second seed: %v\n%s", err, out)
	}
	if f.requests.Load() != before {
		t.Fatalf("an installed asset was downloaded again (%d requests, was %d)", f.requests.Load(), before)
	}
	if !strings.Contains(out, "already installed and verified") {
		t.Fatalf("output %q should say it left the asset alone", out)
	}
}

func TestSeedingAServerThatSendsTheWrongBytesFailsAndInstallsNothing(t *testing.T) {
	f := newSeedFixture(t)
	f.corrupt.Store(true)
	out, err := f.run(t, "tts/voice-a")
	if err == nil {
		t.Fatalf("a file that does not match its hash was accepted:\n%s", out)
	}
	if !strings.Contains(err.Error(), "tts/voice-a") {
		t.Fatalf("the error %q does not name the asset that failed", err)
	}
	if _, statErr := os.Stat(filepath.Join(f.cache, "tts", "piper", "voice-a", "1")); statErr == nil {
		t.Fatal("a failed seed left an installed-looking folder")
	}
}

func TestSeedingRefusesWhatTheCatalogsDoNotApproveBeforeDownloadingAnything(t *testing.T) {
	f := newSeedFixture(t)
	for _, args := range [][]string{{"moonshine"}, {"tts/not-a-voice"}, {"tts", "whisper/huge"}, {}} {
		if out, err := f.run(t, args...); err == nil {
			t.Fatalf("%v was accepted:\n%s", args, out)
		}
	}
	if f.requests.Load() != 0 {
		t.Fatalf("a refused request still downloaded (%d requests)", f.requests.Load())
	}
}

func TestListShowsEveryApprovedAssetAndItsStateAndInstallsNothing(t *testing.T) {
	f := newSeedFixture(t)
	if out, err := f.run(t, "tts"); err != nil {
		t.Fatalf("seed: %v\n%s", err, out)
	}
	before := f.requests.Load()
	out, err := f.run(t, "--list")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"tts/voice-a\tinstalled", "whisper/tiny\tnot_installed", "spacy/en_core_web_sm\tnot_installed"} {
		if !strings.Contains(out, want) {
			t.Fatalf("--list output %q lacks %q", out, want)
		}
	}
	if f.requests.Load() != before {
		t.Fatal("--list downloaded something")
	}
}

func TestSeedingOutsideACheckoutNamesTheMissingCatalog(t *testing.T) {
	var out, errOut bytes.Buffer
	err := run(context.Background(), []string{"--repo-root", t.TempDir(), "--cache-dir", t.TempDir(), "tts"}, &out, &errOut)
	if err == nil || !strings.Contains(err.Error(), "voice catalog") {
		t.Fatalf("err = %v, want it to name the voice catalog", err)
	}
}

func TestACancelledSeedStopsAndInstallsNothing(t *testing.T) {
	f := newSeedFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var out, errOut bytes.Buffer
	if err := run(ctx, []string{"--repo-root", f.root, "--cache-dir", f.cache, "tts"}, &out, &errOut); !errors.Is(err, context.Canceled) {
		t.Fatalf("a cancelled seed returned %v, want context.Canceled", err)
	}
	if _, err := os.Stat(filepath.Join(f.cache, "tts", "piper", "voice-a", "1")); err == nil {
		t.Fatal("a cancelled seed left an installed asset")
	}
}

func TestALeadingSeparatorFromPnpmIsNotAnArgument(t *testing.T) {
	f := newSeedFixture(t)
	var listing, errOut bytes.Buffer
	if err := run(context.Background(), []string{"--", "--repo-root", f.root, "--cache-dir", f.cache, "--list"}, &listing, &errOut); err != nil {
		t.Fatalf("a leading -- broke the flags: %v", err)
	}
	if !strings.Contains(listing.String(), "tts/voice-a") {
		t.Fatalf("--list output %q", listing.String())
	}
}

func TestAnEmptyCatalogIsAnErrorAndNotASuccessThatInstalledNothing(t *testing.T) {
	f := newSeedFixture(t)
	empty := []byte(`{"catalogVersion":1,"voices":[]}`)
	if err := os.WriteFile(filepath.Join(f.root, "config", "tts-assets.json"), empty, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, word := range []string{"tts", "all"} {
		if out, err := f.run(t, word); err == nil || !strings.Contains(err.Error(), "no assets") {
			t.Fatalf("seeding %q from an empty voice catalog: err = %v: %s", word, err, out)
		}
	}
}
