package manuscript

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// detectableExtensions are the formats the importer accepts, in the order they
// are preferred when a project folder holds more than one.
var detectableExtensions = []string{".docx", ".md", ".markdown"}

// DetectSource finds a manuscript waiting to be imported: a file named
// "manuscript" in a supported format sitting directly in the project folder,
// when no manuscript has been imported yet. It only ever suggests; nothing is
// imported until the user agrees (ADR-0018).
func DetectSource(project string) string {
	if project == "" {
		return ""
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")); err == nil {
		return ""
	}
	entries, err := os.ReadDir(project)
	if err != nil {
		return ""
	}
	found := map[string]string{}
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		extension := strings.ToLower(filepath.Ext(entry.Name()))
		if strings.EqualFold(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())), "manuscript") {
			found[extension] = filepath.Join(project, entry.Name())
		}
	}
	for _, extension := range detectableExtensions {
		if path, ok := found[extension]; ok {
			return path
		}
	}
	return ""
}

// Detect reports the detected manuscript for the current project, if any.
func (s *Service) Detect() string {
	s.mu.Lock()
	project := s.project
	s.mu.Unlock()
	return DetectSource(project)
}

// BeginDetected starts an import for a file previously offered by Detect. The
// path must be exactly the detected one, so this binding cannot be used to
// begin an import from an arbitrary location.
func (s *Service) BeginDetected(path string) (ImportJob, error) {
	detected := s.Detect()
	if detected == "" || filepath.Clean(detected) != filepath.Clean(path) {
		return ImportJob{}, fmt.Errorf("that file is not a manuscript waiting to be imported in this project")
	}
	return s.Begin(detected), nil
}
