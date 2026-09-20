package guide

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// vocabularyCandidatesOf writes a guide file and returns the candidates the service derives from it.
func vocabularyCandidatesOf(t *testing.T, guideJSON string) []string {
	t.Helper()
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.guidePath(), []byte(guideJSON), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := s.VocabularyCandidates()
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// create() seeds a new guide with "vocabulary_candidates": [], and import seeds the checked
// characters through create without building. The empty stored list used to win over the
// entities, so Suggest returned nothing on a freshly imported project.
func TestVocabularyCandidatesDeriveFromEntitiesWhenTheStoredListIsEmpty(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"vocabulary_candidates":[],"entities":[{"canonical_name":"Alice","category":"Character","manual":true,"aliases":[{"text":"Al"}]}]}`)
	if want := []string{"Al", "Alice"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

// Only build() recomputes the stored list, so names added by create, edit or merge afterwards
// were never suggested.
func TestVocabularyCandidatesAddNamesCreatedAfterTheLastBuild(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"vocabulary_candidates":["Dawnspire"],"entities":[{"canonical_name":"Dawnspire","category":"Place"},{"canonical_name":"Zeph","category":"Character","manual":true}]}`)
	if want := []string{"Dawnspire", "Zeph"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

func TestVocabularyCandidatesKeepTheStoredListAsAnAddition(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"vocabulary_candidates":["Old Name"],"entities":[]}`)
	if want := []string{"Old Name"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

// V3: in rules-only mode every auto-extracted lone word is Needs Review and stays out, but a
// name the narrator locked or added by hand is theirs and is suggested whatever its category.
func TestVocabularyCandidatesRelaxNeedsReviewForLockedAndManualEntries(t *testing.T) {
	entities := `[
		{"canonical_name":"Abandoned","category":"Needs Review"},
		{"canonical_name":"Drifting","category":"Draft"},
		{"canonical_name":"Kestrel","category":"Needs Review","locked":true},
		{"canonical_name":"Marrow","category":"Needs Review","manual":true},
		{"canonical_name":"Zeph","category":"Draft","manual":true},
		{"canonical_name":"Alice","category":"Character"},
		{"canonical_name":"Dawnspire","category":"Place","aliases":[{"text":"the Spire"}]}
	]`
	got := vocabularyCandidatesOf(t, `{"vocabulary_candidates":[],"entities":`+entities+`}`)
	if want := []string{"Alice", "Dawnspire", "Kestrel", "Marrow", "the Spire", "Zeph"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

func TestVocabularyCandidatesKeepTheFirstSpellingOfACaseInsensitiveDuplicate(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"vocabulary_candidates":["Alice"],"entities":[{"canonical_name":"alice","category":"Character"},{"canonical_name":"ALICE","category":"Character"}]}`)
	if want := []string{"Alice"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

// Hints are joined with commas for the recognizer, so a name that contains one cannot round-trip.
func TestVocabularyCandidatesSkipNamesThatCannotBeCommaJoined(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"entities":[{"canonical_name":"Smith, John","category":"Character"},{"canonical_name":"Line\nBreak","category":"Character"},{"canonical_name":"Alice","category":"Character"}]}`)
	if want := []string{"Alice"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

func TestVocabularyCandidatesIgnoreNonStringStoredValuesAndMalformedEntities(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"vocabulary_candidates":["Kept",7,null,{"x":1}],"entities":["nope",{"canonical_name":7,"category":"Character"}]}`)
	if want := []string{"Kept"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

func TestVocabularyCandidatesSayWhenThereIsNoGuideYet(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if _, err := s.VocabularyCandidates(); err == nil || !strings.Contains(err.Error(), "build the Story Bible") {
		t.Fatalf("error = %v, want the build-the-Story-Bible message", err)
	}
}

// ADR 0020's precision rule holds for derived names: a lone word the build is not sure of needs
// three occurrences, exactly as the sidecar's own list requires. Locked and manual entries are
// exempt, and an entity from a guide too old to carry occurrence data cannot be judged, so it stays.
func TestVocabularyCandidatesKeepTheSingleWordOccurrenceThreshold(t *testing.T) {
	entities := `[
		{"canonical_name":"Thorne","category":"Character","occurrence_count":1},
		{"canonical_name":"Marlow","category":"Character","occurrence_count":3},
		{"canonical_name":"Council of Ash","category":"Organization","occurrence_count":1},
		{"canonical_name":"Vesper","category":"Place","occurrences":[{"paragraph":1}]},
		{"canonical_name":"Ilex","category":"Place","occurrences":[{"paragraph":1},{"paragraph":2}],"aliases":[{"text":"the Ilex","occurrences":[{"paragraph":4}]}]},
		{"canonical_name":"Pell","category":"Character","occurrence_count":1,"manual":true},
		{"canonical_name":"Legacy","category":"Place"}
	]`
	got := vocabularyCandidatesOf(t, `{"entities":`+entities+`}`)
	if want := []string{"Council of Ash", "Ilex", "Legacy", "Marlow", "Pell", "the Ilex"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

// Guides from an earlier schema store an alias as a plain string, and the Python sidecar
// normalizes them on load; the host reads the file directly and must accept both.
func TestVocabularyCandidatesAcceptLegacyStringAliases(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"entities":[{"canonical_name":"Dawnspire","category":"Place","aliases":["the Spire",{"text":"Spire Keep"},7]}]}`)
	if want := []string{"Dawnspire", "Spire Keep", "the Spire"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

func TestVocabularyCandidatesToleratesNullCollections(t *testing.T) {
	got := vocabularyCandidatesOf(t, `{"vocabulary_candidates":null,"entities":null}`)
	if len(got) != 0 {
		t.Fatalf("candidates = %#v, want none", got)
	}
}
