// Package whisper owns the approved, versioned catalog of faster-whisper
// CTranslate2 model directories used by Transcript Compare, gated behind the
// same first-use download/verify/install flow as Piper voices
// (apps/desktop/internal/tts).
package whisper

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

type File = assets.File
type Model struct {
	ID            string `json:"id"`
	Provider      string `json:"provider"`
	DisplayName   string `json:"displayName"`
	Version       string `json:"version"`
	Publisher     string `json:"publisher"`
	License       string `json:"license"`
	LicenseURL    string `json:"licenseUrl"`
	ModelCardURL  string `json:"modelCardUrl"`
	ProvenanceURL string `json:"provenanceUrl"`
	Attribution   string `json:"attribution"`
	Files         []File `json:"files"`
}
type Catalog struct {
	Version int     `json:"catalogVersion"`
	Models  []Model `json:"models"`
}
type Manager struct {
	catalog Catalog
	root    string
}

func New(catalogPath, root string) (*Manager, error) {
	bytes, err := os.ReadFile(catalogPath)
	if err != nil {
		return nil, err
	}
	var c Catalog
	if err = json.Unmarshal(bytes, &c); err != nil {
		return nil, err
	}
	return &Manager{catalog: c, root: root}, nil
}
func (m *Manager) Catalog() map[string]any {
	models := make([]map[string]any, 0, len(m.catalog.Models))
	for _, model := range m.catalog.Models {
		var size int64
		for _, file := range model.Files {
			size += file.Size
		}
		models = append(models, map[string]any{"id": model.ID, "provider": model.Provider, "displayName": model.DisplayName, "version": model.Version, "publisher": model.Publisher, "license": model.License, "licenseUrl": model.LicenseURL, "modelCardUrl": model.ModelCardURL, "provenanceUrl": model.ProvenanceURL, "attribution": model.Attribution, "downloadSize": size, "installState": m.State(model)})
	}
	return map[string]any{"catalogVersion": m.catalog.Version, "models": models}
}

// Models is every approved model, in catalog order.
func (m *Manager) Models() []Model { return append([]Model(nil), m.catalog.Models...) }

// InstallDir is where a model is (or will be) installed, whatever its state.
func (m *Manager) InstallDir(id string) string {
	model, _ := m.Model(id)
	return assets.Dir(m.root, model.Provider, model.ID, model.Version)
}

func (m *Manager) Model(id string) (Model, bool) {
	for _, model := range m.catalog.Models {
		if model.ID == id {
			return model, true
		}
	}
	return Model{}, false
}

// Dir returns the local CTranslate2 model directory for an installed,
// verified model. faster-whisper's WhisperModel loads a whole directory
// (model.bin, config.json, tokenizer.json, vocabulary), unlike Piper's
// two-file voice, so there is no per-file split to return here.
func (m *Manager) Dir(id string) (string, error) {
	model, ok := m.Model(id)
	if !ok {
		return "", fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	// The first use of a session reads the model in full, so a file damaged since the install is found here and not by the model failing
	// to load.
	if assets.Ready(m.root, model.Provider, model.ID, model.Version, model.Files) != "installed" {
		return "", fmt.Errorf("the selected Whisper model is not installed or did not verify")
	}
	return assets.Dir(m.root, model.Provider, model.ID, model.Version), nil
}
func (m *Manager) State(model Model) string {
	return assets.State(m.root, model.Provider, model.ID, model.Version, model.Files)
}

// Install downloads only a catalog-owned URL. Files are verified in an
// adjacent staging directory and become visible only after every file passes.
func (m *Manager) Install(ctx context.Context, id string) error {
	return m.InstallWith(ctx, id, assets.Options{})
}

// InstallWith is Install with the options of assets.Options: progress and the check hook of a job that reports them.
func (m *Manager) InstallWith(ctx context.Context, id string, options assets.Options) error {
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	return assets.InstallWith(ctx, m.root, model.Provider, model.ID, model.Version, model.Files, withDefaults(options))
}

// Verify reads every byte of a model and says whether it is installed, damaged or absent (the narrator's Verify).
func (m *Manager) Verify(id string) (string, error) {
	model, ok := m.Model(id)
	if !ok {
		return "", fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	assets.Forget(m.root, model.Provider, model.ID, model.Version)
	return assets.Verify(m.root, model.Provider, model.ID, model.Version, model.Files), nil
}

// Repair downloads a damaged model again and swaps it in; a model that verifies is left alone.
func (m *Manager) Repair(ctx context.Context, id string, options assets.Options) error {
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	return assets.Repair(ctx, m.root, model.Provider, model.ID, model.Version, model.Files, withDefaults(options))
}

// withDefaults asks the disk before a download unless the caller brought its own check.
func withDefaults(options assets.Options) assets.Options {
	if options.Preflight == nil {
		options.Preflight = assets.RequireFreeSpace
	}
	return options
}
func (m *Manager) Remove(id string) error {
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	return assets.Remove(m.root, model.Provider, model.ID, model.Version)
}
