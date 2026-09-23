package dictionary

import (
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

func lookup(t *testing.T, path, word string) Result {
	t.Helper()
	result, err := LookupFile(path, word)
	if err != nil {
		t.Fatalf("LookupFile(%q): %v", word, err)
	}
	return result
}

// headwords is each entry as "headword/part of speech", in order.
func headwords(result Result) []string {
	var out []string
	for _, entry := range result.Entries {
		out = append(out, entry.Headword+"/"+entry.PartOfSpeech)
	}
	return out
}

func TestAWordIsFoundWithEachSenseItsDefinitionExamplesSynonymsAndAntonyms(t *testing.T) {
	result := lookup(t, buildFixtureIndex(t), "happy")
	if result.Query != "happy" || !reflect.DeepEqual(headwords(result), []string{"happy/adjective"}) {
		t.Fatalf("result = %+v", result)
	}
	senses := result.Entries[0].Senses
	if len(senses) != 2 {
		t.Fatalf("senses = %+v", senses)
	}
	first := senses[0]
	if first.Definition != "enjoying or showing or marked by joy or pleasure" || !reflect.DeepEqual(first.Examples, []string{"a happy smile"}) {
		t.Fatalf("first sense = %+v", first)
	}
	if !reflect.DeepEqual(first.Antonyms, []string{"unhappy"}) {
		t.Fatalf("antonyms = %v, want the antonym sense's word", first.Antonyms)
	}
	// Synonyms are the other members of the synset, never the word itself.
	if !reflect.DeepEqual(senses[1].Synonyms, []string{"felicitous"}) || len(first.Synonyms) != 0 {
		t.Fatalf("synonyms = %v and %v", first.Synonyms, senses[1].Synonyms)
	}
}

func TestEachPartOfSpeechIsItsOwnEntry(t *testing.T) {
	result := lookup(t, buildFixtureIndex(t), "run")
	// WordNet's order: noun, verb, adjective, adverb.
	if !reflect.DeepEqual(headwords(result), []string{"run/noun", "run/verb"}) {
		t.Fatalf("entries = %v", headwords(result))
	}
	if got := result.Entries[0].Senses[0].Synonyms; !reflect.DeepEqual(got, []string{"tally"}) {
		t.Fatalf("noun synonyms = %v", got)
	}
}

func TestTheSelectionIsNormalisedBeforeItIsLookedUp(t *testing.T) {
	path := buildFixtureIndex(t)
	for _, selection := range []string{"Happy", "  happy ", "“happy,”", "HAPPY!", "(happy)"} {
		if result := lookup(t, path, selection); result.Query != "happy" || len(result.Entries) != 1 {
			t.Fatalf("%q -> %+v", selection, result)
		}
	}
	// A curly apostrophe is the straight one WordNet spells with.
	if got, err := Normalize("don’t"); err != nil || got != "don't" {
		t.Fatalf("Normalize = %q, %v", got, err)
	}
}

func TestAnInflectedFormFindsItsBaseWord(t *testing.T) {
	path := buildFixtureIndex(t)
	// An irregular form WordNet lists.
	if got := headwords(lookup(t, path, "ran")); !reflect.DeepEqual(got, []string{"run/verb"}) {
		t.Fatalf("ran -> %v", got)
	}
	if got := headwords(lookup(t, path, "happiest")); !reflect.DeepEqual(got, []string{"happy/adjective"}) {
		t.Fatalf("happiest -> %v", got)
	}
	// A regular ending, detached by the part of speech's rules; only that part of speech is offered.
	if got := headwords(lookup(t, path, "cats")); !reflect.DeepEqual(got, []string{"cat/noun", "Cat/noun"}) {
		t.Fatalf("cats -> %v", got)
	}
	if got := headwords(lookup(t, path, "runs")); !reflect.DeepEqual(got, []string{"run/noun", "run/verb"}) {
		t.Fatalf("runs -> %v", got)
	}
}

func TestAWordThatIsNotThereIsAnEmptyResultNotAnError(t *testing.T) {
	result := lookup(t, buildFixtureIndex(t), "Zorblax")
	if result.Query != "zorblax" || len(result.Entries) != 0 {
		t.Fatalf("result = %+v", result)
	}
}

func TestAMultiWordLemmaIsNotIndexed(t *testing.T) {
	if _, err := LookupFile(buildFixtureIndex(t), "cat burglar"); !errors.Is(err, ErrNotAWord) {
		t.Fatalf("err = %v, want ErrNotAWord", err)
	}
}

func TestWhatIsNotOneWordIsRefused(t *testing.T) {
	path := buildFixtureIndex(t)
	for _, selection := range []string{"", "   ", "...", "two words", "line\nbreak", strings.Repeat("a", MaxWordLength+1)} {
		if _, err := LookupFile(path, selection); !errors.Is(err, ErrNotAWord) {
			t.Fatalf("%q: err = %v, want ErrNotAWord", selection, err)
		}
	}
}

func TestADamagedIndexIsAnErrorNotAPanic(t *testing.T) {
	path := buildFixtureIndex(t)
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"empty":           {},
		"another file":    []byte("not an index at all, just text that is long enough"),
		"truncated":       body[:len(body)/2],
		"header only":     body[:headerSize],
		"a huge count":    append(append([]byte{}, body[:8]...), append([]byte{0xff, 0xff, 0xff, 0x7f}, body[12:]...)...),
		"garbled records": append(append([]byte{}, body[:len(body)-40]...), []byte(strings.Repeat("\x00", 40))...),
	}
	for name, damaged := range cases {
		t.Run(name, func(t *testing.T) {
			bad := path + "." + strings.ReplaceAll(name, " ", "-")
			if err := os.WriteFile(bad, damaged, 0o600); err != nil {
				t.Fatal(err)
			}
			for _, word := range []string{"happy", "run", "zebra", "felicitous"} {
				if _, err := LookupFile(bad, word); err != nil && !errors.Is(err, ErrDamagedIndex) {
					t.Fatalf("%s: err = %v, want ErrDamagedIndex or a result", word, err)
				}
			}
		})
	}
	if _, err := LookupFile(path+".missing", "happy"); err == nil {
		t.Fatal("a missing index must be an error")
	}
}

