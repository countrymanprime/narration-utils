// Package settings preserves Narration Utils' three-layer JSON settings
// contract: project overrides, then per-user global settings, then repository
// defaults. It intentionally reads existing files without rewriting schemas.
package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

type Values map[string]string

type Store struct {
	mu      sync.Mutex
	repo    string
	project string
}

func New(repo, project string) *Store      { return &Store{repo: repo, project: project} }
func (s *Store) SetProject(project string) { s.mu.Lock(); defer s.mu.Unlock(); s.project = project }

func (s *Store) Effective(tool, key, fallback string) (string, string) {
	if value, ok := s.Project(tool)[key]; ok {
		return value, "project"
	}
	if value, ok := s.Global(tool)[key]; ok {
		return value, "global"
	}
	if value, ok := s.Defaults(tool)[key]; ok {
		return value, "repo_default"
	}
	return fallback, "hardcoded"
}

// builtinDefaults mirrors shared/config/defaults.json. That file only exists in
// a source checkout; an installed build has no repo root, so without this every
// effective default read back empty - most visibly the Settings color pickers,
// which rendered #000000 for every color. store_test.go keeps the two in sync.
var builtinDefaults = map[string]Values{
	"General":           {"log_verbosity": "normal"},
	"ManuscriptGuide":   {"spacy_model": "en_core_web_sm"},
	"Piper":             {"tts_provider": "piper", "tts_voice_id": "en_US-ljspeech-high"},
	"Manuscript":        {"color_note": "B85C1E"},
	"TranscriptCompare": {"chunk_seconds": "60", "model_size": "small", "color_misread": "FF4040", "color_skipped": "FFC000", "color_extra": "40A0FF"},
}

// Defaults returns the repo file's values for tool, with any key the file does
// not provide filled from builtinDefaults.
func (s *Store) Defaults(tool string) Values {
	values := readTool(layout.Path(s.repoPath(), layout.DefaultsFile), tool)
	for key, value := range builtinDefaults[tool] {
		if _, ok := values[key]; !ok {
			values[key] = value
		}
	}
	return values
}
func (s *Store) Global(tool string) Values { return readTool(globalPath(), tool) }
func (s *Store) Project(tool string) Values {
	project := s.projectPath()
	if project == "" {
		return Values{}
	}
	return readTool(project, tool)
}

func (s *Store) Fields(scope string) map[string]map[string]any {
	result := map[string]map[string]any{}
	for _, tool := range []string{"General", "ManuscriptGuide", "Piper", "Manuscript", "TranscriptCompare"} {
		defaults := s.Defaults(tool)
		global := s.Global(tool)
		project := s.Project(tool)
		keys := map[string]bool{}
		for key := range defaults {
			keys[key] = true
		}
		for key := range global {
			keys[key] = true
		}
		for key := range project {
			keys[key] = true
		}
		for key := range keys {
			value, source := s.Effective(tool, key, "")
			if scope == "" || scope == source || scope == "effective" {
				result[tool+"."+key] = map[string]any{"value": value, "source": source}
			}
		}
	}
	return result
}

// Save changes exactly one requested tier. A nil value removes a project
// override; global nil is retained as JSON null for compatibility with the
// previous host's explicit global reset representation.
func (s *Store) Save(tool, scope string, changes map[string]*string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path := globalPath()
	if scope == "project" {
		path = projectPath(s.project)
		if path == "" {
			return fmt.Errorf("save the REAPER project before changing project settings")
		}
	} else if scope != "global" {
		return fmt.Errorf("unsupported settings scope")
	}
	document := readDocument(path)
	section, _ := document[tool].(map[string]any)
	if section == nil {
		section = map[string]any{}
	}
	for key, value := range changes {
		if value == nil && scope == "project" {
			delete(section, key)
		} else if value == nil {
			section[key] = nil
		} else {
			section[key] = *value
		}
	}
	document[tool] = section
	return writeDocument(path, document)
}

func (s *Store) repoPath() string { s.mu.Lock(); defer s.mu.Unlock(); return s.repo }
func (s *Store) projectPath() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return projectPath(s.project)
}
func projectPath(project string) string {
	if project == "" {
		return ""
	}
	return filepath.Join(project, "narration-utils", "settings.json")
}
func globalPath() string {
	if value := os.Getenv("APPDATA"); value != "" {
		return filepath.Join(value, "narration-utils", "global-settings.json")
	}
	if value := os.Getenv("USERPROFILE"); value != "" {
		return filepath.Join(value, "AppData", "Roaming", "narration-utils", "global-settings.json")
	}
	return filepath.Join("AppData", "Roaming", "narration-utils", "global-settings.json")
}
func readTool(path, tool string) Values {
	raw := readDocument(path)
	section, _ := raw[tool].(map[string]any)
	result := Values{}
	for key, value := range section {
		if text, ok := value.(string); ok {
			result[key] = text
		}
	}
	return result
}
func readDocument(path string) map[string]any {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return map[string]any{}
	}
	var document map[string]any
	if json.Unmarshal(bytes, &document) != nil || document == nil {
		return map[string]any{}
	}
	return document
}
func writeDocument(path string, document map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create settings directory: %w", err)
	}
	bytes, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write settings: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("could not activate settings: %w", err)
	}
	return nil
}
