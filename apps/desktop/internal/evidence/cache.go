// This file is Phase 4 of the analysis evidence ledger PRD
// (docs/prds/analysis-evidence-ledger.prd.md#phase-4---per-item-result-cache,
// Q5, D8): the per-item result cache. Q5's recommendation (option A) is what
// this stores - per-source features (a silence run over the whole source, a
// transcript's words over the whole source), sliced to an item's played
// range on read, not per-played-range results. A trim changes the played
// range; a per-range entry would miss after every trim, while a whole-source
// entry survives it, because the cache key deliberately excludes the played
// range for a sliceable analyzer. Importers/callers: no production code
// imports this yet (it lands ahead of RC/ER/PS, the signal PRDs that will
// write and read cache entries, and ahead of Phase 6's staleness evaluator
// in this same package); apps/desktop/internal/manuscript/service.go's
// resetDerived adds CacheDir to the directories a manuscript reset clears.
// Public API added here: CacheDir, CacheEntryKey, CacheStore, NewCacheStore,
// CacheStore's Write/Read/Delete/Prune/Hits/Misses methods, TimedFeature and
// SliceFeatures. Data schema: a small JSON envelope (see cacheEnvelope)
// wrapping an opaque blob, versioned by its own SchemaVersion field
// (cacheSchemaVersion) - the store never looks inside the blob itself
// (Architecture Notes: "Cache blobs are opaque. The store keys and stores
// bytes; RC's words files and ER's silence and click features define their
// own formats (D8)"). User's instruction (verbatim): "you should have
// everythign you need to make decisions. anything that you think you need
// my decision on, create an open ADR for and keep going. callout any new
// adrs on the pr that you created them so i can review."
package evidence

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// cacheSchemaVersion is the schema version every entry written by this
// package carries. A file written by a newer version of the app reads as a
// miss, never as an error the narrator has to fix (Architecture Notes:
// "Each entry carries a schema version; an unknown version is treated as
// absent").
const cacheSchemaVersion = 1

// CacheEntryKey identifies one cache entry per Q5's recommendation: a
// source's identity, which analyzer produced the entry and at what version,
// and the analyzer's parameter hash. PlayedRange is nil for a sliceable
// entry (Q5 option A: a whole-source feature set an analyzer slices itself
// on read, per SliceFeatures below) - deliberately excluding the played
// range from the key so a trim, which only narrows or moves the played
// range, keeps hitting the same entry. PlayedRange is set only for a
// B-style analyzer that cannot slice its own result and instead caches one
// blob per played range (Q5's option B, kept as an escape hatch, not the
// recommended shape): such an entry is correctly invalidated by a trim,
// because the trim changes PlayedRange and therefore the key.
type CacheEntryKey struct {
	Source          SourceIdentity
	AnalyzerID      string
	AnalyzerVersion string
	ParamHash       string
	PlayedRange     *PlayedRange
}

// hash returns CacheEntryKey's stable, content-addressed identity: the
// filename an entry is stored under. Two keys that differ only in
// SourceIdentity.ModTime hash the same, matching AnalysisKey's own choice
// (fingerprint.go) to hash Path/Size/PartialHash but never ModTime, so a
// source file that is merely touched does not invalidate a cache entry
// whose sampled content is unchanged.
func (k CacheEntryKey) hash() string {
	parts := []string{
		k.Source.Path,
		strconv.FormatInt(k.Source.Size, 10),
		k.Source.PartialHash,
		k.AnalyzerID,
		k.AnalyzerVersion,
		k.ParamHash,
	}
	if k.PlayedRange != nil {
		parts = append(parts, "range", formatSeconds(k.PlayedRange.Start), formatSeconds(k.PlayedRange.End))
	} else {
		parts = append(parts, "whole-source")
	}
	return hashParts(parts...)
}

