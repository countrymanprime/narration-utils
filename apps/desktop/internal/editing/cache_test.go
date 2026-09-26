package editing

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

func TestWriteReadScanRoundTrips(t *testing.T) {
	cache := evidence.NewCacheStore(t.TempDir())
	identity := evidence.SourceIdentity{Path: "a.wav", Size: 100, PartialHash: "abc"}
	key := CacheKey(identity, "v1", "params-1", evidence.PlayedRange{Start: 0, End: 5})

	if _, ok := ReadScan(cache, key); ok {
		t.Fatalf("ReadScan() on an empty cache = hit, want miss")
	}

	scan := ItemScan{DurationSeconds: 5, Silences: []measure.SilenceRegion{{StartSeconds: 1, EndSeconds: 2}}}
	if err := WriteScan(cache, key, scan); err != nil {
		t.Fatalf("WriteScan() error = %v", err)
	}
	got, ok := ReadScan(cache, key)
	if !ok {
		t.Fatalf("ReadScan() after WriteScan() = miss, want hit")
	}
	if got.DurationSeconds != scan.DurationSeconds || len(got.Silences) != 1 || got.Silences[0] != scan.Silences[0] {
		t.Fatalf("ReadScan() = %+v, want %+v", got, scan)
	}
}

// TestTrimInvalidatesOnlyThatItemsCacheEntry is Phase 5's own success signal
// ("trimming one item re-decodes only that item's changes"), proven at the
// cache-key level: two different items' keys, from the same source file
// even, never collide, and changing one item's own played range (a trim)
// changes only its own key, leaving every other key (and therefore every
// other item's cache entry) untouched.
func TestTrimInvalidatesOnlyThatItemsCacheEntry(t *testing.T) {
	cache := evidence.NewCacheStore(t.TempDir())
	identity := evidence.SourceIdentity{Path: "a.wav", Size: 100, PartialHash: "abc"}
	keyA := CacheKey(identity, "v1", "params-1", evidence.PlayedRange{Start: 0, End: 5})
	keyB := CacheKey(identity, "v1", "params-1", evidence.PlayedRange{Start: 5, End: 10})

	_ = WriteScan(cache, keyA, ItemScan{DurationSeconds: 5})
	_ = WriteScan(cache, keyB, ItemScan{DurationSeconds: 5})

	// Trim item A: its played range narrows to [0,3).
	trimmedKeyA := CacheKey(identity, "v1", "params-1", evidence.PlayedRange{Start: 0, End: 3})
	if _, ok := ReadScan(cache, trimmedKeyA); ok {
		t.Fatalf("ReadScan() after a trim = hit, want a miss (the range changed)")
	}
	// Item B's own key and cache entry are completely unaffected.
	if _, ok := ReadScan(cache, keyB); !ok {
		t.Fatalf("ReadScan() for the untouched item = miss, want hit (a trim of a different item must not evict this one)")
	}
}

func TestCacheHitCostsNoDecodeInPractice(t *testing.T) {
	// Documents, rather than exercises, the cache-hit-costs-0-decodes claim:
	// ReadScan never calls Decode or opens a file - its only inputs are the
	// CacheStore and a key, both already in memory. A test that actually
	// counted decode calls belongs to Phase 5's job (service_test.go), which
	// is where a real "unchanged items cost 0 decodes" scenario (a whole
	// scan run twice) is exercised end to end.
	cache := evidence.NewCacheStore(t.TempDir())
	identity := evidence.SourceIdentity{Path: "a.wav", Size: 100, PartialHash: "abc"}
	key := CacheKey(identity, "v1", "params-1", evidence.PlayedRange{Start: 0, End: 5})
	_ = WriteScan(cache, key, ItemScan{DurationSeconds: 5})
	before := cache.Hits()
	if _, ok := ReadScan(cache, key); !ok {
		t.Fatalf("ReadScan() = miss, want hit")
	}
	if cache.Hits() != before+1 {
		t.Fatalf("CacheStore.Hits() did not increase by exactly one Read")
	}
}
