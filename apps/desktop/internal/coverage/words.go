package coverage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// wordsBlobVersion is the version of the cache blob this package keeps per
// source (the blob is opaque to the evidence cache, D8).
const wordsBlobVersion = 1

// maxSegmentsPerSource bounds one source's blob. A narrator who splits one
// long recording into many items has one segment per played range; past this
// many, the oldest are dropped and cost a transcription if they are needed.
const maxSegmentsPerSource = 256

// rangeTolerance matches the sidecar's RANGE_TOLERANCE_SECONDS.
const rangeTolerance = 0.001

// wordsBlob is one source's cached words: every words file (the sidecar's own
// JSON, kept byte for byte) the runs have produced for ranges of that source.
// EL's cache stores one entry per source (Q5 A: a trim keeps hitting it), and a
// source that several items play in different places needs several ranges, so
// the entry holds a list rather than one words file that each item would
// overwrite in turn.
type wordsBlob struct {
	SchemaVersion int               `json:"schemaVersion"`
	Segments      []json.RawMessage `json:"segments"`
}

// wordsRange is the part of a words file this package reads: the source range
// it transcribed. The sidecar validates the rest when it reads the file.
type wordsRange struct {
	SchemaVersion int     `json:"schemaVersion"`
	SourceStart   float64 `json:"sourceStart"`
	SourceEnd     float64 `json:"sourceEnd"`
}

func readWordsRange(raw []byte) (wordsRange, bool) {
	var header wordsRange
	if err := json.Unmarshal(raw, &header); err != nil || header.SchemaVersion != 1 || !(header.SourceEnd > header.SourceStart) {
		return wordsRange{}, false
	}
	return header, true
}

func (r wordsRange) covers(start, end float64) bool {
	return r.SourceStart <= start+rangeTolerance && r.SourceEnd >= end-rangeTolerance
}

// wordsCache moves words files between the evidence cache and a run's words
// directory.
type wordsCache struct {
	store     *evidence.CacheStore
	paramHash string
}

func (c wordsCache) key(identity evidence.SourceIdentity) evidence.CacheEntryKey {
	return evidence.CacheEntryKey{Source: identity, AnalyzerID: wordsAnalyzerID, AnalyzerVersion: wordsVersion, ParamHash: c.paramHash}
}

func (c wordsCache) read(identity evidence.SourceIdentity) wordsBlob {
	raw, ok := c.store.Read(c.key(identity))
	if !ok {
		return wordsBlob{SchemaVersion: wordsBlobVersion}
	}
	var blob wordsBlob
	if err := json.Unmarshal(raw, &blob); err != nil || blob.SchemaVersion != wordsBlobVersion {
		return wordsBlob{SchemaVersion: wordsBlobVersion}
	}
	return blob
}

// seed writes into dir, for every unmuted item, the narrowest cached words
// file that covers its played range. It returns how many items it seeded; an
// item with no covering segment is left for the sidecar to transcribe.
func (c wordsCache) seed(items []plannedItem, dir string) (int, error) {
	seeded := 0
	written := map[string]bool{}
	for _, item := range items {
		if item.Muted {
			continue
		}
		if written[item.WordsFile] {
			seeded++
			continue
		}
		segment, ok := bestSegment(c.read(item.identity), item.played)
		if !ok {
			continue
		}
		if err := writeAtomically(filepath.Join(dir, item.WordsFile), segment); err != nil {
			return seeded, err
		}
		written[item.WordsFile] = true
		seeded++
	}
	return seeded, nil
}

func bestSegment(blob wordsBlob, played evidence.PlayedRange) ([]byte, bool) {
	var best []byte
	bestWidth := 0.0
	for _, segment := range blob.Segments {
		header, ok := readWordsRange(segment)
		if !ok || !header.covers(played.Start, played.End) {
			continue
		}
		if width := header.SourceEnd - header.SourceStart; best == nil || width < bestWidth {
			best, bestWidth = segment, width
		}
	}
	return best, best != nil
}

// harvest stores every words file the run left in dir into its source's cache
// entry. It runs after every outcome, a cancel or a failure included: the
// sidecar writes each file atomically, so one that exists is finished. It
// returns how many new ranges it stored.
func (c wordsCache) harvest(items []plannedItem, dir string) (int, error) {
	stored := 0
	done := map[string]bool{}
	for _, item := range items {
		if item.Muted || done[item.WordsFile] {
			continue
		}
		done[item.WordsFile] = true
		raw, err := os.ReadFile(filepath.Join(dir, item.WordsFile))
		if err != nil {
			continue
		}
		header, ok := readWordsRange(raw)
		if !ok {
			continue
		}
		blob := c.read(item.identity)
		merged, changed := mergeSegment(blob, raw, header)
		if !changed {
			continue
		}
		encoded, err := json.Marshal(merged)
		if err != nil {
			return stored, err
		}
		if err := c.store.Write(c.key(item.identity), encoded); err != nil {
			return stored, fmt.Errorf("could not store the words of item %s: %w", item.ItemGUID, err)
		}
		stored++
	}
	return stored, nil
}

// mergeSegment adds a words file to a blob unless a cached one already covers
// its range, dropping every cached segment the new one covers.
func mergeSegment(blob wordsBlob, raw []byte, header wordsRange) (wordsBlob, bool) {
	kept := make([]json.RawMessage, 0, len(blob.Segments)+1)
	for _, segment := range blob.Segments {
		existing, ok := readWordsRange(segment)
		if !ok {
			continue
		}
		if existing.covers(header.SourceStart, header.SourceEnd) {
			return blob, false
		}
		if header.covers(existing.SourceStart, existing.SourceEnd) {
			continue
		}
		kept = append(kept, segment)
	}
	kept = append(kept, json.RawMessage(raw))
	if len(kept) > maxSegmentsPerSource {
		kept = kept[len(kept)-maxSegmentsPerSource:]
	}
	return wordsBlob{SchemaVersion: wordsBlobVersion, Segments: kept}, true
}

// writeAtomically writes to a temporary file and renames it, so a reader never
// sees half a file.
func writeAtomically(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
