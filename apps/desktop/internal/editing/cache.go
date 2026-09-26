// This file bridges the editing package's own decode results (decode.go) to
// EL's per-item result cache (apps/desktop/internal/evidence/cache.go, Q5,
// D8). Architecture Notes leaves the exact cache shape ("per-source features
// or per-range results") to EL's own judgement, noting only that "ER
// requires that trimming one item does not force a re-decode of unrelated
// items". This package uses EL's Q5 option B shape (evidence.CacheEntryKey
// with PlayedRange set): one cache blob per item's own played range, keyed on
// that item's Source identity, analyzer id/version, parameter hash and
// played range. A trim changes PlayedRange, so it costs exactly one re-decode
// of that item (a documented, deliberate simplification versus Q5's
// recommended option A, a whole-source sliceable cache: this analyzer
// decodes only a played range in the first place, never the whole source
// file - Architecture Notes' own "trimmed dead air stays in the source file,
// so whole-file analysis would keep reporting it" is exactly why - so there
// is no naturally-whole-source feature set to slice from). It never forces a
// re-decode of any other item, satisfying Phase 5's own success signal.
package editing

import (
	"encoding/json"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// AnalyzerSilence, AnalyzerClick and AnalyzerBreath are this package's three
// analyzer ids (Architecture Notes: "One decode pass over an item writes
// three records, editing.silence, editing.click and editing.breath"). They
// name both the ledger record's AnalyzerID and the cache entry's AnalyzerID
// for their own class.
const (
	AnalyzerSilence = "editing.silence"
	AnalyzerClick   = "editing.click"
	AnalyzerBreath  = "editing.breath"
)

// cacheSchemaVersion is this package's own blob schema (D8: the cache store
// stays opaque to what a blob means; this is this package's private
// versioning inside that opaque blob, unrelated to evidence's own
// cacheSchemaVersion).
const cacheSchemaVersion = 1

// scanBlob is the opaque JSON this package stores in EL's CacheStore: the
// three classes' raw candidates from one decode pass, before any policy is
// applied (Architecture Notes: "Scan measures, evaluation decides").
type scanBlob struct {
	SchemaVersion   int                        `json:"schemaVersion"`
	DurationSeconds float64                    `json:"durationSeconds"`
	Silences        []measure.SilenceRegion    `json:"silences"`
	Cleanup         measure.CleanupDiagnostics `json:"cleanup"`
}

// CacheKey builds the cache entry key for one item's editing scan: src's
// identity, this package's own AnalyzerSilence id and version, paramHash
// (the scan-time parameters only - silence floor, minimum silence, cleanup
// thresholds - never the read-time policy, per "policy change costs no
// decode"), and src's own played range.
func CacheKey(source evidence.SourceIdentity, analyzerVersion, paramHash string, played evidence.PlayedRange) evidence.CacheEntryKey {
	return evidence.CacheEntryKey{
		Source: source, AnalyzerID: AnalyzerSilence, AnalyzerVersion: analyzerVersion, ParamHash: paramHash,
		PlayedRange: &evidence.PlayedRange{Start: played.Start, End: played.End},
	}
}

// WriteScan stores one item's decode result (ItemScan) in cache under key.
func WriteScan(cache *evidence.CacheStore, key evidence.CacheEntryKey, scan ItemScan) error {
	blob, err := json.Marshal(scanBlob{
		SchemaVersion: cacheSchemaVersion, DurationSeconds: scan.DurationSeconds,
		Silences: scan.Silences, Cleanup: scan.Cleanup,
	})
	if err != nil {
		return fmt.Errorf("encoding the editing scan cache entry: %w", err)
	}
	return cache.Write(key, blob)
}

// ReadScan reads back what WriteScan stored, reporting a miss (ok=false) for
// anything CacheStore.Read itself calls a miss, or a blob this package wrote
// a newer schema version of.
func ReadScan(cache *evidence.CacheStore, key evidence.CacheEntryKey) (ItemScan, bool) {
	raw, ok := cache.Read(key)
	if !ok {
		return ItemScan{}, false
	}
	var blob scanBlob
	if err := json.Unmarshal(raw, &blob); err != nil || blob.SchemaVersion > cacheSchemaVersion {
		return ItemScan{}, false
	}
	return ItemScan{DurationSeconds: blob.DurationSeconds, Silences: blob.Silences, Cleanup: blob.Cleanup}, true
}
