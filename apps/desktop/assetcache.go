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

// buildAssetRegistry builds the registry once, at start: the per-user cache folder and a manager for each approved catalog (the checkout catalog
// or, in a release, the packaged one). When the operating system cannot name the cache folder the registry says why and holds no provider;
// there is no fallback to the temporary folder. The caller holds h.mu.
func (h *Host) buildAssetRegistry() *assetRegistry {
	base, err := assetCacheBase()
	if err != nil {
		_ = h.log.Report("asset_cache_unavailable", err.Error())
		return &assetRegistry{unavailable: err.Error()}
	}
	// The packaged release resources are only unpacked when a checkout does not have every catalog.
	packaged := ""
	for _, catalog := range []string{layout.TTSCatalogFile, layout.WhisperCatalogFile} {
		if _, statErr := os.Stat(layout.Path(h.config.repoRoot, catalog)); statErr != nil {
			packaged = h.packagedResources()
			break
		}
	}
	voices := buildTtsManager(h.config, packaged, filepath.Join(base, ttsCacheDir))
	models := buildWhisperManager(h.config, packaged, filepath.Join(base, whisperCacheDir))
	return newAssetRegistry(base, voices, models)
}

// buildTtsManager reads the voice catalog (the checkout catalog, or the packaged release one) and returns a manager over root, or nil when
// the catalog cannot be read.
func buildTtsManager(cfg config, packagedRoot, root string) *tts.Manager {
	catalog := layout.Path(cfg.repoRoot, layout.TTSCatalogFile)
	if _, err := os.Stat(catalog); err != nil && packagedRoot != "" {
		catalog = filepath.Join(packagedRoot, "config", "tts-assets.json")
	}
	manager, err := tts.New(catalog, root)
	if err != nil {
		return nil
	}
	return manager
}

// buildWhisperManager is buildTtsManager for the Whisper model catalog.
func buildWhisperManager(cfg config, packagedRoot, root string) *whisper.Manager {
	catalog := layout.Path(cfg.repoRoot, layout.WhisperCatalogFile)
	if _, err := os.Stat(catalog); err != nil && packagedRoot != "" {
		catalog = filepath.Join(packagedRoot, "config", "whisper-assets.json")
	}
	manager, err := whisper.New(catalog, root)
	if err != nil {
		return nil
	}
	return manager
}
