package editing

import (
	"errors"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

func TestRenderLedgerRoundTrip(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	scan := &RenderScan{DurationSeconds: 12}
	now := time.Now().UTC()
	written, err := WriteRenderRecord(ledger, "doc-1", "chapter-1", "key-a", "/renders/chapter-1.wav", evidence.LedgerProjectFile{}, now, now, evidence.LedgerComplete, scan, nil)
	if err != nil {
		t.Fatalf("WriteRenderRecord() error = %v", err)
	}
	if written.AnalyzerID != AnalyzerEditingRender {
		t.Fatalf("AnalyzerID = %q, want %q", written.AnalyzerID, AnalyzerEditingRender)
	}
	if written.Scope.TrackGUID != "" || len(written.Scope.ItemGUIDs) != 0 {
		t.Fatalf("Scope = %+v, want chapter-wide only (no track or item scope)", written.Scope)
	}

	record, payload, ok, err := CurrentRenderRecord(ledger, "doc-1", "chapter-1", "key-a")
	if err != nil {
		t.Fatalf("CurrentRenderRecord() error = %v", err)
	}
	if !ok {
		t.Fatal("CurrentRenderRecord() ok = false, want a hit for the render key just written")
	}
	if record.ID != written.ID {
		t.Fatalf("record.ID = %q, want %q", record.ID, written.ID)
	}
	if payload.RenderKey != "key-a" || payload.Scan == nil || payload.Scan.DurationSeconds != 12 {
		t.Fatalf("payload = %+v, want the round-tripped scan", payload)
	}
}

// TestRenderLedgerDifferentKeyIsNotCurrent proves the render-changed case:
// a record for one render key is never reported current against a
// different one.
func TestRenderLedgerDifferentKeyIsNotCurrent(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	now := time.Now().UTC()
	if _, err := WriteRenderRecord(ledger, "doc-1", "chapter-1", "key-a", "/renders/chapter-1.wav", evidence.LedgerProjectFile{}, now, now, evidence.LedgerComplete, &RenderScan{}, nil); err != nil {
		t.Fatalf("WriteRenderRecord() error = %v", err)
	}
	_, _, ok, err := CurrentRenderRecord(ledger, "doc-1", "chapter-1", "key-b")
	if err != nil {
		t.Fatalf("CurrentRenderRecord() error = %v", err)
	}
	if ok {
		t.Fatal("CurrentRenderRecord() ok = true for a different render key, want false")
	}
}

// TestRenderLedgerFailedRecordIsNotCurrent: only a complete outcome counts,
// matching the rest of the codebase's own rule (evidence.LedgerComplete is
// the only outcome CurrentItemRecord and EvaluateRender's own measurement
// lookup treat as current).
func TestRenderLedgerFailedRecordIsNotCurrent(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	now := time.Now().UTC()
	if _, err := WriteRenderRecord(ledger, "doc-1", "chapter-1", "key-a", "/renders/chapter-1.wav", evidence.LedgerProjectFile{}, now, now, evidence.LedgerFailed, nil, errors.New("could not read the file")); err != nil {
		t.Fatalf("WriteRenderRecord() error = %v", err)
	}
	_, _, ok, err := CurrentRenderRecord(ledger, "doc-1", "chapter-1", "key-a")
	if err != nil {
		t.Fatalf("CurrentRenderRecord() error = %v", err)
	}
	if ok {
		t.Fatal("CurrentRenderRecord() ok = true for a failed-outcome record, want false")
	}
}

func TestRenderLedgerNeverScannedIsNotCurrent(t *testing.T) {
	ledger := evidence.NewLedgerStore(t.TempDir())
	_, _, ok, err := CurrentRenderRecord(ledger, "doc-1", "chapter-1", "key-a")
	if err != nil {
		t.Fatalf("CurrentRenderRecord() error = %v", err)
	}
	if ok {
		t.Fatal("CurrentRenderRecord() ok = true with no record at all, want false")
	}
}
