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
	// Extracted is what an archive unpacked to, when File.Extract was set: the archive itself is gone, so these are the files a check reads.
	Extracted []ExtractedFile `json:"extracted,omitempty"`
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
		if f.Extract != "" {
			if !extractedUnchanged(dir, entry.Extracted) {
				return false
			}
			continue
		}
		info, err := os.Stat(filepath.Join(dir, f.Name))
		if err != nil || !info.Mode().IsRegular() || info.Size() != f.Size || info.ModTime().UnixNano() != entry.ModTime {
			return false
		}
	}
	return true
}

// extractedUnchanged reports whether every unpacked file still has the size and modification time it had when it was unpacked.
func extractedUnchanged(dir string, entries []ExtractedFile) bool {
	if len(entries) == 0 {
		return false
	}
	for _, entry := range entries {
		info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(entry.Path)))
		if err != nil || !info.Mode().IsRegular() || info.Size() != entry.Size || info.ModTime().UnixNano() != entry.ModTime {
			return false
		}
	}
	return true
}

// hashExtracted reads every unpacked file of an archive against the hash recorded when it was unpacked. With no manifest to say what was
// unpacked there is nothing to check against, so an install that has its folder but no record cannot be trusted.
func hashExtracted(dir string, f File) string {
	manifest, err := ReadManifest(dir)
	if err != nil {
		if _, statErr := os.Stat(filepath.Join(dir, f.Extract)); statErr != nil {
			return "not_installed"
		}
		return "verification_failed"
	}
	for _, entry := range manifest.Files {
		if entry.Name != f.Name || entry.SHA256 != f.SHA256 || len(entry.Extracted) == 0 {
			continue
		}
		for _, item := range entry.Extracted {
			if err := verify(filepath.Join(dir, filepath.FromSlash(item.Path)), File{SHA256: item.SHA256, Size: item.Size}); err != nil {
				if os.IsNotExist(err) {
					return "not_installed"
				}
				return "verification_failed"
			}
		}
		return "installed"
	}
	return "verification_failed"
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
func manifestFor(dir, provider, id, version string, files []File, extracted map[string][]ExtractedFile) (Manifest, error) {
	manifest := Manifest{Provider: provider, ID: id, Version: version}
	for _, f := range files {
		if f.Extract != "" {
			manifest.Files = append(manifest.Files, ManifestFile{Name: f.Name, URL: f.URL, SHA256: f.SHA256, Size: f.Size, Extracted: extracted[f.Name]})
			continue
		}
		info, err := os.Stat(filepath.Join(dir, f.Name))
		if err != nil {
			return Manifest{}, err
		}
		manifest.Files = append(manifest.Files, ManifestFile{Name: f.Name, URL: f.URL, SHA256: f.SHA256, Size: f.Size, ModTime: info.ModTime().UnixNano()})
	}
	return manifest, nil
}

func writeInstalledManifest(dir, provider, id, version string, files []File, extracted map[string][]ExtractedFile) error {
	manifest, err := manifestFor(dir, provider, id, version, files, extracted)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	manifest.InstalledAt, manifest.VerifiedAt = now, now
	return writeManifest(dir, manifest)
}

// recordVerified refreshes the manifest after a Verify that read every byte and found them right.
func recordVerified(dir, provider, id, version string, files []File) error {
	previous, readErr := ReadManifest(dir)
	extracted := map[string][]ExtractedFile{}
	if readErr == nil {
		for _, entry := range previous.Files {
			refreshed, err := refreshExtracted(dir, entry.Extracted)
			if err != nil {
				return err
			}
			extracted[entry.Name] = refreshed
		}
	}
	manifest, err := manifestFor(dir, provider, id, version, files, extracted)
	if err != nil {
		return err
	}
	if readErr == nil {
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

// refreshExtracted takes the modification times of the unpacked files as they are now, which the caller has just found to hold the bytes they
// held when they were unpacked.
func refreshExtracted(dir string, entries []ExtractedFile) ([]ExtractedFile, error) {
	refreshed := make([]ExtractedFile, 0, len(entries))
	for _, entry := range entries {
		info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(entry.Path)))
		if err != nil {
			return nil, err
		}
		entry.ModTime = info.ModTime().UnixNano()
		refreshed = append(refreshed, entry)
	}
	return refreshed, nil
}
