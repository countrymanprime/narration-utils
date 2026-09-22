package assets

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const manifestName = "manifest.json"

// ManifestFile is what the install recorded about one file: what the catalog said it must be, where it came from, and the modification time
// it had when it was checked, which is what lets a later listing trust it without reading it.
type ManifestFile struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTimeUnixNano"`
}

// Manifest is the record an install directory keeps of itself: the exact version and provenance (for diagnostics, repair and removal),
// every file, when it was installed and last verified, and whether the last Verify found it damaged. A manifest written before it held
// files has only the identity, and is treated as if it vouched for nothing.
type Manifest struct {
	Provider    string         `json:"provider"`
	ID          string         `json:"id"`
	Version     string         `json:"version"`
	Files       []ManifestFile `json:"files,omitempty"`
	InstalledAt string         `json:"installedAt,omitempty"`
	VerifiedAt  string         `json:"verifiedAt,omitempty"`
	Damaged     bool           `json:"damaged,omitempty"`
}

// ReadManifest reads the manifest of one install directory. A directory with no manifest, or a damaged one, is an error.
func ReadManifest(dir string) (Manifest, error) {
	bytes, err := os.ReadFile(filepath.Join(dir, manifestName))
	if err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	if err := json.Unmarshal(bytes, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("the asset manifest in %s is damaged: %w", dir, err)
	}
	return manifest, nil
}

// vouchesFor reports whether the manifest can stand in for hashing: it names exactly the catalog's files with the catalog's sizes and
// hashes, and each is still on disk with the size and modification time it had when it was checked.
func (m Manifest) vouchesFor(dir string, files []File) bool {
	if len(m.Files) == 0 || len(m.Files) != len(files) {
		return false
	}
	recorded := make(map[string]ManifestFile, len(m.Files))
	for _, file := range m.Files {
		recorded[file.Name] = file
	}
	for _, f := range files {
		entry, ok := recorded[f.Name]
		if !ok || entry.SHA256 != f.SHA256 || entry.Size != f.Size {
			return false
		}
		info, err := os.Stat(filepath.Join(dir, f.Name))
		if err != nil || !info.Mode().IsRegular() || info.Size() != f.Size || info.ModTime().UnixNano() != entry.ModTime {
			return false
		}
	}
	return true
}

func writeManifest(dir string, manifest Manifest) error {
	bytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	// A temp name of its own, so two writers never share a file and one cannot rename the other's away.
	temp := filepath.Join(dir, fmt.Sprintf("%s.%d.tmp", manifestName, time.Now().UnixNano()))
	if err := os.WriteFile(temp, bytes, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temp, filepath.Join(dir, manifestName)); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}

// manifestFor records every catalog file with the modification time it has in dir now.
func manifestFor(dir, provider, id, version string, files []File) (Manifest, error) {
	manifest := Manifest{Provider: provider, ID: id, Version: version}
	for _, f := range files {
		info, err := os.Stat(filepath.Join(dir, f.Name))
		if err != nil {
			return Manifest{}, err
		}
		manifest.Files = append(manifest.Files, ManifestFile{Name: f.Name, URL: f.URL, SHA256: f.SHA256, Size: f.Size, ModTime: info.ModTime().UnixNano()})
	}
	return manifest, nil
}

func writeInstalledManifest(dir, provider, id, version string, files []File) error {
	manifest, err := manifestFor(dir, provider, id, version, files)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	manifest.InstalledAt, manifest.VerifiedAt = now, now
	return writeManifest(dir, manifest)
}

// recordVerified refreshes the manifest after a Verify that read every byte and found them right.
func recordVerified(dir, provider, id, version string, files []File) error {
	manifest, err := manifestFor(dir, provider, id, version, files)
	if err != nil {
		return err
	}
	if previous, readErr := ReadManifest(dir); readErr == nil {
		manifest.InstalledAt = previous.InstalledAt
	}
	manifest.VerifiedAt = time.Now().UTC().Format(time.RFC3339)
	return writeManifest(dir, manifest)
}

// recordDamaged marks the install as failing its check, so listings say so without hashing it again.
func recordDamaged(dir, provider, id, version string) error {
	manifest := Manifest{Provider: provider, ID: id, Version: version}
	if previous, err := ReadManifest(dir); err == nil {
		manifest = previous
	}
	manifest.Damaged = true
	err := writeManifest(dir, manifest)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
