// Package dictionary owns the approved catalog of offline dictionaries the manuscript reader's Look up reads (ADR 0097: the Open English
// WordNet, CC BY 4.0, no cloud API), and the lookup itself. A dictionary is a pinned release archive: it is downloaded only when the
// narrator confirms, checked against its SHA-256, unpacked, turned into one compact lookup index (build.go) and the unpacked dataset
// removed, all inside the same staged install the other assets use (internal/assets), so a failed or partial install never looks
// installed and Verify reads the index against the hash taken when it was built. Lookups read the index from Go in the desktop process:
// there is no server to keep running.
package dictionary

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

type File = assets.File

// Dictionary is one approved dictionary.
type Dictionary struct {
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
	// Attribution is the credit the licence requires wherever the data is shown: the lookup panel and the third-party notices.
	Attribution string `json:"attribution"`
	// InstalledSize is the measured size of the built index: what the dictionary takes on disk once installed (the archive and the dataset
	// it unpacks to are not kept).
	InstalledSize int64  `json:"installedSize"`
	Files         []File `json:"files"`
}

type Catalog struct {
	Version      int          `json:"catalogVersion"`
	Dictionaries []Dictionary `json:"dictionaries"`
}

type Manager struct {
	catalog Catalog
	root    string
}

// ErrNotInstalled is a lookup in a dictionary that is not installed, or did not verify: the caller offers the first-use download.
var ErrNotInstalled = errors.New("the dictionary is not installed or did not verify")

// New reads a catalog. Each dictionary must be exactly one archive that is unpacked, which is what the index is built from.
func New(catalogPath, root string) (*Manager, error) {
	body, err := os.ReadFile(catalogPath)
	if err != nil {
		return nil, err
	}
	var catalog Catalog
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, err
	}
	for _, dictionary := range catalog.Dictionaries {
		if len(dictionary.Files) != 1 || dictionary.Files[0].Extract == "" {
			return nil, fmt.Errorf("the dictionary %q must be one archive to unpack", dictionary.ID)
		}
	}
	return &Manager{catalog: catalog, root: root}, nil
}

// Dictionaries is every approved dictionary, in catalog order.
func (m *Manager) Dictionaries() []Dictionary {
	return append([]Dictionary(nil), m.catalog.Dictionaries...)
}

func (m *Manager) Dictionary(id string) (Dictionary, bool) {
	for _, dictionary := range m.catalog.Dictionaries {
		if dictionary.ID == id {
			return dictionary, true
		}
	}
	return Dictionary{}, false
}

// Default is the dictionary a lookup uses: the first in the catalog. There is one (US English, ADR 0097); a choice would be a setting.
func (m *Manager) Default() (Dictionary, bool) {
	if len(m.catalog.Dictionaries) == 0 {
		return Dictionary{}, false
	}
	return m.catalog.Dictionaries[0], true
}

// DownloadSize is the archive; DiskSize is the index the install keeps (the catalog's measured size, or the unpacked dataset's when the
// catalog does not give one).
func (d Dictionary) DownloadSize() int64 { return d.Files[0].Size }

func (d Dictionary) DiskSize() int64 {
	if d.InstalledSize > 0 {
		return d.InstalledSize
	}
	return d.Files[0].Expand
}

// InstallDir is where a dictionary is (or will be) installed, whatever its state.
func (m *Manager) InstallDir(id string) string {
	dictionary, _ := m.Dictionary(id)
	return assets.Dir(m.root, dictionary.Provider, dictionary.ID, dictionary.Version)
}

func (m *Manager) State(dictionary Dictionary) string {
	return assets.State(m.root, dictionary.Provider, dictionary.ID, dictionary.Version, dictionary.Files)
}

func (m *Manager) approved(id string) (Dictionary, error) {
	dictionary, ok := m.Dictionary(id)
	if !ok {
		return Dictionary{}, fmt.Errorf("the dictionary %q is not in the approved catalog", id)
	}
	return dictionary, nil
}

