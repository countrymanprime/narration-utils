package editing

import (
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func scopeFor(item tracks.Item) ItemScopeInput {
	identity := evidence.SourceIdentity{Path: "a.wav", Size: 100, PartialHash: "abc"}
	key := evidence.ComputeAnalysisKey(identity, evidence.ItemPlayedRange(item), item.PlayRate)
	return ItemScopeInput{DocumentID: "doc-1", ChapterID: "chapter-1", TrackGUID: "track-1", Item: item, Key: key}
}

func TestCurrentItemRecordNeverWithNoRecord(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	in := scopeFor(itemWith(nil))
	staleness, err := CurrentItemRecord(ledger, AnalyzerSilence, "v1", "params-1", in)
	if err != nil {
		t.Fatalf("CurrentItemRecord() error = %v", err)
	}
	if staleness.State != evidence.StateNever {
		t.Fatalf("CurrentItemRecord() state = %q, want %q", staleness.State, evidence.StateNever)
	}
}

func TestWriteLedgerRecordThenCurrent(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	item := itemWith(nil)
	in := scopeFor(item)
	now := time.Now().UTC()

	if _, err := WriteLedgerRecord(ledger, AnalyzerSilence, "v1", "params-1", in, evidence.LedgerProjectFile{}, now, now, evidence.LedgerComplete, map[string]int{"itemsAnalyzed": 1}); err != nil {
		t.Fatalf("WriteLedgerRecord() error = %v", err)
	}

	staleness, err := CurrentItemRecord(ledger, AnalyzerSilence, "v1", "params-1", in)
	if err != nil {
		t.Fatalf("CurrentItemRecord() error = %v", err)
	}
	if staleness.State != evidence.StateCurrent {
		t.Fatalf("CurrentItemRecord() state = %q, want %q", staleness.State, evidence.StateCurrent)
	}
	if staleness.Record == nil {
		t.Fatalf("CurrentItemRecord() record = nil, want the record just written")
	}
}

// TestWriteLedgerRecordScopesToOneItemOnly proves the item-scoping claim
// this file's header makes: a record written for item A must never answer
// "current" for item B, even when both are in the same chapter and analyzer.
func TestWriteLedgerRecordScopesToOneItemOnly(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	itemA := itemWith(nil)
	itemB := itemWith(func(item *tracks.Item, _ *tracks.Take) { item.GUID = "item-2" })
	inA, inB := scopeFor(itemA), scopeFor(itemB)
	now := time.Now().UTC()

	if _, err := WriteLedgerRecord(ledger, AnalyzerSilence, "v1", "params-1", inA, evidence.LedgerProjectFile{}, now, now, evidence.LedgerComplete, nil); err != nil {
		t.Fatalf("WriteLedgerRecord() error = %v", err)
	}
	staleness, err := CurrentItemRecord(ledger, AnalyzerSilence, "v1", "params-1", inB)
	if err != nil {
		t.Fatalf("CurrentItemRecord() error = %v", err)
	}
	if staleness.State != evidence.StateNever {
		t.Fatalf("CurrentItemRecord() for an unrelated item = %q, want %q (a scan of item A must not cover item B)", staleness.State, evidence.StateNever)
	}
}

// TestCurrentItemRecordStaleAfterMove proves the per-item staleness
// comparison actually tracks edits: moving an item (same audio, new
// Position) must go stale, per the edit-type table (item_moved).
func TestCurrentItemRecordStaleAfterMove(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	item := itemWith(nil)
	in := scopeFor(item)
	now := time.Now().UTC()
	if _, err := WriteLedgerRecord(ledger, AnalyzerSilence, "v1", "params-1", in, evidence.LedgerProjectFile{}, now, now, evidence.LedgerComplete, nil); err != nil {
		t.Fatalf("WriteLedgerRecord() error = %v", err)
	}

	moved := item
	moved.Position = 42
	movedIn := scopeFor(moved)
	staleness, err := CurrentItemRecord(ledger, AnalyzerSilence, "v1", "params-1", movedIn)
	if err != nil {
		t.Fatalf("CurrentItemRecord() error = %v", err)
	}
	if staleness.State != evidence.StateStale {
		t.Fatalf("CurrentItemRecord() after a move = %q, want %q", staleness.State, evidence.StateStale)
	}
}

// TestCurrentItemRecordStaleAfterAnalyzerVersionChange proves the
// validated-detector gate's mechanism (Q5, used by Phase 6): asking with a
// different analyzerVersion than what was recorded must read as stale, so a
// class can be forced back to unknown just by changing what version this
// package reports itself as.
func TestCurrentItemRecordStaleAfterAnalyzerVersionChange(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	item := itemWith(nil)
	in := scopeFor(item)
	now := time.Now().UTC()
	if _, err := WriteLedgerRecord(ledger, AnalyzerSilence, "v1", "params-1", in, evidence.LedgerProjectFile{}, now, now, evidence.LedgerComplete, nil); err != nil {
		t.Fatalf("WriteLedgerRecord() error = %v", err)
	}
	staleness, err := CurrentItemRecord(ledger, AnalyzerSilence, "v2", "params-1", in)
	if err != nil {
		t.Fatalf("CurrentItemRecord() error = %v", err)
	}
	if staleness.State != evidence.StateStale {
		t.Fatalf("CurrentItemRecord() after an analyzer version change = %q, want %q", staleness.State, evidence.StateStale)
	}
}

// TestCurrentItemRecordNeverForPartialOrFailed is the Success Metrics gate
// "a partial or failed run is never read as current" (EL's own rule,
// exercised here at item scope).
func TestCurrentItemRecordNeverForPartialOrFailed(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	item := itemWith(nil)
	in := scopeFor(item)
	now := time.Now().UTC()
	if _, err := WriteLedgerRecord(ledger, AnalyzerSilence, "v1", "params-1", in, evidence.LedgerProjectFile{}, now, now, evidence.LedgerPartial, nil); err != nil {
		t.Fatalf("WriteLedgerRecord() error = %v", err)
	}
	staleness, err := CurrentItemRecord(ledger, AnalyzerSilence, "v1", "params-1", in)
	if err != nil {
		t.Fatalf("CurrentItemRecord() error = %v", err)
	}
	if staleness.State != evidence.StateNever {
		t.Fatalf("CurrentItemRecord() for a partial-only history = %q, want %q", staleness.State, evidence.StateNever)
	}
}
