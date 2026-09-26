// This file is Phase 3 of the analysis evidence ledger PRD
// (docs/prds/analysis-evidence-ledger.prd.md#phase-3---analysis-ledger,
// Q3, D7): the ledger record type and its one-JSON-file-per-record store
// under <project>/narration-utils/analysis/ledger/. Importers/callers: the
// recording coverage service (apps/desktop/internal/coverage) writes one
// record per run, and Phase 6's staleness evaluator in this same package
// reads them; apps/desktop/internal/manuscript/service.go's resetDerived adds
// LedgerDir to the directories a manuscript reset clears. Public API added
// here: LedgerRecord and its nested LedgerScope/LedgerFingerprint/
// LedgerProjectFile types, LedgerOutcome and its three values, LedgerStore,
// NewLedgerStore, LedgerDir, and LedgerStore's Write/Get/Latest/List/All/
// Retain methods. Data schema: LedgerRecord's JSON shape below, versioned by
// its own SchemaVersion field (ledgerSchemaVersion). User's instruction
// (verbatim): "you should have everythign you need to make decisions.
// anything that you think you need my decision on, create an open ADR for
// and keep going. callout any new adrs on the pr that you created them so i
// can review."
//
// Phase 6 addition (staleness.go, docs/prds/analysis-evidence-ledger.prd.md
// #phase-6---staleness-evaluator): LedgerFingerprint gained ItemFacts, and
// this file gained the LedgerItemFact type. A record's ItemFingerprints and
// AnalysisKeys are opaque hashes by design (Architecture Notes: "Fingerprints
// hash a canonical encoding... never the raw chunk text"), which is exactly
// right for detecting *that* an item changed but cannot say *why* - hashes
// don't invert. Q4/Phase 6's evaluator needs to name the edit-type table's
// reason (item_moved vs item_trimmed vs item_muted vs take_switched vs
// source_changed) for the narrator, not just flag a mismatch, so ItemFacts
// keeps a small, plain (non-hashed) snapshot of exactly the fields the
// fingerprint hashes already commit to (Position, Length, Muted, ActiveTake,
// and a summary of SourceIdentity) beside the hash - never anything the
// fingerprint doesn't already cover, so this stays additive to "fingerprint"
// in spirit, not a second, independent record of item state. It is additive
// and backward compatible: ledgerSchemaVersion stays 1, and a record written
// before this field existed decodes with a nil ItemFacts map, which the
// evaluator treats as "identity unknown" and falls back to a coarser but
// still-correct reason (see staleness.go's itemChangeReason).
package evidence

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// ledgerSchemaVersion is the schema version every record written by this
// package carries. A record read back with a higher version was written by
// a newer app (Architecture Notes: "Each entry carries a schema version; an
// unknown version is treated as absent, never as an error the narrator has
// to fix") - readRecord treats it the same as a missing or corrupt file.
const ledgerSchemaVersion = 1

// LedgerOutcome is how an analyzer run ended (D7). Only a LedgerComplete
// record is meant to be read as a current result; LedgerPartial and
// LedgerFailed exist so "clean" (a completed run that found nothing) is
// never confused with "the run did not finish" (Evidence: measure.Evaluate
// returns an empty slice for a compliant report with nothing recording that
// the run happened at all).
type LedgerOutcome string

const (
	LedgerComplete LedgerOutcome = "complete"
	LedgerPartial  LedgerOutcome = "partial"
	LedgerFailed   LedgerOutcome = "failed"
)

// LedgerScope is what a ledger record's run covered: a chapter of a
// manuscript, optionally narrowed to one track or one set of items (a
// re-analysis of only the items an edit touched still records against the
// same chapter scope, per Phase 4's per-item cache).
type LedgerScope struct {
	DocumentID string   `json:"documentId"`
	ChapterID  string   `json:"chapterId"`
	TrackGUID  string   `json:"trackGuid,omitempty"`
	ItemGUIDs  []string `json:"itemGuids,omitempty"`
}

// LedgerFingerprint is the fingerprint state a record was computed against,
// so Phase 6's evaluator can compare it to the project's fingerprints now.
// ItemFingerprints, AnalysisKeys and ItemFacts are all keyed by item GUID.
type LedgerFingerprint struct {
	TrackFingerprint TrackFingerprint           `json:"trackFingerprint"`
	ItemFingerprints map[string]ItemFingerprint `json:"itemFingerprints,omitempty"`
	AnalysisKeys     map[string]AnalysisKey     `json:"analysisKeys,omitempty"`
	// ItemFacts is Phase 6's addition (see this file's header comment): a
	// plain, unhashed snapshot of the same fields ItemFingerprints already
	// hashes, so the staleness evaluator can name why an item's fingerprint
	// changed instead of only that it did. Absent (nil) on a record written
	// before Phase 6, which the evaluator treats as "identity unknown".
	ItemFacts map[string]LedgerItemFact `json:"itemFacts,omitempty"`
}

