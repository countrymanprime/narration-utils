package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The chapter-to-render association bindings (proofing-readiness-signals.prd.md Phase 6): ProofingChooseRender opens
// a file dialog (a test-only seam, host.pickRenderFile) and attests the chosen file for the chapter; ProofingRenderState
// reads it back; ProofingClearRender removes it. renderHost reuses stagesHost's coverage project (bindings_stages_test.go):
// chapter c-0001, confirmed to REAPER track {TRACK-1}, in status proofing.

func renderHost(t *testing.T) *Host {
	t.Helper()
	host := stagesHost(t, 10)
	if _, err := host.ManuscriptSetChapterStatus("c-0001", "proofing"); err != nil {
		t.Fatal(err)
	}
	return host
}

// writeRenderFile writes a minimal RIFF/WAVE file under the host's project folder and answers its absolute path.
func writeRenderFile(t *testing.T, host *Host, name string) string {
	t.Helper()
	path := filepath.Join(host.services().config.projectFolder, "media", name)
	if err := os.WriteFile(path, []byte("RIFF\x24\x00\x00\x00WAVEfmt the rendered chapter"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProofingRenderBindingsBeforeAProjectIsOpenFail(t *testing.T) {
	host := NewHost()
	if _, err := host.ProofingRenderState("c-0001"); err == nil {
		t.Fatal("render state with no project must fail")
	}
	if _, err := host.ProofingChooseRender("c-0001"); err == nil {
		t.Fatal("choose render with no project must fail")
	}
	if _, err := host.ProofingClearRender("c-0001"); err == nil {
		t.Fatal("clear render with no project must fail")
	}
}

func TestProofingRenderStateWithNoAssociationIsNone(t *testing.T) {
	host := renderHost(t)
	state := decodeAnswer(t)(host.ProofingRenderState("c-0001"))
	if state["state"] != "none" || state["cause"] != string(stages.CauseNeverAnalyzed) {
		t.Fatalf("state = %v", state)
	}
}

func TestProofingChooseRenderAttestsAndReadsBack(t *testing.T) {
	host := renderHost(t)
	render := writeRenderFile(t, host, "chapter-one.wav")
	host.pickRenderFile = func() (string, error) { return render, nil }

	chosen := decodeAnswer(t)(host.ProofingChooseRender("c-0001"))
	if chosen["status"] != "ok" {
		t.Fatalf("choose = %v", chosen)
	}
	view := chosen["render"].(map[string]any)
	if view["state"] != "current" || view["path"] != render || view["format"] != "wav" || view["attestedAt"] == nil {
		t.Fatalf("render = %v", view)
	}

	again := decodeAnswer(t)(host.ProofingRenderState("c-0001"))
	if again["state"] != "current" || again["path"] != render {
		t.Fatalf("a re-read must see the same association: %v", again)
	}
}

func TestProofingChooseRenderCancelledChangesNothing(t *testing.T) {
	host := renderHost(t)
	host.pickRenderFile = func() (string, error) { return "", nil }

	answer := decodeAnswer(t)(host.ProofingChooseRender("c-0001"))
	if answer["status"] != "cancelled" {
		t.Fatalf("a cancelled dialog = %v", answer)
	}
	state := decodeAnswer(t)(host.ProofingRenderState("c-0001"))
	if state["state"] != "none" {
		t.Fatalf("cancelling must not create an association: %v", state)
	}
}

func TestProofingChooseRenderRefusesAnUnmappedChapter(t *testing.T) {
	host := renderHost(t)
	render := writeRenderFile(t, host, "chapter-one.wav")
	host.pickRenderFile = func() (string, error) { return render, nil }

	answer := decodeAnswer(t)(host.ProofingChooseRender("no-such-chapter"))
	if answer["status"] != "refused" || answer["message"] == "" {
		t.Fatalf("an unmapped chapter must be refused: %v", answer)
	}
	if _, ok := answer["render"]; ok {
		t.Fatal("a refusal carries no render")
	}
}

func TestProofingChooseRenderRefusesAFileThatCannotBeRead(t *testing.T) {
	host := renderHost(t)
	host.pickRenderFile = func() (string, error) { return filepath.Join(t.TempDir(), "missing.wav"), nil }

	answer := decodeAnswer(t)(host.ProofingChooseRender("c-0001"))
	if answer["status"] != "refused" || answer["message"] == "" {
		t.Fatalf("an unreadable file must be refused: %v", answer)
	}
}

func TestProofingClearRenderRemovesTheAssociation(t *testing.T) {
	host := renderHost(t)
	render := writeRenderFile(t, host, "chapter-one.wav")
	host.pickRenderFile = func() (string, error) { return render, nil }
	if chosen := decodeAnswer(t)(host.ProofingChooseRender("c-0001")); chosen["status"] != "ok" {
		t.Fatalf("choose = %v", chosen)
	}

	cleared := decodeAnswer(t)(host.ProofingClearRender("c-0001"))
	if cleared["state"] != "none" {
		t.Fatalf("clear = %v", cleared)
	}
	state := decodeAnswer(t)(host.ProofingRenderState("c-0001"))
	if state["state"] != "none" {
		t.Fatalf("a re-read after clearing must see no association: %v", state)
	}
}

// TestProofingChooseRenderMarksThePathMeasurable: MeasureAnalyze refuses any path that was not chosen through its own
// picker (ADR 0156); choosing a chapter's render here must add it to that same allowlist, so Measure needs no second
// dialog.
func TestProofingChooseRenderMarksThePathMeasurable(t *testing.T) {
	host := renderHost(t)
	render := writeRenderFile(t, host, "chapter-one.wav")
	host.pickRenderFile = func() (string, error) { return render, nil }
	if chosen := decodeAnswer(t)(host.ProofingChooseRender("c-0001")); chosen["status"] != "ok" {
		t.Fatalf("choose = %v", chosen)
	}

	if _, err := host.MeasureAnalyze([]string{render}); err != nil {
		t.Fatalf("MeasureAnalyze must accept the chosen render: %v", err)
	}
	if job := waitForMeasurement(t, host); job.Phase != "success" {
		t.Fatalf("measurement = %+v", job)
	}
}

// TestProofingRenderStaleWhenTheChapterOrTheFileChanges exercises the staleness rules the readiness panel relies on,
// through the host (the rules themselves are proofing.EvaluateRender's own, table-tested in the package).
func TestProofingRenderStaleWhenTheChapterOrTheFileChanges(t *testing.T) {
	host := renderHost(t)
	render := writeRenderFile(t, host, "chapter-one.wav")
	host.pickRenderFile = func() (string, error) { return render, nil }
	if chosen := decodeAnswer(t)(host.ProofingChooseRender("c-0001")); chosen["status"] != "ok" {
		t.Fatalf("choose = %v", chosen)
	}

	// The rendered file changes on disk after it was chosen.
	if err := os.WriteFile(render, []byte("RIFF\x24\x00\x00\x00WAVEfmt a different render"), 0o600); err != nil {
		t.Fatal(err)
	}
	stale := decodeAnswer(t)(host.ProofingRenderState("c-0001"))
	if stale["state"] != "stale" || stale["cause"] != string(stages.CauseStale) {
		t.Fatalf("a changed render file must go stale: %v", stale)
	}
}

// pinProofingRender pins a ProofingRenderView with its paths made portable (a rendered file's absolute path is
// machine-specific) and its timestamp fixed by contractfile.Stabilize.
func pinProofingRender(t *testing.T, name string, folder string, value any) {
	t.Helper()
	stable, err := contractfile.PortablePaths(value, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, name, stable)
}

// TestContractProofingRenderBindings pins every ProofingRenderView shape and the two ProofingChooseRender wrappers
// (cancelled, refused) the UI's schema and mock are built against.
func TestContractProofingRenderBindings(t *testing.T) {
	folder := "C:/Projects/Alice"
	attestedAt := time.Date(2026, 9, 26, 11, 0, 0, 0, time.UTC)
	measuredAt := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	level := func(v float64) *float64 { return &v }

	pinProofingRender(t, "proofing-render-none", folder, proofingRenderViewOf(proofing.RenderStatus{
		State: proofing.RenderNone, Cause: stages.CauseNeverAnalyzed, Reason: "Choose the rendered file for this chapter.",
	}))
	pinProofingRender(t, "proofing-render-current-unmeasured", folder, proofingRenderViewOf(proofing.RenderStatus{
		State: proofing.RenderCurrent,
		Association: &proofing.RenderAssociation{
			Path: folder + "/Renders/Chapter 01.wav", Format: proofing.FormatWAV, AttestedAt: attestedAt,
		},
	}))
	pinProofingRender(t, "proofing-render-current-measured", folder, proofingRenderViewOf(proofing.RenderStatus{
		State: proofing.RenderCurrent,
		Association: &proofing.RenderAssociation{
			Path: folder + "/Renders/Chapter 01.wav", Format: proofing.FormatWAV, AttestedAt: attestedAt,
		},
		Measurement: &proofing.RenderMeasurement{
			RecordID: "record-1", MeasuredAt: measuredAt,
			Report: measure.Report{
				SampleRate: 48000, Channels: 2, DurationSeconds: 1843.5, IntegratedLUFS: level(-19.4), RMSdBFS: level(-21.2),
				SamplePeakdBFS: level(-3.6), TruePeakdBTP: level(-3.1), NoiseFloordBFS: level(-66.8),
			},
		},
	}))
	pinProofingRender(t, "proofing-render-current-measurement-failed", folder, proofingRenderViewOf(proofing.RenderStatus{
		State: proofing.RenderCurrent,
		Association: &proofing.RenderAssociation{
			Path: folder + "/Renders/Chapter 01.wav", Format: proofing.FormatWAV, AttestedAt: attestedAt,
		},
		MeasurementFailed: true,
	}))
	pinProofingRender(t, "proofing-render-stale", folder, proofingRenderViewOf(proofing.RenderStatus{
		State: proofing.RenderStale, Cause: stages.CauseStale,
		Reason: "The rendered file changed since you chose it. Choose it again to say it was made from the chapter as it is now, then measure it.",
		Association: &proofing.RenderAssociation{
			Path: folder + "/Renders/Chapter 01.wav", Format: proofing.FormatWAV, AttestedAt: attestedAt,
		},
	}))
	pinProofingRender(t, "proofing-render-missing", folder, proofingRenderViewOf(proofing.RenderStatus{
		State: proofing.RenderMissing, Cause: stages.CauseMeasurementUnavailable,
		Reason: "The rendered file Chapter 01.wav could not be read. Choose the rendered file again.",
		Association: &proofing.RenderAssociation{
			Path: folder + "/Renders/Chapter 01.wav", Format: proofing.FormatWAV, AttestedAt: attestedAt,
		},
	}))
	pinProofingRender(t, "proofing-render-unsupported", folder, proofingRenderViewOf(proofing.RenderStatus{
		State: proofing.RenderUnsupported, Cause: stages.CauseMeasurementUnavailable,
		Reason: "The rendered file is not a WAV file; only a WAV render is measured. Choose the WAV render the delivered file was made from.",
		Association: &proofing.RenderAssociation{
			Path: folder + "/Renders/Chapter 01.mp3", Format: proofing.FormatMP3, AttestedAt: attestedAt,
		},
	}))
	pinProofingRender(t, "proofing-choose-render-cancelled", folder, map[string]any{"status": "cancelled"})
	pinProofingRender(t, "proofing-choose-render-refused", folder, map[string]any{
		"status": "refused", "message": "Link this chapter to the REAPER track it is recorded on.",
	})
}
