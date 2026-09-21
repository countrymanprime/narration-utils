// Package spacy owns the approved, versioned catalog of spaCy language models the Story Bible uses, gated behind the same first-use
// download, verify and install flow as Piper voices and Whisper models (internal/tts, internal/whisper). A model is a pinned wheel from
// the model publisher's release: it is downloaded, checked against its SHA-256, unpacked into the install folder and deleted, and the
// sidecar loads the unpacked model folder by path (`spacy.load(<folder>)`), so nothing is ever pip-installed at run time.
package spacy

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

type File = assets.File

// Model is one approved spaCy pipeline.
type Model struct {
	ID            string `json:"id"`
	Provider      string `json:"provider"`
	DisplayName   string `json:"displayName"`
	Description   string `json:"description"`
	Version       string `json:"version"`
	Publisher     string `json:"publisher"`
	License       string `json:"license"`
	LicenseURL    string `json:"licenseUrl"`
	ModelCardURL  string `json:"modelCardUrl"`
	ProvenanceURL string `json:"provenanceUrl"`
	Attribution   string `json:"attribution"`
	// SpacyVersion is the range of spaCy the model was trained for; a test holds it against the locked spaCy.
	SpacyVersion string `json:"spacyVersion"`
	// ModelPath is the model folder inside the install folder: what `spacy.load` is given.
	ModelPath string `json:"modelPath"`
	Files     []File `json:"files"`
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

// downloadSize is what is fetched; diskSize is what the model takes once unpacked (the archive is not kept).
func (m Model) downloadSize() int64 {
	var total int64
	for _, file := range m.Files {
		total += file.Size
	}
	return total
}

func (m Model) diskSize() int64 {
	var total int64
	for _, file := range m.Files {
		if file.Extract != "" {
			total += file.Expand
		} else {
			total += file.Size
		}
	}
	return total
}

func (m *Manager) Catalog() map[string]any {
	models := make([]map[string]any, 0, len(m.catalog.Models))
	for _, model := range m.catalog.Models {
		models = append(models, map[string]any{"id": model.ID, "provider": model.Provider, "displayName": model.DisplayName, "description": model.Description, "version": model.Version,
			"publisher": model.Publisher, "license": model.License, "licenseUrl": model.LicenseURL, "modelCardUrl": model.ModelCardURL, "provenanceUrl": model.ProvenanceURL,
			"attribution": model.Attribution, "downloadSize": model.downloadSize(), "diskSize": model.diskSize(), "installState": m.State(model)})
	}
	return map[string]any{"catalogVersion": m.catalog.Version, "models": models}
}

// Models is every approved model, in catalog order; IDs is just their ids, for the Settings choice.
func (m *Manager) Models() []Model { return append([]Model(nil), m.catalog.Models...) }

func (m *Manager) IDs() []string {
	ids := make([]string, 0, len(m.catalog.Models))
	for _, model := range m.catalog.Models {
		ids = append(ids, model.ID)
	}
	return ids
}

func (m *Manager) Model(id string) (Model, bool) {
	for _, model := range m.catalog.Models {
		if model.ID == id {
			return model, true
		}
	}
	return Model{}, false
}

// DownloadSize and DiskSize are the two sizes a first-use dialog states.
func (m Model) DownloadSize() int64 { return m.downloadSize() }
func (m Model) DiskSize() int64     { return m.diskSize() }

// InstallDir is where a model is (or will be) installed, whatever its state.
func (m *Manager) InstallDir(id string) string {
	model, _ := m.Model(id)
	return assets.Dir(m.root, model.Provider, model.ID, model.Version)
}

// ModelDir is the folder `spacy.load` is given for an installed model. The first use of a session reads the model in full, so damage
// since the install is found here and not by spaCy failing to load it. It is an error for a model that is not installed.
func (m *Manager) ModelDir(id string) (string, error) {
	model, ok := m.Model(id)
	if !ok {
		return "", fmt.Errorf("the selected spaCy model is not in the approved catalog")
	}
	if assets.Ready(m.root, model.Provider, model.ID, model.Version, model.Files) != "installed" {
		return "", fmt.Errorf("the selected spaCy model is not installed or did not verify")
	}
	return filepath.Join(assets.Dir(m.root, model.Provider, model.ID, model.Version), filepath.FromSlash(model.ModelPath)), nil
}

func (m *Manager) State(model Model) string {
	return assets.State(m.root, model.Provider, model.ID, model.Version, model.Files)
}

// Install downloads only a catalog-owned URL, checks it, unpacks it and swaps it in.
func (m *Manager) Install(ctx context.Context, id string) error {
	return m.InstallWith(ctx, id, assets.Options{})
}

// InstallWith is Install with the options of assets.Options: progress and the check hook of a job that reports them.
func (m *Manager) InstallWith(ctx context.Context, id string, options assets.Options) error {
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected spaCy model is not in the approved catalog")
	}
	return assets.InstallWith(ctx, m.root, model.Provider, model.ID, model.Version, model.Files, withDefaults(options))
}

// Verify reads every unpacked file of a model and says whether it is installed, damaged or absent.
func (m *Manager) Verify(id string) (string, error) {
	model, ok := m.Model(id)
	if !ok {
		return "", fmt.Errorf("the selected spaCy model is not in the approved catalog")
	}
	assets.Forget(m.root, model.Provider, model.ID, model.Version)
	return assets.Verify(m.root, model.Provider, model.ID, model.Version, model.Files), nil
}

// Repair downloads a damaged model again and swaps it in; a model that verifies is left alone.
func (m *Manager) Repair(ctx context.Context, id string, options assets.Options) error {
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected spaCy model is not in the approved catalog")
	}
	return assets.Repair(ctx, m.root, model.Provider, model.ID, model.Version, model.Files, withDefaults(options))
}

func (m *Manager) Remove(id string) error {
	model, ok := m.Model(id)
	if !ok {
		return fmt.Errorf("the selected spaCy model is not in the approved catalog")
	}
	return assets.Remove(m.root, model.Provider, model.ID, model.Version)
}

// withDefaults asks the disk before a download unless the caller brought its own check.
func withDefaults(options assets.Options) assets.Options {
	if options.Preflight == nil {
		options.Preflight = assets.RequireFreeSpace
	}
	return options
}
