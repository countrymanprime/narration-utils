// Package ffmpeg owns the approved catalog of FFmpeg builds the MP3 encoder runs (render-encode-master Phase 1, ADR 0342): a pinned
// archive (the imageio-ffmpeg wheel on PyPI, which carries gyan.dev's static Windows build) is downloaded only when the narrator
// confirms, checked against its SHA-256, unpacked, and everything but the one executable removed, inside the same staged install the
// other assets use (internal/assets). The executable is checked against its own pinned hash before it is kept, and Verify reads it
// against the hash taken then, so a damaged or swapped ffmpeg.exe is never run. The encoder (internal/encodeport) asks Path for it.
package ffmpeg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
)

type File = assets.File

// ExecutableName is the one file an install keeps, under the archive's folder.
const ExecutableName = "ffmpeg.exe"

var sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Build is one approved FFmpeg build.
type Build struct {
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
	// Attribution is the credit and source pointer the notices carry for the build.
	Attribution string `json:"attribution"`
	// Platforms are the operating systems (runtime.GOOS words) the executable runs on; a build for another is not offered.
	Platforms []string `json:"platforms"`
	// Binary is the executable's path inside the archive, and BinarySHA256 its pinned hash: the install keeps it, as ExecutableName, only
	// when the hash matches.
	Binary       string `json:"binary"`
	BinarySHA256 string `json:"binarySha256"`
	// InstalledSize is the kept executable's size: what the build takes on disk once installed (the archive is not kept).
	InstalledSize int64  `json:"installedSize"`
	Files         []File `json:"files"`
}

type Catalog struct {
	Version  int     `json:"catalogVersion"`
	Encoders []Build `json:"encoders"`
}

type Manager struct {
	catalog  Catalog
	root     string
	platform string
}

// New reads a catalog for this computer's operating system.
func New(catalogPath, root string) (*Manager, error) { return NewFor(catalogPath, root, runtime.GOOS) }

// NewFor reads a catalog and offers only the builds for platform (a runtime.GOOS word). Each build must be exactly one archive that is
// unpacked, naming a clean path inside it and a well-formed hash for the executable.
func NewFor(catalogPath, root, platform string) (*Manager, error) {
	body, err := os.ReadFile(catalogPath)
	if err != nil {
		return nil, err
	}
	var catalog Catalog
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, err
	}
	for _, build := range catalog.Encoders {
		switch {
		case len(build.Files) != 1 || build.Files[0].Extract == "":
			return nil, fmt.Errorf("the FFmpeg build %q must be one archive to unpack", build.ID)
		case !filepath.IsLocal(filepath.FromSlash(build.Binary)) || path.Clean(build.Binary) != build.Binary:
			return nil, fmt.Errorf("the FFmpeg build %q names no clean executable path inside its archive", build.ID)
		case !sha256Hex.MatchString(build.BinarySHA256):
			return nil, fmt.Errorf("the FFmpeg build %q has no well-formed executable hash", build.ID)
		case len(build.Platforms) == 0:
			return nil, fmt.Errorf("the FFmpeg build %q names no platform", build.ID)
		}
	}
	return &Manager{catalog: catalog, root: root, platform: platform}, nil
}

// Builds is every approved build for this platform, in catalog order.
func (m *Manager) Builds() []Build {
	var builds []Build
	for _, build := range m.catalog.Encoders {
		if slices.Contains(build.Platforms, m.platform) {
			builds = append(builds, build)
		}
	}
	return builds
}

func (m *Manager) Build(id string) (Build, bool) {
	for _, build := range m.Builds() {
		if build.ID == id {
			return build, true
		}
	}
	return Build{}, false
}

// Default is the build the encoder runs: the first for this platform. There is one (ADR 0342); a choice would be a setting.
func (m *Manager) Default() (Build, bool) {
	builds := m.Builds()
	if len(builds) == 0 {
		return Build{}, false
	}
	return builds[0], true
}

// DownloadSize is the archive; DiskSize is the executable the install keeps.
func (b Build) DownloadSize() int64 { return b.Files[0].Size }

func (b Build) DiskSize() int64 {
	if b.InstalledSize > 0 {
		return b.InstalledSize
	}
	return b.Files[0].Expand
}

// InstallDir is where a build is (or will be) installed, whatever its state.
func (m *Manager) InstallDir(id string) string {
	build, _ := m.Build(id)
	return assets.Dir(m.root, build.Provider, build.ID, build.Version)
}

func (m *Manager) State(build Build) string {
	return assets.State(m.root, build.Provider, build.ID, build.Version, build.Files)
}