// cacheEnvelope is the on-disk shape of one cache file: an opaque blob (the
// analyzer's own format, per D8) plus enough metadata for CacheStore.Prune
// and CacheStore.Read to do their job without ever looking inside Blob.
// encoding/json encodes a []byte field as base64 automatically, so Blob's
// bytes round-trip exactly regardless of what they hold.
type cacheEnvelope struct {
	SchemaVersion int       `json:"schemaVersion"`
	WrittenAt     time.Time `json:"writtenAt"`
	Blob          []byte    `json:"blob"`
}

// CacheDir is the result cache's storage directory under a project
// (Architecture Notes: "narration-utils/analysis/cache/"). It is exported so
// manuscript.resetDerived can clear it without this package depending on the
// manuscript package.
func CacheDir(project string) string {
	return filepath.Join(project, "narration-utils", "analysis", "cache")
}

// CacheStore is the per-item result cache described by Q5 and D8: an opaque,
// keyed blob store under a project, one JSON file per entry, written
// temp-file-then-rename (the same pattern as LedgerStore.Write). Zero value
// is not usable; construct with NewCacheStore.
type CacheStore struct {
	dir      string
	mu       sync.Mutex
	hits     atomic.Int64
	misses   atomic.Int64
	Reporter *persist.Reporter
}

// NewCacheStore returns a CacheStore rooted at project's cache directory.
func NewCacheStore(project string) *CacheStore {
	return &CacheStore{dir: CacheDir(project)}
}

// Write stores blob under key, replacing any existing entry for the same
// key. The store never inspects blob; it is the analyzer's own opaque
// format (D8).
func (s *CacheStore) Write(key CacheEntryKey, blob []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("could not create the analysis cache: %w", err)
	}
	envelope := cacheEnvelope{SchemaVersion: cacheSchemaVersion, WrittenAt: time.Now().UTC(), Blob: blob}
	bytes, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	path := s.entryPath(key)
	temp := path + ".tmp"
	if err := os.WriteFile(temp, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the analysis cache entry: %w", err)
	}
	if err := os.Rename(temp, path); err != nil {
		return fmt.Errorf("could not activate the analysis cache entry: %w", err)
	}
	return nil
}

// Read returns the blob stored under key. It reports a miss (ok=false) when
// the entry is missing, unreadable, not valid JSON, or written by a newer
// schema than this package supports - every one of those is a cache miss,
// never an error the caller has to handle specially, matching LedgerStore's
// own unknown-version rule. Every call updates the Hits/Misses counters
// Phase 4's success signal and ER's Phase 5 measurement read.
func (s *CacheStore) Read(key CacheEntryKey) ([]byte, bool) {
	var blob []byte
	outcome := s.Reporter.ReadJSON(s.entryPath(key), "analysis cache entry", persist.Disposable, func(raw []byte) error {
		var envelope cacheEnvelope
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return err
		}
		if envelope.SchemaVersion > cacheSchemaVersion {
			return fmt.Errorf("schema version %d newer than supported %d", envelope.SchemaVersion, cacheSchemaVersion)
		}
		blob = envelope.Blob
		return nil
	})
	if outcome != persist.Loaded {
		s.misses.Add(1)
		return nil, false
	}
	s.hits.Add(1)
	return blob, true
}

// Delete removes key's entry, if any. A missing entry is not an error: the
// caller may be deleting a key that was already a miss.
func (s *CacheStore) Delete(key CacheEntryKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.entryPath(key)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("could not delete the analysis cache entry: %w", err)
	}
	return nil
}

// Hits is the number of Read calls that found a valid entry since this
// CacheStore was constructed.
func (s *CacheStore) Hits() int64 { return s.hits.Load() }

// Misses is the number of Read calls that did not find a valid entry since
// this CacheStore was constructed (missing, corrupt, or a newer schema).
func (s *CacheStore) Misses() int64 { return s.misses.Load() }

