// This file is Phase 8 of docs/prds/editing-readiness-analysis.prd.md: the
// render path's own ledger record. Unlike the per-item records ledger.go
// writes (item-scoped, currency judged by evidence.LedgerFingerprint /
// evidence.EvaluateFingerprints), Phase 8's ledger scope is explicitly "the
// file fingerprint" (PRD Scope) - so this file does NOT reuse
// evidence.LedgerFingerprint/EvaluateFingerprints for staleness. It follows
// the simpler pattern apps/desktop/internal/proofing/renders.go's own
// RecordRenderMeasurements/decodeRenderMeasurement already established: a
// RenderKey string stored in the record's JSON Payload, compared directly
// against the render's *current* fingerprint key on read. That direct
// comparison IS this package's own "ledger scope is the file fingerprint"
// design; Fingerprint on the LedgerRecord itself is left at its zero value,
// unused.
package editing

import (
	"encoding/json"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// AnalyzerEditingRender is this package's render-path analyzer id. One
// record covers all three classes (silence, click, breath) in one decode
// pass, since there is exactly one file to decode, not one record per class
// per item like the per-item path (ledger.go, cache.go).
const AnalyzerEditingRender = "editing.render"

// RenderScanPayload is one render-scan ledger record's payload: which render
// (its fingerprint key and path) and the whole-file scan it produced, nil on
// a failed decode alongside the error string.
type RenderScanPayload struct {
	RenderKey string      `json:"renderKey"`
	Path      string      `json:"path"`
	Scan      *RenderScan `json:"scan,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// WriteRenderRecord writes one evidence.LedgerRecord scoped to
// {DocumentID, ChapterID} only - no TrackGUID, no ItemGUIDs - chapter-wide,
// matching "ledger scope is the file fingerprint" rather than an item scope.
// Fingerprint is left at its zero value: currency is judged by RenderKey
// equality (CurrentRenderRecord below), never by
// evidence.EvaluateFingerprints.
func WriteRenderRecord(ledger *evidence.LedgerStore, documentID, chapterID, renderKey, path string, projectFile evidence.LedgerProjectFile, startedAt, completedAt time.Time, outcome evidence.LedgerOutcome, scan *RenderScan, scanErr error) (evidence.LedgerRecord, error) {
	payload := RenderScanPayload{RenderKey: renderKey, Path: path, Scan: scan}
	if scanErr != nil {
		payload.Error = scanErr.Error()
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return evidence.LedgerRecord{}, err
	}
	return ledger.Write(evidence.LedgerRecord{
		AnalyzerID: AnalyzerEditingRender, AnalyzerVersion: AnalyzerVersion,
		Scope:       evidence.LedgerScope{DocumentID: documentID, ChapterID: chapterID},
		ProjectFile: projectFile,
		StartedAt:   startedAt, CompletedAt: completedAt,
		Outcome: outcome,
		Payload: encoded,
	})
}

// CurrentRenderRecord finds the newest complete AnalyzerEditingRender record
// scoped to documentID/chapterID whose payload's RenderKey equals
// currentRenderKey. It answers (record, payload, true, nil) on a hit,
// (zero, zero, false, nil) when none matches - never/stale, the caller does
// not need to distinguish them, since there is no "same file, different
// fingerprint" case to separate here: a key mismatch always means "not this
// file's record" - or a decode error.
func CurrentRenderRecord(ledger *evidence.LedgerStore, documentID, chapterID, currentRenderKey string) (evidence.LedgerRecord, RenderScanPayload, bool, error) {
	records, err := ledger.List(AnalyzerEditingRender, chapterID)
	if err != nil {
		return evidence.LedgerRecord{}, RenderScanPayload{}, false, err
	}
	for _, record := range records {
		if record.Outcome != evidence.LedgerComplete || record.Scope.DocumentID != documentID {
			continue
		}
		payload, ok := decodeRenderScanPayload(record)
		if !ok || payload.RenderKey != currentRenderKey {
			continue
		}
		return record, payload, true, nil
	}
	return evidence.LedgerRecord{}, RenderScanPayload{}, false, nil
}

func decodeRenderScanPayload(record evidence.LedgerRecord) (RenderScanPayload, bool) {
	var payload RenderScanPayload
	if len(record.Payload) == 0 || json.Unmarshal(record.Payload, &payload) != nil {
		return RenderScanPayload{}, false
	}
	return payload, true
}
