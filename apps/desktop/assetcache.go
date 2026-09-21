package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// The per-asset-kind folders under the asset cache. Each provider keeps its own catalog and its own folder, so removing one kind never
// touches another.
const (
	ttsCacheDir     = "tts"
	whisperCacheDir = "whisper"
)

// assetCacheBase is where downloaded assets live: the per-user cache folder, outside the release, the project and the checkout. When the
// operating system cannot say where that is the answer is an error and not the temporary folder, which a cleanup tool empties: a
// multi-gigabyte download must not land there.
func assetCacheBase() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("the per-user cache folder for downloaded models could not be found: %w", err)
	}
	return filepath.Join(base, "narration-utils", "assets"), nil
}

// cleanAssetCaches removes what an interrupted download or repair left under the asset cache and nothing will resume: run once at start.
// It returns what it removed.
func cleanAssetCaches(base string) []string {
	return append(assets.CleanStale(filepath.Join(base, ttsCacheDir)), assets.CleanStale(filepath.Join(base, whisperCacheDir))...)
}

// buildTtsManager reads the voice catalog (the checkout's, or the packaged release's) and returns a manager over root. When the catalog
// cannot be read the previous manager is kept, as before: a rebuild that fails must not take a working catalog away.
func buildTtsManager(cfg config, packagedRoot, root string, previous *tts.Manager) *tts.Manager {
	catalog := layout.Path(cfg.repoRoot, layout.TTSCatalogFile)
	if _, err := os.Stat(catalog); err != nil && packagedRoot != "" {
		catalog = filepath.Join(packagedRoot, "config", "tts-assets.json")
	}
	if manager, err := tts.New(catalog, root); err == nil {
		return manager
	}
	return previous
}

// buildWhisperManager is buildTtsManager for the Whisper model catalog.
func buildWhisperManager(cfg config, packagedRoot, root string, previous *whisper.Manager) *whisper.Manager {
	catalog := layout.Path(cfg.repoRoot, layout.WhisperCatalogFile)
	if _, err := os.Stat(catalog); err != nil && packagedRoot != "" {
		catalog = filepath.Join(packagedRoot, "config", "whisper-assets.json")
	}
	if manager, err := whisper.New(catalog, root); err == nil {
		return manager
	}
	return previous
}
