package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
)

// TestMeasuringAChosenRenderRecordsItForItsChapter is Phase 4 through the host: a render chosen for a chapter, measured
// by the Delivery page's measurement job, becomes a ledger record the chapter's render status reads back; a file that is
// no chapter's render records nothing.
func TestMeasuringAChosenRenderRecordsItForItsChapter(t *testing.T) {
	host := stagesHost(t, 10)
	svc := host.services()
	folder := svc.config.projectFolder
	render, other := filepath.Join(folder, "chapter-one.wav"), filepath.Join(folder, "other.wav")
	writeFile(t, render, "RIFF\x24\x00\x00\x00WAVEfmt the rendered chapter")
	writeFile(t, other, "RIFF\x24\x00\x00\x00WAVEfmt something else")
	documentID := manuscriptDocumentID(svc.manuscript)
	chapter := stages.ChapterContext{DocumentID: documentID, ChapterID: "c-0001", Title: "Chapter One", Status: stages.StageProofing}
	view := svc.coverage.EvidenceView(context.Background(), documentID)
	renders := proofing.NewRenderStore(folder)
	if _, err := proofing.Attest(renders, chapter, view, render, time.Now()); err != nil {
		t.Fatalf("Attest() = %v", err)
	}

	rms := -20.0
	host.jobEvents = func(jobEnded) {}
	host.pickAudioFiles = func() ([]string, error) { return []string{render, other}, nil }
	host.measureFile = func(_ context.Context, path string, _ measure.Options) (measure.FileMeasurement, error) {
		return measure.FileMeasurement{Report: measure.Report{File: path, SampleRate: 44100, Channels: 1, RMSdBFS: &rms}, Fingerprint: measure.Fingerprint{SHA256: "sha-of-" + filepath.Base(path)}}, nil
	}
	if _, err := host.startMeasure(pickAll(t, host)); err != nil {
		t.Fatal(err)
	}
	if job := waitForMeasurement(t, host); job.Phase != "success" {
		t.Fatalf("job = %+v", job)
	}

	records, err := evidence.NewLedgerStore(folder).List(proofing.AnalyzerRenderMeasurement, "")
	if err != nil || len(records) != 1 || records[0].Scope.ChapterID != "c-0001" {
		t.Fatalf("records = %+v, %v; want one, for the chosen render", records, err)
	}
	status, err := proofing.EvaluateRender(renders, chapter, svc.coverage.EvidenceView(context.Background(), documentID))
	if err != nil || status.Measurement == nil || *status.Measurement.Report.RMSdBFS != rms {
		t.Fatalf("status = %+v, %v", status, err)
	}
}

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
