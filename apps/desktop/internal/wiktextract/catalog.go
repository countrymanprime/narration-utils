// Package wiktextract owns the approved catalog of the Wiktionary/Wiktextract-derived pronunciation index (prep-depth
// Phase 8, D72, ADR 0405) and its install-time Derive step. A source is a pinned release archive: it is downloaded only
// when the narrator confirms, checked against its SHA-256, unpacked, reduced to one compact word -> {ipa, audio} index
// (build.go) and the unpacked release removed, all inside the same staged install the other assets use (internal/assets),
// the same shape internal/dictionary already uses for the Open English WordNet dictionary (ADR 0097). The index itself is
// read by the guide sidecar (Python, WiktextractSource in providers.py), given its resolved path as --wiktextract-index;
// there is no Go-side lookup.
//
// The catalog row's URL and SHA-256 are the literal sentinel Pending until a session that can reach kaikki.org fills them
// in (docs/research/wiktextract-pronunciation-source.md); Install and Repair refuse a Pending row rather than guess.
package wiktextract

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

type File = assets.File

// Pending is the sentinel a catalog row's URL and SHA-256 carry until a session that can reach kaikki.org verifies the
// real values (docs/research/wiktextract-pronunciation-source.md, #510).
const Pending = "PENDING-PHASE-0-VERIFICATION"

// Source is one approved pronunciation-index source.
type Source struct {
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
	// Attribution is the credit the licence requires wherever the data is shown (THIRD-PARTY-NOTICES.txt; the per-answer
	// label itself lives in providers.py's WiktextractSource.attribution_label).
	Attribution string `json:"attribution"`
	// InstalledSize is the measured size of the built index: what the source takes on disk once installed (the archive
	// and the dataset it unpacks to are not kept).
	InstalledSize int64  `json:"installedSize"`
	Files         []File `json:"files"`
}

type Catalog struct {
	Version int      `json:"catalogVersion"`
	Sources []Source `json:"sources"`
}

type Manager struct {
	catalog Catalog
	root    string
}

// ErrNotInstalled is asked for a source that is not installed, or did not verify: the caller offers the first-use download.
var ErrNotInstalled = errors.New("the pronunciation index is not installed or did not verify")

// ErrPendingVerification is asked for a source whose catalog row still carries the Pending sentinel.
var ErrPendingVerification = errors.New("this source's download is not yet verified (docs/research/wiktextract-pronunciation-source.md, #510)")

// New reads a catalog. Each source must be exactly one archive that is unpacked, which is what the index is built from.
func New(catalogPath, root string) (*Manager, error) {
	body, err := os.ReadFile(catalogPath)
	if err != nil {
		return nil, err
	}
	var catalog Catalog
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, err
	}
	for _, source := range catalog.Sources {
		if len(source.Files) != 1 || source.Files[0].Extract == "" {
			return nil, fmt.Errorf("the pronunciation source %q must be one archive to unpack", source.ID)
		}
	}
	return &Manager{catalog: catalog, root: root}, nil
}

// Sources is every approved source, in catalog order.
func (m *Manager) Sources() []Source {
	return append([]Source(nil), m.catalog.Sources...)
}

func (m *Manager) Source(id string) (Source, bool) {
	for _, source := range m.catalog.Sources {
		if source.ID == id {
			return source, true
		}
	}
	return Source{}, false
}

// Default is the source the offline registry uses: the first in the catalog. There is one (Wiktextract's English
// extract, prep-depth Phase 8); a choice would be a setting.
func (m *Manager) Default() (Source, bool) {
	if len(m.catalog.Sources) == 0 {
		return Source{}, false
	}
	return m.catalog.Sources[0], true
}

// Pending reports whether s's download is still unverified (docs/research/wiktextract-pronunciation-source.md).
func (s Source) Pending() bool {
	return len(s.Files) == 0 || s.Files[0].URL == Pending || s.Files[0].SHA256 == Pending
}

