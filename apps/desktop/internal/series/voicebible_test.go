package series

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
)

func writeCorruptReferences(t *testing.T, project string) {
	t.Helper()
	dir := character.Dir(project)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "references.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func namesFunc(m map[string]string) func() (map[string]string, error) {
	return func() (map[string]string, error) { return m, nil }
}

func referencesFunc(refs []character.ApprovedReference) func() ([]character.ApprovedReference, error) {
	return func() ([]character.ApprovedReference, error) { return refs, nil }
}

func TestBuildVoiceBibleOnAProjectNotInAnySeriesIsNotInSeries(t *testing.T) {
	root := t.TempDir()
	store := New(filepath.Join(root, "series.json"))
	bible, err := BuildVoiceBible(VoiceBibleConfig{SeriesStore: store, CurrentProject: filepath.Join(root, "book-one")})
	if err != nil {
		t.Fatal(err)
	}
	if bible.InSeries {
		t.Fatalf("want a project outside any series to read as not in a series, got %#v", bible)
	}
	if bible.Characters != nil {
		t.Fatalf("want no characters for a project not in a series, got %#v", bible.Characters)
	}
}

func TestBuildVoiceBibleOnASingleBookSeriesHasNoOtherBooksYet(t *testing.T) {
	root := t.TempDir()
	bookOne := filepath.Join(root, "book-one")
	store := New(filepath.Join(root, "series.json"))
	if _, err := store.Save(Series{Name: "Wonderland", MemberProjectPaths: []string{bookOne}}); err != nil {
		t.Fatal(err)
	}

	bible, err := BuildVoiceBible(VoiceBibleConfig{SeriesStore: store, CurrentProject: bookOne})
	if err != nil {
		t.Fatal(err)
	}
	if !bible.InSeries {
		t.Fatal("want the project to read as in a series")
	}
	if bible.BookCount != 1 {
		t.Fatalf("want BookCount 1, got %d", bible.BookCount)
	}
	if bible.Characters != nil {
		t.Fatalf("want no character list for a series with only one book yet (the honest empty state), got %#v", bible.Characters)
	}
}

func TestBuildVoiceBibleGroupsReferencesAcrossBooksByCharacterID(t *testing.T) {
	root := t.TempDir()
	bookOne, bookTwo := filepath.Join(root, "book-one"), filepath.Join(root, "book-two")
	writeReferences(t, bookTwo, []character.Reference{
		{
			ID: "r2", CharacterID: "entity-alice", RegionGUID: "g2",
			Snapshot: character.RegionSnapshot{Name: "Alice ref B", Start: 4, End: 6}, ApprovedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
		},
	})
	store := New(filepath.Join(root, "series.json"))
	entry, err := store.Save(Series{Name: "Wonderland", MemberProjectPaths: []string{bookOne, bookTwo}})
	if err != nil {
		t.Fatal(err)
	}

	ownRef := character.ApprovedReference{
		Reference: character.Reference{
			ID: "r1", CharacterID: "entity-alice", RegionGUID: "g1",
			Snapshot:   character.RegionSnapshot{Name: "Alice ref A", Start: 1, End: 3},
			ApprovedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		ChangedSinceApproval: false,
	}
	bible, err := BuildVoiceBible(VoiceBibleConfig{
		SeriesStore:       store,
		CurrentProject:    bookOne,
		CurrentReferences: referencesFunc([]character.ApprovedReference{ownRef}),
		CurrentNames:      namesFunc(map[string]string{"entity-alice": "Alice"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bible.InSeries || bible.SeriesID != entry.ID || bible.SeriesName != "Wonderland" || bible.BookCount != 2 {
		t.Fatalf("unexpected series header: %#v", bible)
	}
	if len(bible.Characters) != 1 {
		t.Fatalf("want one character (both references share entity-alice), got %#v", bible.Characters)
	}
	alice := bible.Characters[0]
	if alice.CharacterID != "entity-alice" || alice.Name != "Alice" {
		t.Fatalf("unexpected character: %#v", alice)
	}
	if len(alice.Clips) != 2 {
		t.Fatalf("want both books' clips grouped under the one character, got %#v", alice.Clips)
	}
	var own, sibling *VoiceBibleClip
	for i := range alice.Clips {
		if alice.Clips[i].IsCurrentProject {
			own = &alice.Clips[i]
		} else {
			sibling = &alice.Clips[i]
		}
	}
	if own == nil || own.ID != "r1" || own.ChangedSinceApproval == nil || *own.ChangedSinceApproval {
		t.Fatalf("unexpected own-project clip: %#v", own)
	}
	if sibling == nil || sibling.ID != "r2" || sibling.ChangedSinceApproval != nil {
		t.Fatalf("want a sibling clip with no changedSinceApproval verdict (unknown from a plain cross-project read), got %#v", sibling)
	}
	if own.Book != "book-one" || sibling.Book != "book-two" {
		t.Fatalf("unexpected book labels: own=%q sibling=%q", own.Book, sibling.Book)
	}
}

func TestBuildVoiceBibleFallsBackToTheCharacterIDWhenNoNameIsFound(t *testing.T) {
	root := t.TempDir()
	bookOne, bookTwo := filepath.Join(root, "book-one"), filepath.Join(root, "book-two")
	writeReferences(t, bookTwo, []character.Reference{{ID: "r2", CharacterID: "entity-unnamed"}})
	store := New(filepath.Join(root, "series.json"))
	if _, err := store.Save(Series{Name: "S", MemberProjectPaths: []string{bookOne, bookTwo}}); err != nil {
		t.Fatal(err)
	}

	bible, err := BuildVoiceBible(VoiceBibleConfig{SeriesStore: store, CurrentProject: bookOne})
	if err != nil {
		t.Fatal(err)
	}
	if len(bible.Characters) != 1 || bible.Characters[0].Name != "entity-unnamed" {
		t.Fatalf("want the raw id as a fallback label, got %#v", bible.Characters)
	}
}

func TestBuildVoiceBibleReportsAnUnreadableSiblingWithoutFailing(t *testing.T) {
	root := t.TempDir()
	bookOne, bookTwo := filepath.Join(root, "book-one"), filepath.Join(root, "book-two")
	writeCorruptReferences(t, bookTwo)
	store := New(filepath.Join(root, "series.json"))
	if _, err := store.Save(Series{Name: "S", MemberProjectPaths: []string{bookOne, bookTwo}}); err != nil {
		t.Fatal(err)
	}

	bible, err := BuildVoiceBible(VoiceBibleConfig{SeriesStore: store, CurrentProject: bookOne})
	if err != nil {
		t.Fatal(err)
	}
	if len(bible.UnreadableBooks) != 1 || bible.UnreadableBooks[0] != "book-two" {
		t.Fatalf("want book-two reported unreadable, got %#v", bible.UnreadableBooks)
	}
}