// Lookup looks one selection up. The first lookup of a session reads the index in full against its recorded hash (assets.Ready), so
// damage since the install is found here and reported as not installed, not read as a garbled answer.
func (m *Manager) Lookup(id, selection string) (Result, error) {
	dictionary, err := m.approved(id)
	if err != nil {
		return Result{}, err
	}
	if assets.Ready(m.root, dictionary.Provider, dictionary.ID, dictionary.Version, dictionary.Files) != "installed" {
		return Result{}, ErrNotInstalled
	}
	result, err := LookupFile(m.indexPath(dictionary), selection)
	// The index was ready a moment ago; a Remove or a Repair that swapped it out since (or damage found by the bounded reads) leaves it
	// missing or unreadable now. That is the dictionary not being installed, so the caller offers the download again, and the next lookup
	// reads the index in full once more.
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, ErrDamagedIndex) {
		assets.Forget(m.root, dictionary.Provider, dictionary.ID, dictionary.Version)
		return Result{}, fmt.Errorf("%w: %v", ErrNotInstalled, err)
	}
	return result, err
}

func (m *Manager) indexPath(dictionary Dictionary) string {
	return filepath.Join(assets.Dir(m.root, dictionary.Provider, dictionary.ID, dictionary.Version), dictionary.Files[0].Extract, IndexName)
}

// Install downloads only the catalog's URL, checks it, unpacks it, builds the index and swaps it in.
func (m *Manager) Install(ctx context.Context, id string) error {
	return m.InstallWith(ctx, id, assets.Options{})
}

// InstallWith is Install with the options of assets.Options: progress and the check hook of a job that reports them.
func (m *Manager) InstallWith(ctx context.Context, id string, options assets.Options) error {
	dictionary, err := m.approved(id)
	if err != nil {
		return err
	}
	return assets.InstallWith(ctx, m.root, dictionary.Provider, dictionary.ID, dictionary.Version, dictionary.Files, withDefaults(options))
}

// Verify reads the index in full and says whether it is installed, damaged or absent.
func (m *Manager) Verify(id string) (string, error) {
	dictionary, err := m.approved(id)
	if err != nil {
		return "", err
	}
	assets.Forget(m.root, dictionary.Provider, dictionary.ID, dictionary.Version)
	return assets.Verify(m.root, dictionary.Provider, dictionary.ID, dictionary.Version, dictionary.Files), nil
}

// Repair downloads a damaged dictionary again and rebuilds its index; one that verifies is left alone.
func (m *Manager) Repair(ctx context.Context, id string, options assets.Options) error {
	dictionary, err := m.approved(id)
	if err != nil {
		return err
	}
	return assets.Repair(ctx, m.root, dictionary.Provider, dictionary.ID, dictionary.Version, dictionary.Files, withDefaults(options))
}

func (m *Manager) Remove(id string) error {
	dictionary, err := m.approved(id)
	if err != nil {
		return err
	}
	return assets.Remove(m.root, dictionary.Provider, dictionary.ID, dictionary.Version)
}

// withDefaults asks the disk before a download unless the caller brought its own check, and always builds the index: a dictionary is never
// installed as the raw dataset.
func withDefaults(options assets.Options) assets.Options {
	if options.Preflight == nil {
		options.Preflight = assets.RequireFreeSpace
	}
	options.Derive = deriveIndex
	return options
}

// deriveIndex builds the index from the unpacked release in the archive's folder, then removes the release.
func deriveIndex(staging string, file File, _ []assets.ExtractedFile) ([]assets.ExtractedFile, error) {
	root := filepath.Join(staging, file.Extract)
	built := filepath.Join(staging, IndexName+".new")
	if err := BuildIndex(root, built); err != nil {
		return nil, err
	}
	if err := os.RemoveAll(root); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(built, filepath.Join(root, IndexName)); err != nil {
		return nil, err
	}
	kept, err := assets.RecordFile(staging, file.Extract+"/"+IndexName)
	if err != nil {
		return nil, err
	}
	return []assets.ExtractedFile{kept}, nil
}
