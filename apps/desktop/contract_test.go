package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The Bootstrap payloads the UI receives (ADR 0069). The UI's contract tests validate these files against its schemas and
// the mock client's answers against the same schemas, so a Bootstrap that drifts from its schema fails here or there.
// Machine-specific values (the temp project folder, the diagnostic id) are fixed so the files are stable.
func contractHost(t *testing.T, project string) *Host {
	t.Helper()
	host := NewHost()
	host.diagnostic = "go-1789000000000000000"
	host.config.projectFolder = project
	host.config.projectName = "Alice"
	host.config.daw = "REAPER"
	host.config.manuscriptPython, host.config.manuscriptBackend = "python.exe", "manuscript_guide.py"
	host.config.comparePython, host.config.compareBackend = "python.exe", "compare.py"
	host.config.reaperLauncher = "narration_launcher.lua"
	return host
}

func fixedBootstrap(host *Host) map[string]any {
	boot := host.Bootstrap()
	boot["projectFolder"] = "C:/Projects/Alice"
	if candidate, ok := boot["manuscriptCandidate"].(map[string]any); ok {
		candidate["path"] = "C:/Projects/Alice/Manuscript.docx"
	}
	return boot
}

func TestContractBootstrapWithAnImportedManuscript(t *testing.T) {
	project := t.TempDir()
	path := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	data := `{"schemaVersion":1,"documentId":"alice-1","importedAt":"2026-09-01T09:30:00Z","importer":{"format":"docx"},"source":{"fileName":"Alice.docx"},"chapters":[{"wordCount":120,"contentKind":"opening"},{"wordCount":1200,"contentKind":"narration"},{"wordCount":800,"contentKind":"narration"}]}`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "bootstrap-manuscript", fixedBootstrap(contractHost(t, project)))
}

func TestContractBootstrapOfferingAManuscriptCandidate(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "Manuscript.docx"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "bootstrap-candidate", fixedBootstrap(contractHost(t, project)))
}

func TestContractBootstrapOfAStandaloneLaunchWithNoProject(t *testing.T) {
	host := contractHost(t, "")
	host.config.projectName, host.config.daw = "", "Standalone"
	contractfile.Check(t, "bootstrap-standalone", host.Bootstrap())
}
