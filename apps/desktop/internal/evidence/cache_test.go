package evidence

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func baseCacheKey() CacheEntryKey {
	return CacheEntryKey{
		Source:          SourceIdentity{Path: "media/a.wav", Size: 1000, PartialHash: "hash-a", ModTime: time.Unix(1000, 0)},
		AnalyzerID:      "rc",
		AnalyzerVersion: "1",
		ParamHash:       "params-1",
	}
}

// --- Write/Read round trip ---

func TestWriteThenReadReturnsTheSameBlob(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	key := baseCacheKey()
	blob := []byte(`{"silenceRuns":[[0,1],[4,5]]}`)

	if err := store.Write(key, blob); err != nil {
		t.Fatal(err)
	}
	got, ok := store.Read(key)
	if !ok {
		t.Fatal("Read did not find the entry that was written")
	}
	if string(got) != string(blob) {
		t.Fatalf("Read = %q, want %q", got, blob)
	}
}

func TestReadOnAMissingKeyIsAMiss(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	if _, ok := store.Read(baseCacheKey()); ok {
		t.Fatal("Read on an unwritten key reported a hit")
	}
}

func TestWriteStoresOneFilePerEntryUnderTheCacheDirectory(t *testing.T) {
	project := t.TempDir()
	store := NewCacheStore(project)
	key := baseCacheKey()
	if err := store.Write(key, []byte("x")); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected a file at %s: %v", path, err)
	}
}

