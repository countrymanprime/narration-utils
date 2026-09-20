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
	if m.State(model) != "installed" {
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
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	return assets.Install(ctx, m.root, model.Provider, model.ID, model.Version, model.Files)
}
func (m *Manager) Remove(id string) error {
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	return assets.Remove(m.root, model.Provider, model.ID, model.Version)
}
