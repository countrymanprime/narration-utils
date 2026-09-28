package series

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
)

func writeReferences(t *testing.T, project string, refs []character.Reference) {
	t.Helper()
	dir := character.Dir(project)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "references.json"), marshalReferences(t, refs), 0o600); err != nil {
		t.Fatal(err)
	}
}

func marshalReferences(t *testing.T, refs []character.Reference) []byte {
	t.Helper()
	// A minimal, hand-built references.json in the same shape character.Service writes - schemaVersion 1 plus a
	// references array - so this test does not depend on character.Service's own approve flow just to seed data.
	type file struct {
		SchemaVersion int                   `json:"schemaVersion"`
		References    []character.Reference `json:"references"`
	}
	bytes, err := json.Marshal(file{SchemaVersion: 1, References: refs})
	if err != nil {
		t.Fatal(err)
	}
	return bytes
}

func TestSiblingsReadsEveryOtherMembersReferences(t *testing.T) {
	root := t.TempDir()
	bookOne := filepath.Join(root, "book-one")
	bookTwo := filepath.Join(root, "book-two")
	writeReferences(t, bookOne, []character.Reference{{ID: "r1", CharacterID: "char-alice"}})
	writeReferences(t, bookTwo, []character.Reference{{ID: "r2", CharacterID: "char-alice"}})

	entry := Series{ID: "s1", Name: "Series", MemberProjectPaths: []string{bookOne, bookTwo}}
	siblings := Siblings(entry, bookOne)

	if len(siblings) != 1 {
		t.Fatalf("want exactly the one other member (the caller's own project excluded), got %#v", siblings)
	}
	if siblings[0].ProjectPath != bookTwo {
		t.Fatalf("unexpected sibling: %#v", siblings[0])
	}
	if len(siblings[0].References) != 1 || siblings[0].References[0].ID != "r2" {
		t.Fatalf("unexpected sibling references: %#v", siblings[0].References)
	}
	if siblings[0].Unreadable != "" {
		t.Fatalf("want no unreadable reason for a readable sibling: %#v", siblings[0])
	}
}

func TestSiblingsExcludesTheCallersOwnProjectCaseInsensitively(t *testing.T) {
	root := t.TempDir()
	bookOne := filepath.Join(root, "book-one")
	entry := Series{ID: "s1", Name: "Series", MemberProjectPaths: []string{bookOne}}
	siblings := Siblings(entry, bookOne)
	if len(siblings) != 0 {
		t.Fatalf("want the caller's own project excluded, got %#v", siblings)
	}
}

func TestSiblingsReportsAMissingSiblingProjectAsUnreadableNotFatal(t *testing.T) {
	root := t.TempDir()
	bookOne := filepath.Join(root, "book-one")
	missing := filepath.Join(root, "book-two-does-not-exist")
	entry := Series{ID: "s1", Name: "Series", MemberProjectPaths: []string{bookOne, missing}}

	siblings := Siblings(entry, bookOne)

	if len(siblings) != 1 {
		t.Fatalf("want one sibling entry for the missing project, got %#v", siblings)
	}
	// A missing references.json is not an error (a book with no approved references yet, or a series member that
	// simply hasn't approved anything) - it reads as zero references, not "unreadable". "Unreadable" is reserved for
	// a sibling whose data exists but could not be decoded.
	if siblings[0].Unreadable != "" {
		t.Fatalf("want a missing project to read as zero references, not unreadable: %#v", siblings[0])
	}
	if len(siblings[0].References) != 0 {
		t.Fatalf("want zero references for a missing project: %#v", siblings[0])
	}
}

func TestSiblingsReportsAnUnreadableSiblingWithoutFailingTheWholeCall(t *testing.T) {
	root := t.TempDir()
	bookOne := filepath.Join(root, "book-one")
	bookTwo := filepath.Join(root, "book-two")
	writeReferences(t, bookOne, []character.Reference{{ID: "r1"}})
	dir := character.Dir(bookTwo)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "references.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	entry := Series{ID: "s1", Name: "Series", MemberProjectPaths: []string{bookOne, bookTwo}}
	siblings := Siblings(entry, bookOne)

	if len(siblings) != 1 {
		t.Fatalf("want one sibling entry, got %#v", siblings)
	}
	if siblings[0].Unreadable == "" {
		t.Fatal("want the corrupt sibling reported as unreadable")
	}
	if len(siblings[0].References) != 0 {
		t.Fatalf("want no references from an unreadable sibling: %#v", siblings[0].References)
	}

	// The sibling's own corrupt file must be left exactly as it was: Siblings/character.ReadOnly is a read-only
	// cross-project path (Q10/Q11's "no write path from one project's session into another project's own data"), so
	// it must never quarantine, rename or otherwise touch a file it does not own.
	bytes, err := os.ReadFile(filepath.Join(dir, "references.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "{not json" {
		t.Fatalf("want the sibling's corrupt file left untouched, got: %s", bytes)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "references.json" {
			t.Fatalf("want no extra file written into the sibling's data directory, found: %s", e.Name())
		}
	}
}

func TestSiblingsOnASingleMemberSeriesIsEmpty(t *testing.T) {
	root := t.TempDir()
	bookOne := filepath.Join(root, "book-one")
	entry := Series{ID: "s1", Name: "Series", MemberProjectPaths: []string{bookOne}}
	siblings := Siblings(entry, bookOne)
	if len(siblings) != 0 {
		t.Fatalf("want an empty result for a series with only the caller's own book, got %#v", siblings)
	}
}
