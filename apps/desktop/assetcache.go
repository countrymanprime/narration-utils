package main

import (
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// The per-asset-kind folders under the asset cache (internal/assets names them once, for the host and for the seeding command alike).
const (
	ttsCacheDir     = assets.TTSDir
	whisperCacheDir = assets.WhisperDir
	spacyCacheDir   = assets.SpacyDir
)

// assetCacheBase is where downloaded assets live: the per-user cache folder, never the temporary one (assets.CacheBase).
func assetCacheBase() (string, error) { return assets.CacheBase() }

// cleanAssetCaches removes what an interrupted download or repair left under the asset cache and nothing will resume: run once at start.
// It returns what it removed.
func cleanAssetCaches(base string) []string {
	var removed []string
	for _, dir := range []string{ttsCacheDir, whisperCacheDir, spacyCacheDir} {
		removed = append(removed, assets.CleanStale(filepath.Join(base, dir))...)
	}
	return removed
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
	for _, catalog := range []string{layout.TTSCatalogFile, layout.WhisperCatalogFile, layout.SpacyCatalogFile} {
		if _, statErr := os.Stat(layout.Path(h.config.repoRoot, catalog)); statErr != nil {
			packaged = h.packagedResources()
			break
		}
	}
	voices := buildTtsManager(h.config, packaged, filepath.Join(base, ttsCacheDir))
	models := buildWhisperManager(h.config, packaged, filepath.Join(base, whisperCacheDir))
	languageModels := buildSpacyManager(h.config, packaged, filepath.Join(base, spacyCacheDir))
	return newAssetRegistry(base, voices, models, languageModels)
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

// buildSpacyManager is buildTtsManager for the spaCy language model catalog.
func buildSpacyManager(cfg config, packagedRoot, root string) *spacy.Manager {
	catalog := layout.Path(cfg.repoRoot, layout.SpacyCatalogFile)
	if _, err := os.Stat(catalog); err != nil && packagedRoot != "" {
		catalog = filepath.Join(packagedRoot, "config", "spacy-assets.json")
	}
	manager, err := spacy.New(catalog, root)
	if err != nil {
		return nil
	}
	return manager
}
