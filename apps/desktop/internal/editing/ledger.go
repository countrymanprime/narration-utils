// This file writes and reads this package's ledger records
// (apps/desktop/internal/evidence/ledger.go, EL Phase 3): one record per
// item per class per decode pass (Architecture Notes: "One decode pass over
// an item writes three records..., each with analyzer version, parameter
// hash, scope, outcome complete|partial|failed, and counts, so a class can
// go stale alone when its detector version changes"). Item-level scoping
// (Scope.ItemGUIDs holding exactly one GUID) is deliberate, not chapter-wide
// like the recording coverage analyzer's one-record-per-chapter-per-run: ER
// needs "editing one item re-decodes only that item" (Success Metrics), so
// staleness has to be checked per item, which needs a record per item.
package editing

import (
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// ItemScopeInput is what WriteLedgerRecord and CurrentItemRecord need to
// identify one item's own fingerprint (EL Phase 2/6): the parsed item, its
// resolved analysis key (from Resolve/evidence.ComputeAnalysisKey) and the
// project it belongs to.
type ItemScopeInput struct {
	DocumentID string
	ChapterID  string
	TrackGUID  string
	Item       tracks.Item
	Key        evidence.AnalysisKey
}

// itemFingerprint computes in.Item's own single-item LedgerFingerprint,
// reusing EL's exported fingerprint machinery (ComputeItemFingerprint,
// ComputeTrackFingerprint) over a one-entry list: it is a valid, correctly
// comparable fingerprint of exactly this one item, at item scope rather than
// EL's usual chapter scope.
func itemFingerprint(in ItemScopeInput) evidence.LedgerFingerprint {
	itemFP := evidence.ComputeItemFingerprint(in.Key, in.Item)
	entry := evidence.TrackFingerprintEntry{Item: in.Item, Fingerprint: itemFP}
	return evidence.LedgerFingerprint{
		TrackFingerprint: evidence.ComputeTrackFingerprint([]evidence.TrackFingerprintEntry{entry}),
		ItemFingerprints: map[string]evidence.ItemFingerprint{in.Item.GUID: itemFP},
		AnalysisKeys:     map[string]evidence.AnalysisKey{in.Item.GUID: in.Key},
	}
}

// WriteLedgerRecord writes one item-scoped ledger record for analyzerID
// (AnalyzerSilence, AnalyzerClick or AnalyzerBreath), stamping start/end and
// the given outcome and counts.
func WriteLedgerRecord(ledger *evidence.LedgerStore, analyzerID, analyzerVersion, paramHash string, in ItemScopeInput, projectFile evidence.LedgerProjectFile, startedAt, completedAt time.Time, outcome evidence.LedgerOutcome, counts map[string]int) (evidence.LedgerRecord, error) {
	return ledger.Write(evidence.LedgerRecord{
		AnalyzerID: analyzerID, AnalyzerVersion: analyzerVersion, ParamHash: paramHash,
		Scope: evidence.LedgerScope{
			DocumentID: in.DocumentID, ChapterID: in.ChapterID, TrackGUID: in.TrackGUID, ItemGUIDs: []string{in.Item.GUID},
		},
		Fingerprint: itemFingerprint(in),
		ProjectFile: projectFile,
		StartedAt:   startedAt,
		CompletedAt: completedAt,
		Outcome:     outcome,
		Counts:      counts,
	})
}

// ItemStaleness is one item's answer to "is the newest complete record for
// analyzerID still current" (EL Phase 6's Q4 rule, applied at item scope
// rather than chapter scope): never (no complete record at all), stale (an
// item, analyzer or parameter mismatch), or current.
type ItemStaleness struct {
	State  evidence.EvaluatorState
	Record *evidence.LedgerRecord // nil for StateNever
}

// CurrentItemRecord finds the newest complete record of analyzerID scoped to
// exactly in.Item.GUID (never a chapter-wide or multi-item record: this
// package only ever writes single-item scopes, so a record naming more than
// one item, or a different one, is never a match for this item) and
// compares its fingerprint, analyzer version and parameter hash against
// in's current ones.
func CurrentItemRecord(ledger *evidence.LedgerStore, analyzerID, analyzerVersion, paramHash string, in ItemScopeInput) (ItemStaleness, error) {
	records, err := ledger.List(analyzerID, in.ChapterID)
	if err != nil {
		return ItemStaleness{}, err
	}
	for _, record := range records {
		if record.Outcome != evidence.LedgerComplete || !scopesOneItem(record.Scope, in.Item.GUID) {
			continue
		}
		result := evidence.EvaluateFingerprints(record, itemFingerprint(in), in.TrackGUID, analyzerVersion, paramHash)
		return ItemStaleness{State: result.State, Record: result.Record}, nil
	}
	return ItemStaleness{State: evidence.StateNever}, nil
}

// scopesOneItem reports whether scope names exactly one item, itemGUID.
func scopesOneItem(scope evidence.LedgerScope, itemGUID string) bool {
	return len(scope.ItemGUIDs) == 1 && scope.ItemGUIDs[0] == itemGUID
}
