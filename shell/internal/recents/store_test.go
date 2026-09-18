package recents

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListOnMissingFileReturnsEmptySlice(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries = %#v, want empty", entries)
	}
}

func TestTouchThenListRoundTrips(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	project := t.TempDir()
	if err := store.Touch(project, "My Book"); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %#v, want 1", entries)
	}
	if entries[0].Path != filepath.Clean(project) || entries[0].Name != "My Book" {
		t.Fatalf("entry = %#v", entries[0])
	}
	if entries[0].LastOpened.IsZero() {
		t.Fatal("LastOpened must be set")
	}
}

func TestTouchDedupesAndMovesToFront(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	first := t.TempDir()
	second := t.TempDir()
	if err := store.Touch(first, "First"); err != nil {
		t.Fatal(err)
	}
	if err := store.Touch(second, "Second"); err != nil {
		t.Fatal(err)
	}
	if err := store.Touch(first, "First Renamed"); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %#v, want 2 (deduped)", entries)
	}
	if entries[0].Path != filepath.Clean(first) || entries[0].Name != "First Renamed" {
		t.Fatalf("front entry = %#v, want re-touched %q", entries[0], first)
	}
	if entries[1].Path != filepath.Clean(second) {
		t.Fatalf("second entry = %#v, want %q", entries[1], second)
	}
}

func TestTouchTruncatesBeyondTenEntries(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	var oldest string
	for index := 0; index < 11; index++ {
		project := t.TempDir()
		if index == 0 {
			oldest = project
		}
		if err := store.Touch(project, "Project"); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 10 {
		t.Fatalf("entries = %d, want 10", len(entries))
	}
	for _, entry := range entries {
		if entry.Path == filepath.Clean(oldest) {
			t.Fatalf("oldest entry %q must have been truncated", oldest)
		}
	}
}

func TestListSelfHealsFromACorruptedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recent-projects.json")
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := New(path)
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries = %#v, want empty for a corrupted file", entries)
	}
	project := t.TempDir()
	if err := store.Touch(project, "Recovered"); err != nil {
		t.Fatal(err)
	}
	entries, err = store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "Recovered" {
		t.Fatalf("entries after recovery = %#v", entries)
	}
}

func TestTouchDedupesCaseInsensitively(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	project := t.TempDir()
	if err := store.Touch(strings.ToUpper(project), "Upper"); err != nil {
		t.Fatal(err)
	}
	if err := store.Touch(strings.ToLower(project), "Lower"); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "Lower" {
		t.Fatalf("entries = %#v, want a single deduped entry", entries)
	}
}

func TestTouchPrunesDeadEntriesBeforeTruncating(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	dead := t.TempDir()
	if err := store.Touch(dead, "Dead"); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(dead); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < maxEntries; index++ {
		if err := store.Touch(t.TempDir(), "Project"); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != maxEntries {
		t.Fatalf("entries = %d, want %d (the dead entry must not occupy a slot)", len(entries), maxEntries)
	}
}

func TestRemoveDropsTheMatchingEntry(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	first := t.TempDir()
	second := t.TempDir()
	if err := store.Touch(first, "First"); err != nil {
		t.Fatal(err)
	}
	if err := store.Touch(second, "Second"); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(first); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Path != filepath.Clean(second) {
		t.Fatalf("entries = %#v, want only %q left", entries, second)
	}
}

func TestRemoveIsANoOpWhenPathIsNotPresent(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	project := t.TempDir()
	if err := store.Touch(project, "Project"); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %#v, want the untouched single entry", entries)
	}
}

func TestRemoveIsCaseInsensitive(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	project := t.TempDir()
	if err := store.Touch(project, "Project"); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(strings.ToUpper(project)); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries = %#v, want empty after case-insensitive removal", entries)
	}
}

func TestListDropsEntryWhoseFolderWasDeleted(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "recent-projects.json"))
	project := t.TempDir()
	if err := store.Touch(project, "Gone Soon"); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(project); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries = %#v, want empty after folder deletion", entries)
	}
}