// A file that is shorter than the tables said when it was opened (it shrank, or was swapped out, mid-lookup) is damage: a short read is
// never returned as a record padded with zeros.
func TestAShortReadIsDamageNotAZeroPaddedRecord(t *testing.T) {
	path := buildFixtureIndex(t)
	idx, err := openIndex(path)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.close()
	idx.blobSz += 1 << 10                                                                      // as if the file had been longer when it was opened
	if _, err := idx.readBlob(uint32(idx.blobSz-100), 100); !errors.Is(err, ErrDamagedIndex) { //nolint:gosec // G115: a small test file
		t.Fatalf("err = %v, want ErrDamagedIndex", err)
	}
}

func TestBuildingFromAFolderThatIsNotTheDatasetFails(t *testing.T) {
	out := t.TempDir() + "/index.bin"
	if err := BuildIndex(t.TempDir(), out); err == nil {
		t.Fatal("an empty folder built an index")
	}
	bad := writeFixture(t, map[string]any{"entries-a.json": []string{"not", "a", "map"}})
	if err := BuildIndex(bad, out); err == nil {
		t.Fatal("entries that are not the release's shape built an index")
	}
	dangling := writeFixture(t, map[string]any{"entries-a.json": map[string]any{
		"able": map[string]any{"a": map[string]any{"sense": []map[string]any{{"id": "able%3:00:00::", "synset": "missing-a"}}}},
	}})
	if err := BuildIndex(dangling, out); err == nil {
		t.Fatal("a sense whose synset is missing built an index")
	}
}

func TestTheIndexIsTheSameBytesEveryTimeItIsBuilt(t *testing.T) {
	first, err := os.ReadFile(buildFixtureIndex(t))
	if err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(buildFixtureIndex(t))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("two builds of the same dataset differ")
	}
}
