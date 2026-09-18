// Package assets implements the download-verify-install-remove lifecycle
// shared by every optional first-use asset catalog (Piper voices, Whisper
// models, and future model packs). Each capability owns its own catalog
// schema and display metadata; this package only knows about a
// provider/id/version install directory made of files with an expected size
// and SHA-256.
package assets

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

type File struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// Dir returns the install directory for one catalog item under root.
func Dir(root, provider, id, version string) string {
	return filepath.Join(root, provider, id, version)
}

// State reports "installed", "not_installed", or "verification_failed" for
// every file of one catalog item.
func State(root, provider, id, version string, files []File) string {
	dir := Dir(root, provider, id, version)
	for _, f := range files {
		if err := verify(filepath.Join(dir, f.Name), f); err != nil {
			if os.IsNotExist(err) {
				return "not_installed"
			}
			return "verification_failed"
		}
	}
	return "installed"
}

func verify(path string, f File) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Size() != f.Size {
		return fmt.Errorf("unexpected asset size")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	h := sha256.New()
	if _, err = io.Copy(h, file); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != f.SHA256 {
		return fmt.Errorf("asset checksum mismatch")
	}
	return nil
}

// Install downloads every catalog-owned file into an adjacent staging
// directory, verifies each against its expected size and hash, and only then
// atomically renames the staging directory into place. A partial or failed
// download never becomes visible as an installed asset.
func Install(ctx context.Context, root, provider, id, version string, files []File) error {
	if State(root, provider, id, version, files) == "installed" {
		return nil
	}
	target := Dir(root, provider, id, version)
	staging := target + ".installing"
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return err
	}
	fail := func(err error) error { _ = os.RemoveAll(staging); return err }
	for _, file := range files {
		if err := download(ctx, staging, file); err != nil {
			return fail(err)
		}
	}
	manifest, _ := json.Marshal(map[string]any{"provider": provider, "id": id, "version": version})
	if err := os.WriteFile(filepath.Join(staging, "manifest.json"), manifest, 0o600); err != nil {
		return fail(err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fail(err)
	}
	if _, err := os.Stat(target); err == nil {
		if err = os.RemoveAll(target); err != nil {
			return fail(err)
		}
	}
	if err := os.Rename(staging, target); err != nil {
		return fail(err)
	}
	return nil
}

func download(ctx context.Context, staging string, file File) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, file.URL, nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("could not download approved asset: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("could not download approved asset: %s", response.Status)
	}
	out, err := os.OpenFile(filepath.Join(staging, file.Name), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, response.Body)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return verify(filepath.Join(staging, file.Name), file)
}

// Remove deletes one catalog item's install directory.
func Remove(root, provider, id, version string) error {
	return os.RemoveAll(Dir(root, provider, id, version))
}
