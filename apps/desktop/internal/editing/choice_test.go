package editing

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestChoiceStoreDefaultsToItems(t *testing.T) {
	store := NewChoiceStore(t.TempDir())
	choice, err := store.Get("doc-1", "chapter-1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if choice != SourceItems {
		t.Fatalf("Get() with no file = %q, want %q", choice, SourceItems)
	}
}

func TestChoiceStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store := NewChoiceStore(dir)
	if err := store.Set("doc-1", "chapter-1", SourceRender); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	choice, err := store.Get("doc-1", "chapter-1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if choice != SourceRender {
		t.Fatalf("Get() = %q, want %q", choice, SourceRender)
	}
	// A chapter never set, even in a document that has other choices, still
	// answers the default.
	other, err := store.Get("doc-1", "chapter-2")
	if err != nil || other != SourceItems {
		t.Fatalf("Get() for an unset chapter = %q, %v, want %q, nil", other, err, SourceItems)
	}
	if _, err := os.Stat(filepath.Join(ChoiceDir(dir), "source-choice.json.tmp")); !os.IsNotExist(err) {
		t.Fatal("the write must be temp-file-then-rename, leaving no temp file")
	}

	// Setting it back to items round-trips too (not just the non-default value).
	if err := store.Set("doc-1", "chapter-1", SourceItems); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	choice, err = store.Get("doc-1", "chapter-1")
	if err != nil || choice != SourceItems {
		t.Fatalf("Get() after resetting to items = %q, %v, want %q, nil", choice, err, SourceItems)
	}
}

func TestChoiceStoreRefusesAnInvalidChoice(t *testing.T) {
	store := NewChoiceStore(t.TempDir())
	if err := store.Set("doc-1", "chapter-1", SourceChoice("render-plus-fx")); err == nil {
		t.Fatal("Set() with an invalid choice must be refused")
	}
	// Refusing a bad value must not have written a file at all.
	choice, err := store.Get("doc-1", "chapter-1")
	if err != nil || choice != SourceItems {
		t.Fatalf("Get() after a refused Set() = %q, %v, want %q, nil (nothing written)", choice, err, SourceItems)
	}
}

func TestChoiceStoreSurfacesACorruptFileAndLeavesItAlone(t *testing.T) {
	dir := t.TempDir()
	store := NewChoiceStore(dir)
	if err := os.MkdirAll(ChoiceDir(dir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ChoiceFile(dir), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("doc-1", "chapter-1"); !errors.Is(err, ErrChoicesUnreadable) {
		t.Fatalf("Get() error = %v, want ErrChoicesUnreadable", err)
	}
	if err := store.Set("doc-1", "chapter-1", SourceRender); !errors.Is(err, ErrChoicesUnreadable) {
		t.Fatalf("Set() error = %v, want ErrChoicesUnreadable", err)
	}
	bytes, err := os.ReadFile(ChoiceFile(dir))
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "{not json" {
		t.Fatal("a corrupt file must not be overwritten")
	}
}

func TestChoiceStoreRefusesAFileWrittenByANewerVersion(t *testing.T) {
	dir := t.TempDir()
	store := NewChoiceStore(dir)
	if err := os.MkdirAll(ChoiceDir(dir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ChoiceFile(dir), []byte(`{"version":2,"documents":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("doc-1", "chapter-1"); !errors.Is(err, ErrChoicesUnreadable) {
		t.Fatalf("Get() error = %v, want ErrChoicesUnreadable", err)
	}
}