func TestWriteOverwritesAnExistingEntryForTheSameKey(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	key := baseCacheKey()
	if err := store.Write(key, []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(key, []byte("second")); err != nil {
		t.Fatal(err)
	}
	got, ok := store.Read(key)
	if !ok || string(got) != "second" {
		t.Fatalf("Read after overwrite = %q, %v; want \"second\", true", got, ok)
	}
}

func TestDeleteRemovesTheEntrySoItSubsequentlyMisses(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	key := baseCacheKey()
	if err := store.Write(key, []byte("x")); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(key); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Read(key); ok {
		t.Fatal("Read found an entry after Delete")
	}
}

func TestDeleteOnAMissingEntryIsNotAnError(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	if err := store.Delete(baseCacheKey()); err != nil {
		t.Fatalf("Delete on a never-written key returned an error: %v", err)
	}
}

// --- Key computation (Q5) ---

func TestKeyIsStableAcrossSourceModTimeChanges(t *testing.T) {
	// The analysis key (fingerprint.go) deliberately excludes ModTime so a
	// merely-touched file does not always read as changed; the cache key
	// makes the same choice for the same reason.
	key := baseCacheKey()
	touched := key
	touched.Source.ModTime = key.Source.ModTime.Add(24 * time.Hour)
	if key.hash() != touched.hash() {
		t.Fatalf("hash changed when only ModTime changed: %s vs %s", key.hash(), touched.hash())
	}
}

func TestKeyDiffersWhenSourceContentDiffers(t *testing.T) {
	key := baseCacheKey()
	other := key
	other.Source.PartialHash = "hash-b"
	if key.hash() == other.hash() {
		t.Fatal("hash did not change when PartialHash changed")
	}
}

func TestKeyDiffersWhenAnalyzerVersionDiffers(t *testing.T) {
	key := baseCacheKey()
	other := key
	other.AnalyzerVersion = "2"
	if key.hash() == other.hash() {
		t.Fatal("hash did not change when AnalyzerVersion changed")
	}
}

func TestKeyDiffersWhenParamHashDiffers(t *testing.T) {
	key := baseCacheKey()
	other := key
	other.ParamHash = "params-2"
	if key.hash() == other.hash() {
		t.Fatal("hash did not change when ParamHash changed")
	}
}

func TestKeyDiffersBetweenWholeSourceAndAPlayedRange(t *testing.T) {
	key := baseCacheKey()
	ranged := key
	ranged.PlayedRange = &PlayedRange{Start: 0, End: 1}
	if key.hash() == ranged.hash() {
		t.Fatal("hash did not change between a whole-source key and a played-range key")
	}
}

func TestKeyDiffersBetweenTwoDifferentPlayedRanges(t *testing.T) {
	key := baseCacheKey()
	key.PlayedRange = &PlayedRange{Start: 0, End: 1}
	other := key
	other.PlayedRange = &PlayedRange{Start: 2, End: 3}
	if key.hash() == other.hash() {
		t.Fatal("hash did not change between two different played ranges")
	}
}

// --- Survives a trim (Q5's central property: whole-source entries outlive
// a played-range change, unlike a per-range entry would) ---

func TestAWholeSourceEntrySurvivesATrimAndSlicesCorrectlyAfterIt(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	source := SourceIdentity{Path: "media/a.wav", Size: 1000, PartialHash: "hash-a"}
	key := CacheEntryKey{Source: source, AnalyzerID: "rc", AnalyzerVersion: "1", ParamHash: "p1"}

	// The analyzer ran once over the whole source and cached every silence
	// run it found, in source-relative seconds.
	features := []TimedFeature{
		{Start: 0, End: 1},
		{Start: 4, End: 5},
		{Start: 9, End: 9.5},
	}
	blob, err := json.Marshal(features)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Write(key, blob); err != nil {
		t.Fatal(err)
	}

	// Before the trim, the item's played range is [3, 6): only the [4,5)
	// run is visible.
	before, ok := store.Read(key)
	if !ok {
		t.Fatal("Read did not find the whole-source entry before the trim")
	}
	var beforeFeatures []TimedFeature
	if err := json.Unmarshal(before, &beforeFeatures); err != nil {
		t.Fatal(err)
	}
	beforeSliced := SliceFeatures(beforeFeatures, PlayedRange{Start: 3, End: 6})
	if len(beforeSliced) != 1 || beforeSliced[0].Start != 4 {
		t.Fatalf("slice before trim = %#v, want exactly the [4,5) run", beforeSliced)
	}

	// The narrator trims the item's start: the played range narrows to
	// [4.5, 6). The cache key is unchanged (it never depended on the played
	// range for a sliceable entry), so the same entry is still found -
	// nothing was re-analyzed - and slicing it against the new range gives
	// the correct, different answer.
	after, ok := store.Read(key)
	if !ok {
		t.Fatal("Read did not find the whole-source entry after the trim; a whole-source cache entry must survive a trim (Q5)")
	}
	var afterFeatures []TimedFeature
	if err := json.Unmarshal(after, &afterFeatures); err != nil {
		t.Fatal(err)
	}
	afterSliced := SliceFeatures(afterFeatures, PlayedRange{Start: 4.5, End: 6})
	if len(afterSliced) != 1 || afterSliced[0].Start != 4 {
		t.Fatalf("slice after trim = %#v, want exactly the [4,5) run (it overlaps [4.5,6))", afterSliced)
	}

	// A range that no longer overlaps any feature (a trim past every run)
	// correctly slices to nothing, still without another cache write.
	afterFurtherTrim := SliceFeatures(afterFeatures, PlayedRange{Start: 6, End: 8})
	if len(afterFurtherTrim) != 0 {
		t.Fatalf("slice over a range with no features = %#v, want empty", afterFurtherTrim)
	}
	if store.Misses() != 0 {
		t.Fatalf("Misses = %d, want 0; the whole-source entry must never miss across a trim", store.Misses())
	}
}

func TestAPlayedRangeStyleEntryDoesNotSurviveATrim(t *testing.T) {
	// The contrast case: a B-style analyzer that cannot slice and instead
	// caches one blob per played range (Q5's non-recommended fallback) is
	// correctly invalidated by a trim, because PlayedRange is part of its
	// key.
	store := NewCacheStore(t.TempDir())
	source := SourceIdentity{Path: "media/a.wav", Size: 1000, PartialHash: "hash-a"}
	before := CacheEntryKey{Source: source, AnalyzerID: "er", AnalyzerVersion: "1", ParamHash: "p1", PlayedRange: &PlayedRange{Start: 3, End: 6}}
	if err := store.Write(before, []byte("result-for-3-to-6")); err != nil {
		t.Fatal(err)
	}

	afterTrim := CacheEntryKey{Source: source, AnalyzerID: "er", AnalyzerVersion: "1", ParamHash: "p1", PlayedRange: &PlayedRange{Start: 4.5, End: 6}}
	if _, ok := store.Read(afterTrim); ok {
		t.Fatal("a played-range-keyed entry hit after the played range changed; it should miss")
	}
	if store.Misses() != 1 {
		t.Fatalf("Misses = %d, want 1", store.Misses())
	}
}

// --- Hit/miss counters (Phase 4 success signal; ER's Phase 5 measurement) ---

func TestHitsAndMissesCountReadCallsSeparately(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	key := baseCacheKey()
	if err := store.Write(key, []byte("x")); err != nil {
		t.Fatal(err)
	}

	other := key
	other.AnalyzerID = "unwritten"
	store.Read(other) // miss
	store.Read(key)   // hit
	store.Read(key)   // hit
	store.Read(other) // miss

	if store.Hits() != 2 {
		t.Fatalf("Hits = %d, want 2", store.Hits())
	}
	if store.Misses() != 2 {
		t.Fatalf("Misses = %d, want 2", store.Misses())
	}
}

func TestASecondIdenticalRunReadsEveryEntry(t *testing.T) {
	// Phase 4 success signal, paraphrased for a per-item cache: writing N
	// entries once, then reading all N keys again, is N hits and 0 misses -
	// nothing needs to be re-analyzed.
	store := NewCacheStore(t.TempDir())
	keys := make([]CacheEntryKey, 0, 5)
	for i := 0; i < 5; i++ {
		key := baseCacheKey()
		key.ParamHash = string(rune('a' + i))
		keys = append(keys, key)
		if err := store.Write(key, []byte("result")); err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range keys {
		if _, ok := store.Read(key); !ok {
			t.Fatalf("Read missed a just-written entry: %+v", key)
		}
	}
	if store.Hits() != 5 || store.Misses() != 0 {
		t.Fatalf("Hits = %d, Misses = %d, want 5, 0", store.Hits(), store.Misses())
	}
}

func TestDeletingOneEntryMissesOnlyThatOne(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	kept := baseCacheKey()
	kept.ParamHash = "kept"
	removed := baseCacheKey()
	removed.ParamHash = "removed"
	if err := store.Write(kept, []byte("k")); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(removed, []byte("r")); err != nil {
		t.Fatal(err)
	}

	if err := store.Delete(removed); err != nil {
		t.Fatal(err)
	}

	if _, ok := store.Read(kept); !ok {
		t.Fatal("Read missed the entry that was not deleted")
	}
	if _, ok := store.Read(removed); ok {
		t.Fatal("Read hit the entry that was deleted")
	}
}

// --- Corrupt / unknown schema entries read as a miss ---

func TestACorruptEntryFileReadsAsAMiss(t *testing.T) {
	project := t.TempDir()
	store := NewCacheStore(project)
	key := baseCacheKey()
	if err := os.MkdirAll(CacheDir(project), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, ok := store.Read(key); ok {
		t.Fatal("Read returned a hit for a corrupt file")
	}
}

func TestAnEntryWrittenByANewerSchemaReadsAsAMiss(t *testing.T) {
	project := t.TempDir()
	store := NewCacheStore(project)
	key := baseCacheKey()
	if err := os.MkdirAll(CacheDir(project), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	future := `{"schemaVersion":999,"blob":"eA=="}`
	if err := os.WriteFile(path, []byte(future), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, ok := store.Read(key); ok {
		t.Fatal("Read returned a hit for a newer-schema file")
	}
}

func TestAStrayTmpFileFromAnInterruptedWriteDoesNotHideThePreviousEntry(t *testing.T) {
	project := t.TempDir()
	store := NewCacheStore(project)
	key := baseCacheKey()
	if err := store.Write(key, []byte("x")); err != nil {
		t.Fatal(err)
	}
	strayPath := filepath.Join(CacheDir(project), "in-flight.json.tmp")
	if err := os.WriteFile(strayPath, []byte(`{"schemaVersion":1`), 0o600); err != nil {
		t.Fatal(err)
	}

	got, ok := store.Read(key)
	if !ok || string(got) != "x" {
		t.Fatalf("Read after a stray .tmp = %q, %v; want \"x\", true", got, ok)
	}
}

// --- Error paths ---

func TestWriteFailsWhenTheCacheDirectoryPathIsBlockedByAFile(t *testing.T) {
	project := t.TempDir()
	// Put a regular file where CacheDir(project) would need to be a
	// directory, so os.MkdirAll cannot create it.
	if err := os.MkdirAll(filepath.Dir(CacheDir(project)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(CacheDir(project), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewCacheStore(project)
	if err := store.Write(baseCacheKey(), []byte("x")); err == nil {
		t.Fatal("Write did not fail when the cache directory path was blocked by a file")
	}
}

func TestWriteFailsWhenTheEntryPathIsANonEmptyDirectory(t *testing.T) {
	// The temp-file-then-rename write (the same pattern as LedgerStore.Write)
	// fails at the rename step when the final path is already occupied by a
	// non-empty directory, rather than silently succeeding over it.
	project := t.TempDir()
	store := NewCacheStore(project)
	key := baseCacheKey()
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "child"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(key, []byte("x")); err == nil {
		t.Fatal("Write did not fail when its target path was a non-empty directory")
	}
}

func TestDeleteFailsWhenTheEntryIsANonEmptyDirectory(t *testing.T) {
	project := t.TempDir()
	store := NewCacheStore(project)
	key := baseCacheKey()
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "child"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(key); err == nil {
		t.Fatal("Delete did not fail when the entry path was a non-empty directory")
	}
}

// --- Prune (size-bounded, oldest first) ---

func TestPruneRemovesOldestEntriesFirstUntilUnderTheBound(t *testing.T) {
	project := t.TempDir()
	store := NewCacheStore(project)

	oldest := baseCacheKey()
	oldest.ParamHash = "oldest"
	if err := store.Write(oldest, []byte("0123456789")); err != nil {
		t.Fatal(err)
	}
	middle := baseCacheKey()
	middle.ParamHash = "middle"
	if err := store.Write(middle, []byte("0123456789")); err != nil {
		t.Fatal(err)
	}
	newest := baseCacheKey()
	newest.ParamHash = "newest"
	if err := store.Write(newest, []byte("0123456789")); err != nil {
		t.Fatal(err)
	}

	// Force a deterministic write order regardless of clock resolution: set
	// each file's WrittenAt explicitly via the envelope, oldest to newest.
	setWrittenAt(t, project, oldest, time.Unix(100, 0))
	setWrittenAt(t, project, middle, time.Unix(200, 0))
	setWrittenAt(t, project, newest, time.Unix(300, 0))

	// Each file is a small JSON envelope a few dozen bytes over the 10-byte
	// blob; ask Prune to keep only enough room for one entry so exactly two
	// (the two oldest) must go.
	sizeOfOne := fileSize(t, project, newest)
	deleted, err := store.Prune(sizeOfOne)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 2 {
		t.Fatalf("Prune deleted %#v, want exactly 2 entries", deleted)
	}
	if _, ok := store.Read(newest); !ok {
		t.Fatal("Prune deleted the newest entry")
	}
	if _, ok := store.Read(oldest); ok {
		t.Fatal("Prune kept the oldest entry")
	}
	if _, ok := store.Read(middle); ok {
		t.Fatal("Prune kept the middle entry")
	}
}

func TestPruneDeletesNothingWhenAlreadyUnderTheBound(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	key := baseCacheKey()
	if err := store.Write(key, []byte("x")); err != nil {
		t.Fatal(err)
	}
	deleted, err := store.Prune(1 << 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 0 {
		t.Fatalf("Prune deleted %#v when already under the bound", deleted)
	}
	if _, ok := store.Read(key); !ok {
		t.Fatal("Prune under the bound removed the entry")
	}
}

func TestPruneOnAnEmptyStoreDeletesNothing(t *testing.T) {
	store := NewCacheStore(t.TempDir())
	deleted, err := store.Prune(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 0 {
		t.Fatalf("Prune on an empty store deleted %#v", deleted)
	}
}

func TestPruneLeavesAnUnreadableEntryAlone(t *testing.T) {
	project := t.TempDir()
	store := NewCacheStore(project)
	key := baseCacheKey()
	if err := os.MkdirAll(CacheDir(project), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := store.Prune(0); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("Prune should leave an unreadable file alone, but it is gone: %v", err)
	}
}

// setWrittenAt rewrites a written entry's envelope with an explicit
// WrittenAt, so Prune's oldest-first ordering test does not depend on clock
// resolution between three Write calls made microseconds apart.
func setWrittenAt(t *testing.T, project string, key CacheEntryKey, writtenAt time.Time) {
	t.Helper()
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var envelope cacheEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.WrittenAt = writtenAt
	rewritten, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, rewritten, 0o600); err != nil {
		t.Fatal(err)
	}
}

func fileSize(t *testing.T, project string, key CacheEntryKey) int64 {
	t.Helper()
	path := filepath.Join(CacheDir(project), key.hash()+".json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Size()
}

// --- SliceFeatures ---

func TestSliceFeaturesExcludesEntriesEntirelyBeforeTheRange(t *testing.T) {
	features := []TimedFeature{{Start: 0, End: 1}}
	got := SliceFeatures(features, PlayedRange{Start: 2, End: 3})
	if len(got) != 0 {
		t.Fatalf("got %#v, want empty (feature ends before the range starts)", got)
	}
}

func TestSliceFeaturesExcludesEntriesEntirelyAfterTheRange(t *testing.T) {
	features := []TimedFeature{{Start: 5, End: 6}}
	got := SliceFeatures(features, PlayedRange{Start: 2, End: 3})
	if len(got) != 0 {
		t.Fatalf("got %#v, want empty (feature starts after the range ends)", got)
	}
}

func TestSliceFeaturesIncludesAFeatureFullyInsideTheRange(t *testing.T) {
	features := []TimedFeature{{Start: 2.2, End: 2.8}}
	got := SliceFeatures(features, PlayedRange{Start: 2, End: 3})
	if len(got) != 1 {
		t.Fatalf("got %#v, want the one contained feature", got)
	}
}

func TestSliceFeaturesIncludesAPartiallyOverlappingFeature(t *testing.T) {
	features := []TimedFeature{{Start: 2.5, End: 4}} // overlaps [2,3) only in [2.5,3)
	got := SliceFeatures(features, PlayedRange{Start: 2, End: 3})
	if len(got) != 1 {
		t.Fatalf("got %#v, want the one overlapping feature", got)
	}
}

func TestSliceFeaturesPreservesOrderAndFiltersAMixedList(t *testing.T) {
	features := []TimedFeature{
		{Start: 0, End: 1},     // before
		{Start: 2.2, End: 2.4}, // inside
		{Start: 2.9, End: 3.5}, // overlapping the end
		{Start: 10, End: 11},   // after
	}
	got := SliceFeatures(features, PlayedRange{Start: 2, End: 3})
	if len(got) != 2 || got[0].Start != 2.2 || got[1].Start != 2.9 {
		t.Fatalf("got %#v, want [2.2,2.4) then [2.9,3.5) in order", got)
	}
}

func TestSliceFeaturesOnAnEmptyListIsEmpty(t *testing.T) {
	got := SliceFeatures(nil, PlayedRange{Start: 0, End: 1})
	if len(got) != 0 {
		t.Fatalf("got %#v, want empty", got)
	}
}
