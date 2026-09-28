package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/wiktextract"
)

// PronunciationCommonsAudioOpen opens the Wikimedia Commons recording that Wiktextract's own offline pronunciation
// data (prep-depth Phase 8, #782) names for word, in the narrator's default browser or media player: the same
// "open externally" host path PronunciationLookupOpen and PronunciationOnlineSignUpOpen already use (Q12), never
// fetched, streamed or cached by the app itself.
//
// word crosses the Wails boundary; the address never does - it is built here from Phase 8's own installed index, the
// same trusted-URL discipline every other open-externally binding already follows (never a UI-supplied URL). A word
// the index has no audio for, and a Wiktextract source not installed yet, are both refused with a clear reason
// rather than opening nothing silently.
func (h *Host) PronunciationCommonsAudioOpen(word string) (string, error) {
	address, err := h.wiktextractCommonsAudioURL(word)
	if err != nil {
		return "", err
	}
	return h.openTrustedURL(address)
}

// wiktextractCommonsAudioURL resolves word to its Commons audio address through Phase 8's installed index, or a clear
// error. It never opens anything itself - PronunciationCommonsAudioOpen does that, once this has returned a trusted,
// Commons-hosted address (the same defense-in-depth check PronunciationLookupOpen's fixed switch already gives that
// binding, applied here since this address is built from data, not a compile-time literal).
func (h *Host) wiktextractCommonsAudioURL(word string) (string, error) {
	manager, err := h.wiktextractManagerFor()
	if err != nil {
		return "", err
	}
	source, ok := manager.Default()
	if !ok {
		return "", errors.New("no Wiktextract pronunciation source is catalogued")
	}
	indexPath, err := manager.Installed(source.ID)
	if err != nil {
		return "", fmt.Errorf("the Wiktionary pronunciation data is not installed yet: %w", err)
	}
	words, err := wiktextract.LoadIndex(indexPath)
	if err != nil {
		return "", err
	}
	address, err := wiktextract.WordAudioURL(words, word)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(address, "https://"+wiktextract.CommonsHost+"/") {
		return "", fmt.Errorf("refusing to open a non-Commons address %q", address)
	}
	return address, nil
}

// wiktextractManagerFor is the seam wiktextractManager guards: the injected manager for a test, or a fresh one built
// over the real catalog and cache.
func (h *Host) wiktextractManagerFor() (*wiktextract.Manager, error) {
	h.mu.RLock()
	seam := h.wiktextractManager
	repoRoot := h.config.repoRoot
	h.mu.RUnlock()
	if seam != nil {
		return seam()
	}
	return defaultWiktextractManager(repoRoot, h.packagedResources())
}

// defaultWiktextractManager mirrors buildDictionaryManager (assetcache.go): the checkout's own catalog, falling back
// to the packaged release's when a checkout does not have one, over the per-user asset cache.
func defaultWiktextractManager(repoRoot, packagedRoot string) (*wiktextract.Manager, error) {
	base, err := assetCacheBase()
	if err != nil {
		return nil, err
	}
	catalog := layout.Path(repoRoot, layout.WiktextractCatalogFile)
	if _, statErr := os.Stat(catalog); statErr != nil && packagedRoot != "" {
		catalog = filepath.Join(packagedRoot, "config", "wiktextract-assets.json")
	}
	return wiktextract.New(catalog, filepath.Join(base, assets.WiktextractDir))
}
