package tts

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
	"strings"
)

type File struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
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
	root := filepath.Join(m.root, v.Provider, v.ID, v.Version)
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
	for _, f := range v.Files {
		if err := verify(filepath.Join(m.root, v.Provider, v.ID, v.Version, f.Name), f); err != nil {
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

// Install downloads only a catalog-owned URL. Files are verified in an
// adjacent staging directory and become visible only after every file passes.
func (m *Manager) Install(ctx context.Context, id string) error {
	v, ok := m.Voice(id)
	if !ok {
		return fmt.Errorf("the selected voice is not in the approved catalog")
	}
	if m.State(v) == "installed" {
		return nil
	}
	target := filepath.Join(m.root, v.Provider, v.ID, v.Version)
	staging := target + ".installing"
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return err
	}
	fail := func(err error) error { _ = os.RemoveAll(staging); return err }
	for _, file := range v.Files {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, file.URL, nil)
		if err != nil {
			return fail(err)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			return fail(fmt.Errorf("could not download approved voice asset: %w", err))
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			response.Body.Close()
			return fail(fmt.Errorf("could not download approved voice asset: %s", response.Status))
		}
		out, err := os.OpenFile(filepath.Join(staging, file.Name), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			response.Body.Close()
			return fail(err)
		}
		_, copyErr := io.Copy(out, response.Body)
		closeErr := out.Close()
		response.Body.Close()
		if copyErr != nil {
			return fail(copyErr)
		}
		if closeErr != nil {
			return fail(closeErr)
		}
		if err := verify(filepath.Join(staging, file.Name), file); err != nil {
			return fail(err)
		}
	}
	manifest, _ := json.Marshal(map[string]any{"catalogVersion": m.catalog.Version, "voiceId": v.ID, "voiceVersion": v.Version, "provider": v.Provider})
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
func (m *Manager) Remove(id string) error {
	v, ok := m.Voice(id)
	if !ok {
		return fmt.Errorf("the selected voice is not in the approved catalog")
	}
	return os.RemoveAll(filepath.Join(m.root, v.Provider, v.ID, v.Version))
}
