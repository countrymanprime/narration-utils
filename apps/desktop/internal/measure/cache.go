package measure

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// The edit-and-proof-workspace PRD Phase 5's peaks cache (EP12 A: "cached per source identity in the
// evidence cache", ADR 0520). The cache always holds the WHOLE source's peaks, computed once from position
// 0 (Q5 option A, evidence/cache.go): a request narrowed to one item's played range never invalidates
// another item's entry for the same file, a trim only narrows or moves that range without changing the
// cache key, and a retake sharing an earlier item's source file is answered instantly from disk.

const (
	// peaksAnalyzerID and peaksVersion identify this package's entries in the evidence cache (evidence.CacheEntryKey).
	peaksAnalyzerID = "peaks"
	peaksVersion    = "1"
	// peaksBlobVersion is the cache entry's own schema version (D8: the store never looks inside the blob).
	peaksBlobVersion = 1
)

// peaksBlob is the opaque JSON this package stores in the evidence cache: the whole source's Peaks, computed
// once at perSecond buckets a second.
type peaksBlob struct {
	SchemaVersion int   `json:"schemaVersion"`
	Peaks         Peaks `json:"peaks"`
}

// CachedPeaksFile answers path's peaks over rng (or the whole file when rng is nil) at perSecond buckets a
// second, from store's evidence cache when a whole-source entry already exists there, computing and storing
// one otherwise. A source that is not a WAV answers ErrNotWAV, exactly as ComputePeaks/PeaksFile do (EP12 A:
// "no waveform"). rng narrows which buckets come back; the answer's StartSeconds is its first returned
// bucket's own start time, bucket-aligned to the source's absolute zero (see slicePeaks) - it may differ
// slightly from rng.StartSeconds when that does not itself fall on a bucket boundary, the same rounding a
// canvas drawn from these buckets already tolerates.
func CachedPeaksFile(ctx context.Context, store *evidence.CacheStore, identity evidence.SourceIdentity, path string, rng *Range, perSecond int) (Peaks, error) {
	if rng != nil {
		if err := rng.validate(); err != nil {
			return Peaks{}, err
		}
	}
	whole, err := wholeSourcePeaks(ctx, store, identity, path, perSecond)
	if err != nil {
		return Peaks{}, err
	}
	if rng == nil {
		return whole, nil
	}
	return slicePeaks(whole, rng.StartSeconds, rng.StartSeconds+rng.LengthSeconds), nil
}

// wholeSourcePeaks reads identity's whole-source peaks entry from store, computing and writing one with
// PeaksFile when it is missing, unreadable, or from a newer schema (every one of those is a cache miss, per
// CacheStore.Read's own rule). A failure to write the entry back is not reported: the cache is a
// performance optimisation, not a correctness requirement, and the peaks just computed are still answered.
func wholeSourcePeaks(ctx context.Context, store *evidence.CacheStore, identity evidence.SourceIdentity, path string, perSecond int) (Peaks, error) {
	key := peaksCacheKey(identity, perSecond)
	if raw, ok := store.Read(key); ok {
		var blob peaksBlob
		if err := json.Unmarshal(raw, &blob); err == nil && blob.SchemaVersion == peaksBlobVersion {
			return blob.Peaks, nil
		}
	}
	peaks, err := PeaksFile(ctx, path, nil, perSecond)
	if err != nil {
		return Peaks{}, err
	}
	if encoded, err := json.Marshal(peaksBlob{SchemaVersion: peaksBlobVersion, Peaks: peaks}); err == nil {
		_ = store.Write(key, encoded)
	}
	return peaks, nil
}

func peaksCacheKey(identity evidence.SourceIdentity, perSecond int) evidence.CacheEntryKey {
	return evidence.CacheEntryKey{
		Source:          identity,
		AnalyzerID:      peaksAnalyzerID,
		AnalyzerVersion: peaksVersion,
		ParamHash:       fmt.Sprintf("%d", perSecond),
	}
}

// slicePeaks narrows whole (starting at source second 0) to the buckets overlapping [start, end), clipped to
// what whole actually holds; end before whole's own start, or start past its end, answers zero buckets.
func slicePeaks(whole Peaks, start, end float64) Peaks {
	first := int(math.Floor(start * float64(whole.BucketsPerSecond)))
	last := int(math.Ceil(end * float64(whole.BucketsPerSecond)))
	if first < 0 {
		first = 0
	}
	if first > whole.Buckets {
		first = whole.Buckets
	}
	if last > whole.Buckets {
		last = whole.Buckets
	}
	if last < first {
		last = first
	}
	sliced := whole
	sliced.StartSeconds = float64(first) / float64(whole.BucketsPerSecond)
	sliced.Buckets = last - first
	sliced.MinMax = append([]byte(nil), whole.MinMax[2*first:2*last]...)
	return sliced
}