// DownloadSize is the archive; DiskSize is the index the install keeps (the catalog's measured size, or the unpacked
// release's when the catalog does not give one).
func (s Source) DownloadSize() int64 { return s.Files[0].Size }

func (s Source) DiskSize() int64 {
	if s.InstalledSize > 0 {
		return s.InstalledSize
	}
	return s.Files[0].Expand
}

// InstallDir is where a source is (or will be) installed, whatever its state.
func (m *Manager) InstallDir(id string) string {
	source, _ := m.Source(id)
	return assets.Dir(m.root, source.Provider, source.ID, source.Version)
}

func (m *Manager) State(source Source) string {
	return assets.State(m.root, source.Provider, source.ID, source.Version, source.Files)
}

func (m *Manager) approved(id string) (Source, error) {
	source, ok := m.Source(id)
	if !ok {
		return Source{}, fmt.Errorf("the pronunciation source %q is not in the approved catalog", id)
	}
	return source, nil
}

// IndexPath is where id's derived index is (or will be) once installed: the exact path a caller passes to the guide
// sidecar as --wiktextract-index.
func (m *Manager) IndexPath(id string) (string, error) {
	source, err := m.approved(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(assets.Dir(m.root, source.Provider, source.ID, source.Version), source.Files[0].Extract, IndexName), nil
}

// Installed is id's resolved index path, only once the asset actually verifies installed; ErrNotInstalled otherwise, the
// same "not read as a garbled answer" discipline internal/dictionary's own Lookup follows.
func (m *Manager) Installed(id string) (string, error) {
	source, err := m.approved(id)
	if err != nil {
		return "", err
	}
	if assets.Ready(m.root, source.Provider, source.ID, source.Version, source.Files) != "installed" {
		return "", ErrNotInstalled
	}
	return m.IndexPath(id)
}

// Install downloads only the catalog's URL, checks it, unpacks it, builds the index and swaps it in.
func (m *Manager) Install(ctx context.Context, id string) error {
	return m.InstallWith(ctx, id, assets.Options{})
}

// InstallWith is Install with the options of assets.Options: progress and the check hook of a job that reports them.
func (m *Manager) InstallWith(ctx context.Context, id string, options assets.Options) error {
	source, err := m.approved(id)
	if err != nil {
		return err
	}
	if source.Pending() {
		return fmt.Errorf("%q: %w", id, ErrPendingVerification)
	}
	return assets.InstallWith(ctx, m.root, source.Provider, source.ID, source.Version, source.Files, withDefaults(options))
}

// Verify reads the index in full and says whether it is installed, damaged or absent.
func (m *Manager) Verify(id string) (string, error) {
	source, err := m.approved(id)
	if err != nil {
		return "", err
	}
	assets.Forget(m.root, source.Provider, source.ID, source.Version)
	return assets.Verify(m.root, source.Provider, source.ID, source.Version, source.Files), nil
}

// Repair downloads a damaged source again and rebuilds its index; one that verifies is left alone.
func (m *Manager) Repair(ctx context.Context, id string, options assets.Options) error {
	source, err := m.approved(id)
	if err != nil {
		return err
	}
	if source.Pending() {
		return fmt.Errorf("%q: %w", id, ErrPendingVerification)
	}
	return assets.Repair(ctx, m.root, source.Provider, source.ID, source.Version, source.Files, withDefaults(options))
}

func (m *Manager) Remove(id string) error {
	source, err := m.approved(id)
	if err != nil {
		return err
	}
	return assets.Remove(m.root, source.Provider, source.ID, source.Version)
}

// withDefaults asks the disk before a download unless the caller brought its own check, and always builds the index: a
// source is never installed as the raw Wiktextract release.
func withDefaults(options assets.Options) assets.Options {
	if options.Preflight == nil {
		options.Preflight = assets.RequireFreeSpace
	}
	options.Derive = deriveIndex
	return options
}

// deriveIndex builds the index from the unpacked release in the archive's folder, then removes the release (Q8: never
// keep the raw dump).
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
