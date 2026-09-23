package coverage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

func wordsFile(start, end float64) []byte {
	return []byte(fmt.Sprintf(`{"schemaVersion":1,"sourceStart":%g,"sourceEnd":%g,"words":[],"transcription":{"model":"small"}}`, start, end))
}

func TestMergingKeepsOneSegmentPerUncoveredRange(t *testing.T) {
	blob := wordsBlob{SchemaVersion: wordsBlobVersion}
	add := func(start, end float64) bool {
		raw := wordsFile(start, end)
		header, ok := readWordsRange(raw)
		if !ok {
			t.Fatalf("%s did not read", raw)
		}
		var changed bool
		blob, changed = mergeSegment(blob, raw, header)
		return changed
	}

	if !add(10, 20) || !add(40, 50) {
		t.Fatal("new ranges must be added")
	}
	if add(12, 18) {
		t.Fatal("a range a segment already covers must not be added")
	}
	if !add(0, 60) || len(blob.Segments) != 1 {
		t.Fatalf("a wider range must replace the ranges it covers: %d segments", len(blob.Segments))
	}
	blob.Segments = append(blob.Segments, json.RawMessage(`not json`))
	if !add(70, 80) || len(blob.Segments) != 2 {
		t.Fatalf("a segment that does not read must be dropped: %d segments", len(blob.Segments))
	}
}

func TestMergingIsBounded(t *testing.T) {
	blob := wordsBlob{SchemaVersion: wordsBlobVersion}
	for i := 0; i < maxSegmentsPerSource+5; i++ {
		raw := wordsFile(float64(i*10), float64(i*10+5))
		header, _ := readWordsRange(raw)
		blob, _ = mergeSegment(blob, raw, header)
	}
	if len(blob.Segments) != maxSegmentsPerSource {
		t.Fatalf("%d segments", len(blob.Segments))
	}
	first, _ := readWordsRange(blob.Segments[0])
	if first.SourceStart != 50 {
		t.Fatalf("the oldest segments must go first, the first left starts at %v", first.SourceStart)
	}
}

func TestSeedingPicksTheNarrowestCoveringSegmentAndSkipsWhatIsNotCached(t *testing.T) {
	dir := t.TempDir()
	cache := wordsCache{store: evidence.NewCacheStore(dir), paramHash: "p"}
	identity := evidence.SourceIdentity{Path: "a.wav", Size: 1, PartialHash: "h"}
	blob, _ := json.Marshal(wordsBlob{SchemaVersion: wordsBlobVersion, Segments: []json.RawMessage{wordsFile(0, 100), wordsFile(5, 20), json.RawMessage(`{}`)}})
	if err := cache.store.Write(cache.key(identity), blob); err != nil {
		t.Fatal(err)
	}
	items := []plannedItem{
		{ManifestItem: ManifestItem{ItemGUID: "{A}", WordsFile: "w-a.json"}, identity: identity, played: evidence.PlayedRange{Start: 10, End: 15}},
		{ManifestItem: ManifestItem{ItemGUID: "{SAME}", WordsFile: "w-a.json"}, identity: identity, played: evidence.PlayedRange{Start: 10, End: 15}},
		{ManifestItem: ManifestItem{ItemGUID: "{MUTED}", WordsFile: "w-m.json", Muted: true}, identity: identity, played: evidence.PlayedRange{Start: 10, End: 15}},
		{ManifestItem: ManifestItem{ItemGUID: "{WIDE}", WordsFile: "w-wide.json"}, identity: identity, played: evidence.PlayedRange{Start: 90, End: 120}},
	}
	words := filepath.Join(dir, "words")

	seeded, err := cache.seed(items, words)

	if err != nil || seeded != 2 {
		t.Fatalf("seeded %d, %v", seeded, err)
	}
	raw, err := os.ReadFile(filepath.Join(words, "w-a.json"))
	if err != nil {
		t.Fatal(err)
	}
	if header, _ := readWordsRange(raw); header.SourceStart != 5 || header.SourceEnd != 20 {
		t.Fatalf("seeded %+v, want the narrowest covering segment", header)
	}
	for _, name := range []string{"w-m.json", "w-wide.json"} {
		if _, err := os.Stat(filepath.Join(words, name)); err == nil {
			t.Fatalf("%s must not be seeded", name)
		}
	}
}

func TestACacheEntryThatDoesNotReadIsEmpty(t *testing.T) {
	dir := t.TempDir()
	cache := wordsCache{store: evidence.NewCacheStore(dir), paramHash: "p"}
	identity := evidence.SourceIdentity{Path: "a.wav"}
	if err := cache.store.Write(cache.key(identity), []byte(`{"schemaVersion":9}`)); err != nil {
		t.Fatal(err)
	}
	if blob := cache.read(identity); len(blob.Segments) != 0 || blob.SchemaVersion != wordsBlobVersion {
		t.Fatalf("blob = %+v", blob)
	}
}

func TestHarvestSkipsWordsFilesThatAreMissingOrUnreadable(t *testing.T) {
	dir := t.TempDir()
	cache := wordsCache{store: evidence.NewCacheStore(dir), paramHash: "p"}
	words := filepath.Join(dir, "words")
	if err := writeAtomically(filepath.Join(words, "bad.json"), []byte(`{"schemaVersion":1,"sourceStart":5,"sourceEnd":5}`)); err != nil {
		t.Fatal(err)
	}
	items := []plannedItem{
		{ManifestItem: ManifestItem{ItemGUID: "{GONE}", WordsFile: "gone.json"}},
		{ManifestItem: ManifestItem{ItemGUID: "{BAD}", WordsFile: "bad.json"}},
	}
	if stored, err := cache.harvest(items, words); stored != 0 || err != nil {
		t.Fatalf("stored %d, %v", stored, err)
	}
}