// Prune deletes the store's oldest entries (by WrittenAt) until the total
// size of what remains is at or under maxBytes, per the Architecture Notes'
// "size-bounded pruning" retention rule (exact bound TBD - measured on the
// corpus per the PRD; the bound itself is the caller's decision, this is the
// mechanism). A file this store cannot read (corrupt, wrong schema, a stray
// .tmp from an interrupted write) is left alone: Prune only removes entries
// it can positively identify as its own valid, datable files, the same
// "never delete a name it cannot positively rule out as safe" rule
// LedgerStore.Retain follows. It returns the keys' hashes (file base names,
// without ".json") it deleted.
func (s *CacheStore) Prune(maxBytes int64) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not list the analysis cache: %w", err)
	}

	type datedEntry struct {
		hash      string
		path      string
		size      int64
		writtenAt time.Time
	}
	var datable []datedEntry
	var total int64
	for _, entry := range entries {
		hash, ok := recordID(entry.Name())
		if !ok {
			continue
		}
		path := s.hashPath(hash)
		info, err := entry.Info()
		if err != nil {
			continue
		}
		envelope, ok := s.readEnvelope(path)
		if !ok {
			continue
		}
		total += info.Size()
		datable = append(datable, datedEntry{hash: hash, path: path, size: info.Size(), writtenAt: envelope.WrittenAt})
	}
	sort.Slice(datable, func(i, j int) bool { return datable[i].writtenAt.Before(datable[j].writtenAt) })

	var deleted []string
	for _, entry := range datable {
		if total <= maxBytes {
			break
		}
		if err := os.Remove(entry.path); err != nil {
			return deleted, fmt.Errorf("could not prune analysis cache entry %s: %w", entry.hash, err)
		}
		total -= entry.size
		deleted = append(deleted, entry.hash)
	}
	sort.Strings(deleted)
	return deleted, nil
}

func (s *CacheStore) entryPath(key CacheEntryKey) string {
	return s.hashPath(key.hash())
}

func (s *CacheStore) hashPath(hash string) string {
	return filepath.Join(s.dir, hash+".json")
}

// readEnvelope reads a cache file's envelope without counting it toward
// Hits/Misses (Prune is not an analyzer asking whether its result is
// current, so it must not skew those counters).
func (s *CacheStore) readEnvelope(path string) (cacheEnvelope, bool) {
	var envelope cacheEnvelope
	outcome := s.Reporter.ReadJSON(path, "analysis cache entry", persist.Disposable, func(raw []byte) error {
		var decoded cacheEnvelope
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return err
		}
		if decoded.SchemaVersion > cacheSchemaVersion {
			return fmt.Errorf("schema version %d newer than supported %d", decoded.SchemaVersion, cacheSchemaVersion)
		}
		envelope = decoded
		return nil
	})
	return envelope, outcome == persist.Loaded
}

// TimedFeature is one entry of a sliceable analyzer's whole-source cache
// blob (Q5 option A): a silence run or a transcript word, positioned by its
// own Start/End in the source file's own seconds - the same units and same
// origin as PlayedRange (fingerprint.go), so a feature and an item's played
// range are directly comparable. Payload is the analyzer's own per-feature
// data (D8: the store, and this helper, stay opaque to what a feature
// means); this package only ever looks at Start and End.
type TimedFeature struct {
	Start   float64         `json:"start"`
	End     float64         `json:"end"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// SliceFeatures returns the entries of features that overlap played, in the
// order given, so a caller who cached a source's features once (Q5 option A)
// can read the subset relevant to one item's current played range without
// recomputing anything - including after a trim moves that range, which is
// exactly the case CacheEntryKey.hash is built to survive (it does not
// depend on played range for a sliceable entry). An entry with
// End <= played.Start or Start >= played.End does not overlap and is
// excluded; a feature that only partially overlaps is still included whole
// (this package does not clip a feature's own boundaries - whether that is
// meaningful, for example for a silence run versus a whole transcript word,
// is the analyzer's call, not this generic helper's).
func SliceFeatures(features []TimedFeature, played PlayedRange) []TimedFeature {
	sliced := make([]TimedFeature, 0, len(features))
	for _, feature := range features {
		if feature.End <= played.Start || feature.Start >= played.End {
			continue
		}
		sliced = append(sliced, feature)
	}
	return sliced
}