// LedgerItemFact is one item's plain-value snapshot at the moment a ledger
// record was written: exactly the fields ItemFingerprint hashes (Q2), plus a
// content-addressed summary of the active take's SourceIdentity (Path, Size,
// PartialHash - never ModTime, matching AnalysisKey's own reasoning in
// fingerprint.go) so the evaluator can tell "source replaced on disk" apart
// from "trimmed" or "playrate changed" without ever storing a raw file path
// or hash it would have to reconcile against a different project checkout.
type LedgerItemFact struct {
	Position       float64 `json:"position"`
	Length         float64 `json:"length"`
	Muted          bool    `json:"muted"`
	ActiveTake     int     `json:"activeTake"`
	SourceIdentity string  `json:"sourceIdentity"`
}

// LedgerProjectFile is the saved .rpp a record was computed against. D6:
// the basis is always the saved project, never live REAPER state, so every
// result can state "saved project, file modified <time>" (Q8).
type LedgerProjectFile struct {
	Path    string    `json:"path"`
	ModTime time.Time `json:"modTime"`
}

// LedgerRecord is one analyzer run's outcome (Solution Detail's "Ledger
// record" data model). It records that a run happened and on what, never a
// verdict: RC, ER and PS's analyzers decide met/not_met/unknown (D2) from
// what they measured, using this record only to answer "is that result
// still current".
type LedgerRecord struct {
	ID              string            `json:"id"`
	SchemaVersion   int               `json:"schemaVersion"`
	AnalyzerID      string            `json:"analyzerId"`
	AnalyzerVersion string            `json:"analyzerVersion"`
	ParamHash       string            `json:"paramHash,omitempty"`
	Scope           LedgerScope       `json:"scope"`
	Fingerprint     LedgerFingerprint `json:"fingerprint"`
	ProjectFile     LedgerProjectFile `json:"projectFile"`
	StartedAt       time.Time         `json:"startedAt"`
	CompletedAt     time.Time         `json:"completedAt"`
	Outcome         LedgerOutcome     `json:"outcome"`
	// Counts is opaque, analyzer-defined tallies (for example
	// "itemsAnalyzed", "cacheHits") - the ledger does not assume what an
	// analyzer counts, the same "store stays opaque" principle the PRD
	// applies to Phase 4's cache blobs.
	Counts map[string]int `json:"counts,omitempty"`
	// Payload is an analyzer-defined JSON document the ledger stores and
	// returns untouched, for what Counts cannot hold: the proofing signals
	// keep a Transcript Compare run's compared set and a render
	// measurement's values here (proofing-readiness-signals.prd.md Phases 2
	// and 4). Additive and optional: absent on every other analyzer's
	// records, so ledgerSchemaVersion stays 1.
	Payload json.RawMessage `json:"payload,omitempty"`
}

// LedgerDir is the ledger's storage directory under a project (Q3
// recommendation A: one JSON file per record under
// <project>/narration-utils/analysis/ledger/). It is exported so
// manuscript.resetDerived can clear it without this package depending on
// the manuscript package.
func LedgerDir(project string) string {
	return filepath.Join(project, "narration-utils", "analysis", "ledger")
}

// LedgerStore is the one-JSON-file-per-record store described by Q3. Writes
// are temp-file-then-rename (the saveNotes/SaveHints pattern), so a killed
// write never corrupts or loses a previously-written record. Zero value is
// not usable; construct with NewLedgerStore.
type LedgerStore struct {
	dir      string
	mu       sync.Mutex
	Reporter *persist.Reporter
}

// NewLedgerStore returns a LedgerStore rooted at project's ledger directory.
func NewLedgerStore(project string) *LedgerStore {
	return &LedgerStore{dir: LedgerDir(project)}
}

// Write assigns record an ID when it has none, stamps its schema version,
// and writes it to its own file via a temp file plus rename. It returns the
// record as written (with ID and SchemaVersion filled in). A LedgerRecord
// is content-addressed by its ID and, once written, is never rewritten in
// place: a re-analysis writes a new record with a new ID, so Write never
// needs to check what is already on disk before it replaces anything.
func (s *LedgerStore) Write(record LedgerRecord) (LedgerRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if record.ID == "" {
		record.ID = newLedgerID()
	}
	record.SchemaVersion = ledgerSchemaVersion

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return LedgerRecord{}, fmt.Errorf("could not create the analysis ledger: %w", err)
	}
	bytes, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return LedgerRecord{}, err
	}
	path := s.recordPath(record.ID)
	temp := path + ".tmp"
	if err := os.WriteFile(temp, bytes, 0o600); err != nil {
		return LedgerRecord{}, fmt.Errorf("could not write the analysis ledger record: %w", err)
	}
	if err := os.Rename(temp, path); err != nil {
		return LedgerRecord{}, fmt.Errorf("could not activate the analysis ledger record: %w", err)
	}
	return record, nil
}

// Get reads the record with the given id. It reports false when the record
// is missing, unreadable, not valid JSON, or written by a schema newer than
// this package supports (ledgerSchemaVersion) - every one of those reads as
// "absent", never as an error the caller has to handle specially, per the
// Architecture Notes' unknown-version rule.
func (s *LedgerStore) Get(id string) (LedgerRecord, bool) {
	return s.readRecord(s.recordPath(id))
}

