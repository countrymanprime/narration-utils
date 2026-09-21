package recents

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// What ProjectRecents sends to the UI (ADR 0069). Folder names are fixed and the times replaced by contractfile.Stabilize.
func TestContractRecentProjects(t *testing.T) {
	root := t.TempDir()
	store := New(filepath.Join(root, "recent-projects.json"))
	for _, name := range []string{"Alice", "Voltage"} {
		folder := filepath.Join(root, name)
		if err := os.MkdirAll(folder, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := store.Touch(folder, name); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	stable, err := contractfile.Stabilize(entries)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range stable.([]any) {
		record := entry.(map[string]any)
		record["path"] = "C:/Projects/" + record["name"].(string)
	}
	contractfile.Check(t, "project-recents", stable)
}

func TestContractNoRecentProjectsIsAnEmptyList(t *testing.T) {
	entries, err := New(filepath.Join(t.TempDir(), "none.json")).List()
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "project-recents-empty", entries)
}
