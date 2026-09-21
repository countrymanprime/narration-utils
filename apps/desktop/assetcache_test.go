package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The asset cache is a per-user folder. If the operating system cannot say where that is, the answer is an error, never the temporary
// folder: a multi-gigabyte download must not land where a cleanup tool deletes it.
func TestTheAssetCacheIsNeverTheTemporaryFolder(t *testing.T) {
	t.Setenv("LocalAppData", "")
	t.Setenv("XDG_CACHE_HOME", "")
	t.Setenv("HOME", "")
	if base, err := assetCacheBase(); err == nil {
		t.Fatalf("assetCacheBase = %q with no per-user cache folder, want an error", base)
	}
}

func TestTheAssetCacheLivesUnderTheUsersCacheFolder(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LocalAppData", dir)
	t.Setenv("XDG_CACHE_HOME", dir)
	t.Setenv("HOME", dir)
	base, err := assetCacheBase()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join("narration-utils", "assets"); filepath.Base(filepath.Dir(base)) != "narration-utils" || filepath.Base(base) != "assets" {
		t.Fatalf("assetCacheBase = %q, want a path ending %q", base, want)
	}
}

func TestStartupRemovesStaleDownloadLeftoversFromEveryAssetFolder(t *testing.T) {
	base := t.TempDir()
	old := time.Now().Add(-10 * 24 * time.Hour)
	for _, provider := range []string{"tts", "whisper"} {
		stale := filepath.Join(base, provider, "piper", "x", "1.installing")
		if err := os.MkdirAll(stale, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(stale, old, old); err != nil {
			t.Fatal(err)
		}
	}
	if removed := cleanAssetCaches(base); len(removed) != 2 {
		t.Fatalf("removed %v, want the two stale staging folders", removed)
	}
}
