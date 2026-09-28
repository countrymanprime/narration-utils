package preview

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPinStoreReadMissingIsZeroValue(t *testing.T) {
	store := NewPinStore(t.TempDir())
	pin, ok := store.Read()
	if ok {
		t.Fatal("Read reported ok for a project with no pin file")
	}
	if pin.ChapterID != "" {
		t.Fatalf("pin = %+v, want the zero value", pin)
	}
}

func TestPinStoreWriteThenRead(t *testing.T) {
	project := t.TempDir()
	store := NewPinStore(project)
	want := PinnedRange{
		ChapterID:    "c1",
		ParagraphIDs: []string{"c1a", "c1b"},
		AnchorText:   map[string]string{"c1a": "one", "c1b": "two"},
		PinnedAt:     time.Now().UTC().Truncate(time.Second),
	}
	if err := store.Write(want); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got, ok := store.Read()
	if !ok {
		t.Fatal("Read reported not ok after Write")
	}
	if got.ChapterID != want.ChapterID || !equalStrings(got.ParagraphIDs, want.ParagraphIDs) {
		t.Fatalf("Read = %+v, want %+v", got, want)
	}
	if got.AnchorText["c1a"] != "one" || got.AnchorText["c1b"] != "two" {
		t.Fatalf("AnchorText = %+v", got.AnchorText)
	}
	if !got.PinnedAt.Equal(want.PinnedAt) {
		t.Fatalf("PinnedAt = %v, want %v", got.PinnedAt, want.PinnedAt)
	}
}

func TestPinStoreWriteReplacesAnyEarlierPin(t *testing.T) {
	project := t.TempDir()
	store := NewPinStore(project)
	if err := store.Write(PinnedRange{ChapterID: "c1", ParagraphIDs: []string{"c1a"}, AnchorText: map[string]string{"c1a": "one"}}); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if err := store.Write(PinnedRange{ChapterID: "c2", ParagraphIDs: []string{"c2a"}, AnchorText: map[string]string{"c2a": "hi"}}); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got, ok := store.Read()
	if !ok || got.ChapterID != "c2" {
		t.Fatalf("Read = %+v, ok=%v; want the second pin only (a pin per book, Q9)", got, ok)
	}
}

func TestPinStoreClearRemovesTheFile(t *testing.T) {
	project := t.TempDir()
	store := NewPinStore(project)
	if err := store.Write(PinnedRange{ChapterID: "c1", ParagraphIDs: []string{"c1a"}, AnchorText: map[string]string{"c1a": "one"}}); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if _, ok := store.Read(); ok {
		t.Fatal("Read reported ok after Clear")
	}
	if _, err := os.Stat(PinFile(project)); !os.IsNotExist(err) {
		t.Fatalf("Clear left the pin file behind: %v", err)
	}
}

func TestPinStoreClearOnAMissingFileIsNotAnError(t *testing.T) {
	store := NewPinStore(t.TempDir())
	if err := store.Clear(); err != nil {
		t.Fatalf("Clear on a missing file: %v", err)
	}
}

// TestPinFileIsUnderTheProjectsNarrationUtilsFolder locks in the on-disk path resetDerived (manuscript/service.go)
// clears, so a rename here is caught by that test rather than silently orphaning old pin files.
func TestPinFileIsUnderTheProjectsNarrationUtilsFolder(t *testing.T) {
	got := PinFile("/a/project")
	want := filepath.Join("/a/project", "narration-utils", "preview-pin.json")
	if got != want {
		t.Fatalf("PinFile = %q, want %q", got, want)
	}
}

func TestPinStoreWriteIsAtomic(t *testing.T) {
	project := t.TempDir()
	store := NewPinStore(project)
	if err := store.Write(PinnedRange{ChapterID: "c1", ParagraphIDs: []string{"c1a"}, AnchorText: map[string]string{"c1a": "one"}}); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if _, err := os.Stat(PinFile(project) + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("Write left its temp file behind: %v", err)
	}
}
