package recents

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func TestACorruptRecentsFileHealsAndIsLoggedButNotShownToTheNarrator(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recent-projects.json")
	if err := os.WriteFile(path, []byte(`[{"path": `), 0o600); err != nil {
		t.Fatal(err)
	}
	var logs, notices []string
	store := New(path)
	store.SetPersist(&persist.Reporter{
		Log:    func(kind, message string) { logs = append(logs, kind+" "+message) },
		Notify: func(text string) { notices = append(notices, text) },
	})

	entries, err := store.List()

	if err != nil || len(entries) != 0 {
		t.Fatalf("entries %v, err %v: recents is disposable and self-heals", entries, err)
	}
	if len(logs) != 1 || !strings.HasPrefix(logs[0], "persisted_corrupt ") || len(notices) != 0 {
		t.Fatalf("logs %v, notices %v: the self-heal must leave a trace and stay quiet", logs, notices)
	}
	folder := t.TempDir()
	if err := store.Touch(folder, "Alice"); err != nil {
		t.Fatal(err)
	}
	if entries, _ := store.List(); len(entries) != 1 {
		t.Fatalf("the next save must replace the corrupt file: %v", entries)
	}
}
