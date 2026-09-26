package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
)

// TestAFinishedComparisonIsRecordedForItsChapter is Phase 2 through the host: the recorder resolves the run's chapter
// title through the real manuscript, stamps its documentId, reads the run's manifest and writes one ledger record; a
// cancelled run and a title no chapter has write none.
func TestAFinishedComparisonIsRecordedForItsChapter(t *testing.T) {
	host := stagesHost(t, 10)
	svc := host.services()
	folder := svc.config.projectFolder
	manifest := filepath.Join(t.TempDir(), "manifest_run-1.txt")
	if err := os.WriteFile(manifest, []byte("0|"+filepath.Join(folder, "missing.wav")+"|0.000000|12.500000\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	record := comparisonRecorder(folder, svc.manuscript, svc.settings, host.persist)
	at := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	record(transcript.CompletedRun{RunID: "run-1", Outcome: transcript.RunComplete, ManifestPath: manifest, ChapterTitle: "Chapter One", Model: "small", StartedAt: at, CompletedAt: at.Add(time.Minute)})
	record(transcript.CompletedRun{RunID: "run-2", Outcome: "cancelled", ChapterTitle: "Chapter One", StartedAt: at.Add(time.Hour)})
	record(transcript.CompletedRun{RunID: "run-3", Outcome: transcript.RunComplete, ManifestPath: manifest, ChapterTitle: "Not A Chapter", StartedAt: at.Add(2 * time.Hour)})

	records, err := evidence.NewLedgerStore(folder).List(proofing.AnalyzerTranscriptCompare, "")
	if err != nil || len(records) != 1 {
		t.Fatalf("records = %+v, %v; want exactly the one complete run", records, err)
	}
	got := records[0]
	if got.Scope.ChapterID != "c-0001" || got.Scope.DocumentID == "" || got.Scope.DocumentID != manuscriptDocumentID(svc.manuscript) || got.Outcome != evidence.LedgerComplete {
		t.Fatalf("record = %+v", got)
	}
	var payload proofing.ComparisonPayload
	if err := json.Unmarshal(got.Payload, &payload); err != nil || len(payload.Compared) != 1 || payload.Compared[0].Length != 12.5 || payload.Compared[0].Identity != "" {
		t.Fatalf("payload = %+v, %v (a missing source is recorded without an identity)", payload, err)
	}
}
