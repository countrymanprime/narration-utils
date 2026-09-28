package series

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListOnAFreshInstallIsEmpty(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	list, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("want no series on a fresh install, got %#v", list)
	}
}

func TestSaveWithNoIDCreatesANewSeries(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	saved, err := store.Save(Series{Name: "The Sundered Isles", MemberProjectPaths: []string{"/books/book-one", "/books/book-two"}})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" {
		t.Fatal("want a generated id")
	}
	if saved.Name != "The Sundered Isles" {
		t.Fatalf("unexpected name: %#v", saved)
	}
	if len(saved.MemberProjectPaths) != 2 {
		t.Fatalf("unexpected members: %#v", saved.MemberProjectPaths)
	}

	list, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != saved.ID {
		t.Fatalf("unexpected list after save: %#v", list)
	}
}

func TestSaveWithAnExistingIDUpdatesInPlace(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	first, err := store.Save(Series{Name: "The Sundered Isles", MemberProjectPaths: []string{"/books/book-one"}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Save(Series{ID: first.ID, Name: "The Sundered Isles", MemberProjectPaths: []string{"/books/book-one", "/books/book-two"}})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("updating must reuse the same id: %s vs %s", first.ID, second.ID)
	}
	list, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("update must replace, not duplicate: got %d series", len(list))
	}
	if len(list[0].MemberProjectPaths) != 2 {
		t.Fatalf("unexpected members after update: %#v", list[0].MemberProjectPaths)
	}
}

func TestSaveRefusesAnEmptyName(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	if _, err := store.Save(Series{Name: "  "}); err == nil {
		t.Fatal("want an error saving a series with no name")
	}
}

func TestSaveCleansAndDeduplicatesMemberPaths(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	saved, err := store.Save(Series{
		Name: "Series",
		MemberProjectPaths: []string{
			"/books/book-one/",
			"/books/BOOK-ONE",
			"  /books/book-two  ",
			"",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.MemberProjectPaths) != 2 {
		t.Fatalf("want case-insensitive dedup and blank/whitespace removal, got %#v", saved.MemberProjectPaths)
	}
}

func TestDeleteRemovesASeries(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	saved, err := store.Save(Series{Name: "Series"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(saved.ID); err != nil {
		t.Fatal(err)
	}
	list, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("want no series left after delete, got %#v", list)
	}
}

func TestDeleteIsIdempotentOnAnUnknownID(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	if err := store.Delete("not-a-real-id"); err != nil {
		t.Fatalf("deleting an unknown id must not error: %v", err)
	}
}

func TestForProjectFindsTheOwningSeriesCaseInsensitively(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	saved, err := store.Save(Series{Name: "Series", MemberProjectPaths: []string{"/Books/Book-One"}})
	if err != nil {
		t.Fatal(err)
	}
	found, ok, err := store.ForProject("/books/book-one")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || found.ID != saved.ID {
		t.Fatalf("want to find the series by a case-insensitive path match, got ok=%v found=%#v", ok, found)
	}
}

func TestForProjectOnANonSeriesProjectReadsOkFalse(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	if _, err := store.Save(Series{Name: "Series", MemberProjectPaths: []string{"/books/book-one"}}); err != nil {
		t.Fatal(err)
	}
	_, ok, err := store.ForProject("/books/unrelated-project")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("want ok=false for a project that belongs to no series")
	}
}

// ForProjectOnAFreshInstall is the Phase 9 success signal: "opening a
// non-series project is behaviourally unchanged (no series file read
// attempted)". This package cannot enforce "no read attempted" - only a
// caller that never calls ForProject can guarantee that - so this test only
// asserts the file-not-found path is silent (no error, ok=false), which is
// what a caller checking series membership on every project open would see.
func TestForProjectOnAFreshInstallReadsOkFalseWithNoError(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "series.json"))
	_, ok, err := store.ForProject("/books/book-one")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("want ok=false with no series.json on disk")
	}
}

func TestSeriesFileIsWrittenAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "series.json")
	store := New(path)
	if _, err := store.Save(Series{Name: "Series"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".tmp"); err == nil {
		t.Fatal("want the temporary file renamed away after a successful write")
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(bytes) == 0 {
		t.Fatal("want series.json to contain the saved series")
	}
}

func TestSaveFailsWhenSeriesFileIsCorruptJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "series.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := New(path)
	if _, err := store.Save(Series{Name: "Series"}); err == nil {
		t.Fatal("want an error saving over a corrupt series file")
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	kept := false
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" && filepath.Base(entry.Name()) != "series.json" {
			kept = true
		}
	}
	if !kept {
		t.Fatalf("want the corrupt series file kept aside (narrator data, never silently discarded), found: %v", entries)
	}
}