func (m *Manager) approved(id string) (Build, error) {
	build, ok := m.Build(id)
	if !ok {
		return Build{}, fmt.Errorf("the FFmpeg build %q is not in the approved catalog for %s", id, m.platform)
	}
	return build, nil
}

// Path is the default build's executable, ready to run. The first call of a session reads it in full against its recorded hash
// (assets.Ready), so damage since the install answers encodeport.ErrEncoderNotInstalled rather than running a changed binary.
func (m *Manager) Path() (string, error) {
	build, ok := m.Default()
	if !ok {
		return "", fmt.Errorf("%w: no approved FFmpeg build for %s", encodeport.ErrEncoderNotInstalled, m.platform)
	}
	if assets.Ready(m.root, build.Provider, build.ID, build.Version, build.Files) != "installed" {
		return "", encodeport.ErrEncoderNotInstalled
	}
	executable := m.executablePath(build)
	if _, err := os.Stat(executable); err != nil {
		// A Remove or Repair since the check: not installed now, and the next call reads it in full again.
		assets.Forget(m.root, build.Provider, build.ID, build.Version)
		return "", fmt.Errorf("%w: %v", encodeport.ErrEncoderNotInstalled, err)
	}
	return executable, nil
}

func (m *Manager) executablePath(build Build) string {
	return filepath.Join(assets.Dir(m.root, build.Provider, build.ID, build.Version), build.Files[0].Extract, ExecutableName)
}

// InstallWith downloads only the catalog's URL, checks it, unpacks it, keeps the executable when its hash is the pinned one, and swaps
// it in. options are those of assets.Options: progress and the check hook of a job that reports them.
func (m *Manager) InstallWith(ctx context.Context, id string, options assets.Options) error {
	build, err := m.approved(id)
	if err != nil {
		return err
	}
	return assets.InstallWith(ctx, m.root, build.Provider, build.ID, build.Version, build.Files, withDefaults(build, options))
}

// Verify reads the executable in full and says whether it is installed, damaged or absent.
func (m *Manager) Verify(id string) (string, error) {
	build, err := m.approved(id)
	if err != nil {
		return "", err
	}
	assets.Forget(m.root, build.Provider, build.ID, build.Version)
	return assets.Verify(m.root, build.Provider, build.ID, build.Version, build.Files), nil
}

// Repair downloads a damaged build again; one that verifies is left alone.
func (m *Manager) Repair(ctx context.Context, id string, options assets.Options) error {
	build, err := m.approved(id)
	if err != nil {
		return err
	}
	return assets.Repair(ctx, m.root, build.Provider, build.ID, build.Version, build.Files, withDefaults(build, options))
}

func (m *Manager) Remove(id string) error {
	build, err := m.approved(id)
	if err != nil {
		return err
	}
	return assets.Remove(m.root, build.Provider, build.ID, build.Version)
}

// withDefaults asks the disk before a download unless the caller brought its own check, and always keeps only the executable: a build
// is never installed as the whole archive.
func withDefaults(build Build, options assets.Options) assets.Options {
	if options.Preflight == nil {
		options.Preflight = assets.RequireFreeSpace
	}
	options.Derive = func(staging string, file File, _ []assets.ExtractedFile) ([]assets.ExtractedFile, error) {
		return keepExecutable(staging, file, build)
	}
	return options
}

// errWrongExecutable is an archive whose executable is not the pinned one: the install fails and keeps nothing.
var errWrongExecutable = errors.New("the executable in the archive is not the approved build")

// keepExecutable moves the build's executable out of the unpacked archive, removes the rest, and keeps it only when its hash is the
// pinned one.
func keepExecutable(staging string, file File, build Build) ([]assets.ExtractedFile, error) {
	root := filepath.Join(staging, file.Extract)
	moved := filepath.Join(staging, ExecutableName+".new")
	if err := os.Rename(filepath.Join(root, filepath.FromSlash(build.Binary)), moved); err != nil {
		return nil, fmt.Errorf("the archive holds no %s: %w", build.Binary, err)
	}
	if err := os.RemoveAll(root); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(moved, filepath.Join(root, ExecutableName)); err != nil {
		return nil, err
	}
	kept, err := assets.RecordFile(staging, file.Extract+"/"+ExecutableName)
	if err != nil {
		return nil, err
	}
	if kept.SHA256 != build.BinarySHA256 {
		return nil, fmt.Errorf("%w: its SHA-256 is %s, not %s", errWrongExecutable, kept.SHA256, build.BinarySHA256)
	}
	return []assets.ExtractedFile{kept}, nil
}