// Latest returns the most recently started record whose AnalyzerID and
// Scope.ChapterID match, regardless of Outcome - callers that only want a
// complete result filter Outcome themselves (Phase 6's evaluator does; this
// package stays a plain store, not a policy).
func (s *LedgerStore) Latest(analyzerID, chapterID string) (LedgerRecord, bool) {
	records, err := s.List(analyzerID, chapterID)
	if err != nil || len(records) == 0 {
		return LedgerRecord{}, false
	}
	return records[0], true
}

// List returns every readable record matching analyzerID and chapterID,
// newest first (by StartedAt). Pass "" for either to match any value.
func (s *LedgerStore) List(analyzerID, chapterID string) ([]LedgerRecord, error) {
	all, err := s.All()
	if err != nil {
		return nil, err
	}
	matched := make([]LedgerRecord, 0, len(all))
	for _, record := range all {
		if analyzerID != "" && record.AnalyzerID != analyzerID {
			continue
		}
		if chapterID != "" && record.Scope.ChapterID != chapterID {
			continue
		}
		matched = append(matched, record)
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].StartedAt.After(matched[j].StartedAt) })
	return matched, nil
}

// All returns every readable record in the store, in no particular order.
// An unreadable or wrong-schema file is skipped, not reported as an error:
// the store is meant to survive a corrupt neighbour (these are derived
// facts a re-analysis can always replace, persist.Disposable's class).
func (s *LedgerStore) All() ([]LedgerRecord, error) {
	entries, err := os.ReadDir(s.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not list the analysis ledger: %w", err)
	}
	records := make([]LedgerRecord, 0, len(entries))
	for _, entry := range entries {
		id, ok := recordID(entry.Name())
		if !ok {
			continue
		}
		if record, ok := s.readRecord(s.recordPath(id)); ok {
			records = append(records, record)
		}
	}
	return records, nil
}

// Retain prunes the ledger to Q3's retention rule: the latest record per
// (AnalyzerID, Scope.ChapterID) is always kept, plus every record whose ID
// is in referencedIDs (a confirmation or dismissal's basis, D4 - those
// records must outlive newer runs of the same analyzer over the same
// chapter). Every other record file is deleted. It returns the IDs it
// deleted. A referenced ID that no longer exists is silently ignored, and a
// file this store cannot parse (corrupt, wrong schema, or a stray .tmp from
// an interrupted write) is left alone unless its filename's ID is neither
// referenced nor resolvable to a readable "latest" - i.e. Retain never
// deletes a name it cannot positively rule out as safe to keep, matching
// "an interrupted write leaves the previous record readable" (Success
// Metrics: ledger durability).
func (s *LedgerStore) Retain(referencedIDs []string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	referenced := make(map[string]bool, len(referencedIDs))
	for _, id := range referencedIDs {
		referenced[id] = true
	}

	entries, err := os.ReadDir(s.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not list the analysis ledger: %w", err)
	}

	type groupKey struct{ analyzerID, chapterID string }
	latestByGroup := map[groupKey]LedgerRecord{}
	readable := map[string]LedgerRecord{}
	for _, entry := range entries {
		id, ok := recordID(entry.Name())
		if !ok {
			continue
		}
		record, ok := s.readRecord(s.recordPath(id))
		if !ok {
			continue
		}
		readable[id] = record
		key := groupKey{record.AnalyzerID, record.Scope.ChapterID}
		if current, exists := latestByGroup[key]; !exists || record.StartedAt.After(current.StartedAt) {
			latestByGroup[key] = record
		}
	}
	keep := map[string]bool{}
	for _, record := range latestByGroup {
		keep[record.ID] = true
	}

	var deleted []string
	for id := range readable {
		if keep[id] || referenced[id] {
			continue
		}
		if err := os.Remove(s.recordPath(id)); err != nil {
			return deleted, fmt.Errorf("could not prune analysis ledger record %s: %w", id, err)
		}
		deleted = append(deleted, id)
	}
	sort.Strings(deleted)
	return deleted, nil
}

func (s *LedgerStore) recordPath(id string) string {
	return filepath.Join(s.dir, id+".json")
}

func (s *LedgerStore) readRecord(path string) (LedgerRecord, bool) {
	var record LedgerRecord
	outcome := s.Reporter.ReadJSON(path, "analysis ledger record", persist.Disposable, func(raw []byte) error {
		var decoded LedgerRecord
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return err
		}
		if decoded.SchemaVersion > ledgerSchemaVersion {
			return fmt.Errorf("schema version %d newer than supported %d", decoded.SchemaVersion, ledgerSchemaVersion)
		}
		record = decoded
		return nil
	})
	return record, outcome == persist.Loaded
}

// recordID reports the record ID a ledger file's name carries: any name
// ending in ".json" other than a stray ".tmp" file left by an interrupted
// Write (path+".tmp" never ends in ".json", so it is already excluded by
// the suffix check, but the explicit check documents the intent).
func recordID(name string) (string, bool) {
	if !strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".tmp") {
		return "", false
	}
	return strings.TrimSuffix(name, ".json"), true
}

func newLedgerID() string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Sprintf("ledger-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw)
}
