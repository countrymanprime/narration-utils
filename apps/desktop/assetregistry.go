package main

import (
	"context"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// assetItem is one approved, downloadable thing as the registry sees it, whatever kind of asset it is: a voice, a model, and the models
// and dictionaries that follow. Each kind keeps its own catalog file and its own manager; the registry only needs this much to list,
// install, verify and remove it.
type assetItem struct {
	kind, id, displayName, version, publisher                     string
	license, licenseURL, modelCardURL, provenanceURL, attribution string
	files                                                         []assets.File
	dir                                                           string
}

func (i assetItem) downloadSize() int64 {
	var total int64
	for _, file := range i.files {
		total += file.Size
	}
	return total
}

// assetProvider is one kind of asset: its catalog and the operations on it. The two that exist wrap the managers they were built on
// (`internal/tts`, `internal/whisper`); a kind that is added later (spaCy models, dictionaries) implements this and is registered, and
// the generic bindings, the list and the Manage local assets page serve it without further change.
type assetProvider interface {
	// kind is the word the UI and the job events use for this kind of asset ("tts", "whisper").
	kind() string
	// label is the kind in words a narrator reads ("Preview voice"); noun is one asset of it inside a sentence ("voice").
	label() string
	noun() string
	// endedKind is the kind of `job:ended` event an install of this kind ends with (jobs.go).
	endedKind() string
	items() []assetItem
	item(id string) (assetItem, bool)
	state(id string) string
	// install installs the asset, or repairs it when it is damaged; an asset that is installed is left alone.
	install(ctx context.Context, id string, options assets.Options) error
	verify(id string) (string, error)
	remove(id string) error
}

// assetRegistry holds every asset provider. It is built once, when the app starts, and never replaced: the managers are not
// project-scoped (a project switch leaves the downloaded assets where they are), so no binding needs the lock to read them.
type assetRegistry struct {
	// base is the per-user cache folder every provider keeps its assets under.
	base string
	// unavailable says why there is no registry (the operating system could not name the cache folder); empty when there is one.
	unavailable string
	providers   []assetProvider
	// tts and whisper are the managers behind the first two providers, for the bindings that predate the registry (the preview, the
	// first-use gates of Transcript Compare and the Teleprompter).
	tts     *tts.Manager
	whisper *whisper.Manager
}

// newAssetRegistry registers a provider for each manager that exists.
func newAssetRegistry(base string, voices *tts.Manager, models *whisper.Manager) *assetRegistry {
	registry := &assetRegistry{base: base, tts: voices, whisper: models}
	if voices != nil {
		registry.providers = append(registry.providers, ttsProvider{manager: voices})
	}
	if models != nil {
		registry.providers = append(registry.providers, whisperProvider{manager: models})
	}
	return registry
}

func (r *assetRegistry) provider(kind string) (assetProvider, error) {
	for _, provider := range r.providers {
		if provider.kind() == kind {
			return provider, nil
		}
	}
	if r.unavailable != "" {
		return nil, fmt.Errorf("the approved asset catalog is unavailable: %s", r.unavailable)
	}
	return nil, fmt.Errorf("%q is not an approved kind of asset", kind)
}

// lookup finds one asset by kind and id, and says which of the two was wrong.
func (r *assetRegistry) lookup(kind, id string) (assetProvider, assetItem, error) {
	provider, err := r.provider(kind)
	if err != nil {
		return nil, assetItem{}, err
	}
	item, ok := provider.item(id)
	if !ok {
		return nil, assetItem{}, fmt.Errorf("%q is not in the approved catalog of %s", id, provider.label())
	}
	return provider, item, nil
}

// catalogUnavailable is the error for an asset kind that has no catalog: what is missing and, when the operating system could not name the
// cache folder, why.
func (r *assetRegistry) catalogUnavailable(what string) error {
	if r.unavailable != "" {
		return fmt.Errorf("the approved %s catalog is unavailable: %s", what, r.unavailable)
	}
	return fmt.Errorf("the approved %s catalog is unavailable", what)
}

// registry is the asset registry: set once at start, so it is read like the other set-once fields. Before start (a test that builds a
// Host by hand) it is empty and every asset is unavailable.
func (h *Host) registry() *assetRegistry {
	h.mu.RLock()
	registry := h.assets
	h.mu.RUnlock()
	if registry == nil {
		return &assetRegistry{}
	}
	return registry
}
