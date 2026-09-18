package tts

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

type File = assets.File
type Voice struct {
	ID            string `json:"id"`
	Provider      string `json:"provider"`
	DisplayName   string `json:"displayName"`
	Locale        string `json:"locale"`
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
	Voices  []Voice `json:"voices"`
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
	voices := make([]map[string]any, 0, len(m.catalog.Voices))
	for _, v := range m.catalog.Voices {
		var size int64
		for _, file := range v.Files {
			size += file.Size
		}
		voices = append(voices, map[string]any{"id": v.ID, "provider": v.Provider, "displayName": v.DisplayName, "locale": v.Locale, "version": v.Version, "publisher": v.Publisher, "license": v.License, "licenseUrl": v.LicenseURL, "modelCardUrl": v.ModelCardURL, "provenanceUrl": v.ProvenanceURL, "attribution": v.Attribution, "downloadSize": size, "installState": m.State(v)})
	}
	return map[string]any{"catalogVersion": m.catalog.Version, "voices": voices}
}
func (m *Manager) Voice(id string) (Voice, bool) {
	for _, v := range m.catalog.Voices {
		if v.ID == id {
			return v, true
		}
	}
	return Voice{}, false
}
func (m *Manager) Paths(id string) (string, string, error) {
	v, ok := m.Voice(id)
	if !ok {
		return "", "", fmt.Errorf("the selected voice is not in the approved catalog")
	}
	if m.State(v) != "installed" {
		return "", "", fmt.Errorf("the selected voice is not installed or did not verify")
	}
	root := assets.Dir(m.root, v.Provider, v.ID, v.Version)
	var model, config string
	for _, f := range v.Files {
		if strings.HasSuffix(f.Name, ".onnx.json") {
			config = filepath.Join(root, f.Name)
		} else if strings.HasSuffix(f.Name, ".onnx") {
			model = filepath.Join(root, f.Name)
		}
	}
	if model == "" || config == "" {
		return "", "", fmt.Errorf("the approved voice is incomplete")
	}
	return model, config, nil
}
func (m *Manager) State(v Voice) string {
	return assets.State(m.root, v.Provider, v.ID, v.Version, v.Files)
}

// Install downloads only a catalog-owned URL. Files are verified in an
// adjacent staging directory and become visible only after every file passes.
func (m *Manager) Install(ctx context.Context, id string) error {
	v, ok := m.Voice(id)
	if !ok {
		return fmt.Errorf("the selected voice is not in the approved catalog")
	}
	return assets.Install(ctx, m.root, v.Provider, v.ID, v.Version, v.Files)
}
func (m *Manager) Remove(id string) error {
	v, ok := m.Voice(id)
	if !ok {
		return fmt.Errorf("the selected voice is not in the approved catalog")
	}
	return assets.Remove(m.root, v.Provider, v.ID, v.Version)
}
