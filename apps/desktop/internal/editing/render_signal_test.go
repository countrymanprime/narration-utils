package editing

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// renderTestService is newTestService's own fixture (a two-item track
// confirmed to chapter-1 of doc-1) with a proofing.RenderStore and this
// package's own ChoiceStore wired into Config, over the same project
// directory - the render-choice path's own equivalent of newTestService.
func renderTestService(t *testing.T) (*testService, *proofing.RenderStore, *ChoiceStore) {
	t.Helper()
	svc := newTestService(t)
	renders := proofing.NewRenderStore(svc.dir)
	choices := NewChoiceStore(svc.dir)
	svc.Service = New(Config{
		Project: svc.dir, ProjectFile: func() (string, error) { return svc.rppPath, nil },
		Renders: renders, Choices: choices,
	}, nil)
	return svc, renders, choices
}

func chapter() stages.ChapterContext {
	return stages.ChapterContext{DocumentID: "doc-1", ChapterID: "chapter-1", Title: "Chapter One", Status: stages.StageEditing}
}

// writeRenderFixture writes a whole-file render WAV with one detectable
// click, mirroring TestDecodeRenderFindsAKnownClick's own fixture
// (measure/cleanup_test.go's TestCleanupFindsAClickInsideSilence shape).
func writeRenderFixture(t *testing.T, dir string) string {
	t.Helper()
	speechHalf := toneSamples(renderTestRate, 1, 180, -14)
	room := roomToneSamples(renderTestRate, 1.5, -65, 21)
	at := int(0.7 * renderTestRate)
	for i := range 88 {
		room[at+i] = 0.5
	}
	samples := concatSamples(speechHalf, room, speechHalf)
	renderDir := filepath.Join(dir, "renders")
	if err := os.MkdirAll(renderDir, 0o755); err != nil {
		t.Fatalf("mkdir renders: %v", err)
	}
	path := filepath.Join(renderDir, "chapter-one.wav")
	if err := os.WriteFile(path, encodeWAV16(t, 1, renderTestRate, samples), 0o600); err != nil {
		t.Fatalf("writing render fixture: %v", err)
	}
	return path
}

// runRenderScan runs a render-choice Start()/Wait() to completion, having
// already set the chapter's choice to SourceRender and attested renderPath.
func runRenderScan(t *testing.T, svc *testService) {
	t.Helper()
	if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	if got := svc.State().Phase; got != PhaseComplete {
		t.Fatalf("render scan phase = %q, want %q (message: %s)", got, PhaseComplete, svc.State().Message)
	}
}

// TestRenderPathReportsAKnownClick is Phase 8's own success signal (a): "A
// render with a known click reports it." The click signal must stay unknown
// (Q5 - never met, Phase 4 has not run) but its evidence must name the click.
func TestRenderPathReportsAKnownClick(t *testing.T) {
	svc, renders, choices := renderTestService(t)
	renderPath := writeRenderFixture(t, svc.dir)
	if _, err := proofing.Attest(renders, chapter(), evidenceView(svc), renderPath, time.Now()); err != nil {
		t.Fatalf("Attest() error = %v", err)
	}
	if err := choices.Set("doc-1", "chapter-1", SourceRender); err != nil {
		t.Fatalf("choices.Set() error = %v", err)
	}
	runRenderScan(t, svc)

	provider := NewSignalProvider(svc.Service)
	signals, err := provider.Signals(context.Background(), chapter(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	var click stages.Signal
	for _, signal := range signals {
		if signal.ID == ClickSignalID {
			click = signal
		}
	}
	if click.State != stages.SignalUnknown {
		t.Fatalf("click signal state = %q, want %q (never met, Q5)", click.State, stages.SignalUnknown)
	}
	var sawCandidate, sawSource bool
	for _, entry := range click.Evidence {
		if entry.Kind == "candidate" {
			sawCandidate = true
		}
		if entry.Kind == "source" && entry.Value == "the rendered file (FX and edits included)" {
			sawSource = true
		}
	}
	if !sawCandidate {
		t.Fatalf("click signal evidence = %+v, want a candidate entry for the known click", click.Evidence)
	}
	if !sawSource {
		t.Fatalf("click signal evidence = %+v, want a source-naming entry for the render", click.Evidence)
	}
}

// TestSwitchingSourceChoiceChangesTheEmptySpaceSignal is Phase 8's own
// success signal (b): "switching the chosen source changes the signal and
// the evidence names the source." The fixture's two items sit 3 s apart (as
// TestServiceFindsEmptySpace already relies on), well past a 1 s maximum
// gap, so the items path reads not_met; the render fixture has no such gap,
// so once scanned it reads met, and each source's own evidence names itself.
func TestSwitchingSourceChoiceChangesTheEmptySpaceSignal(t *testing.T) {
	svc, renders, choices := renderTestService(t)
	tightGap := 1.0
	svc.config.Policy = func() Policy { return Policy{MaxGapSeconds: &tightGap} }

	// Items path first (the default - no choice set yet).
	if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("items Start() error = %v", err)
	}
	svc.Wait()
	provider := NewSignalProvider(svc.Service)
	itemsSignals, err := provider.Signals(context.Background(), chapter(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	itemsEmptySpace := signalByID(itemsSignals, EmptySpaceSignalID)
	if itemsEmptySpace.State != stages.SignalNotMet {
		t.Fatalf("items empty-space state = %q, want %q (reason: %s)", itemsEmptySpace.State, stages.SignalNotMet, itemsEmptySpace.Reason)
	}
	if !hasSourceEvidence(itemsEmptySpace, "items on the chapter's track") {
		t.Fatalf("items empty-space evidence = %+v, want it to name the items source", itemsEmptySpace.Evidence)
	}

	// Now switch to the render source and scan it: a clean fixture, no gap
	// past the (unrelated, items-only) 3 s track gap - the render's own
	// timeline is just its own 3.5 s of near-continuous audio.
	renderPath := writeRenderFixture(t, svc.dir)
	if _, err := proofing.Attest(renders, chapter(), evidenceView(svc), renderPath, time.Now()); err != nil {
		t.Fatalf("Attest() error = %v", err)
	}
	if err := choices.Set("doc-1", "chapter-1", SourceRender); err != nil {
		t.Fatalf("choices.Set() error = %v", err)
	}
	runRenderScan(t, svc)
	renderSignals, err := provider.Signals(context.Background(), chapter(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	renderEmptySpace := signalByID(renderSignals, EmptySpaceSignalID)
	if renderEmptySpace.State == stages.SignalNotMet && renderEmptySpace.Reason == itemsEmptySpace.Reason {
		t.Fatalf("switching source did not change the signal: items=%+v render=%+v", itemsEmptySpace, renderEmptySpace)
	}
	if !hasSourceEvidence(renderEmptySpace, "the rendered file (FX and edits included)") {
		t.Fatalf("render empty-space evidence = %+v, want it to name the rendered-file source", renderEmptySpace.Evidence)
	}
}

// TestRenderStaleAfterALaterItemEditIsUnknown is Phase 8's own success
// signal (c): "a render older than the last item edit is stale." Attesting
// the render, then trimming an item afterward, makes
// proofing.EvaluateRender's own status RenderStale; the render-choice
// empty-space signal must read unknown with a stale cause, never met or
// not_met from evidence that might no longer be true.
func TestRenderStaleAfterALaterItemEditIsUnknown(t *testing.T) {
	svc, renders, choices := renderTestService(t)
	renderPath := writeRenderFixture(t, svc.dir)
	if _, err := proofing.Attest(renders, chapter(), evidenceView(svc), renderPath, time.Now()); err != nil {
		t.Fatalf("Attest() error = %v", err)
	}
	if err := choices.Set("doc-1", "chapter-1", SourceRender); err != nil {
		t.Fatalf("choices.Set() error = %v", err)
	}
	runRenderScan(t, svc)

	// Edit an item after attestation (mirrors
	// TestServiceTrimOneItemRedecodesOnlyThatItem's own approach: rewrite the
	// saved project with a shorter LENGTH for item A).
	trimmedA := svc.track.Items[0]
	trimmedA.Length = 1
	if err := os.WriteFile(svc.rppPath, []byte(minimalRPP(trimmedA, svc.track.Items[1])), 0o600); err != nil {
		t.Fatalf("rewriting project.rpp: %v", err)
	}

	status, err := proofing.EvaluateRender(renders, chapter(), evidenceView(svc))
	if err != nil {
		t.Fatalf("EvaluateRender() error = %v", err)
	}
	if status.State != proofing.RenderStale {
		t.Fatalf("render status = %+v, want RenderStale after the later item edit", status)
	}

	provider := NewSignalProvider(svc.Service)
	signals, err := provider.Signals(context.Background(), chapter(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	emptySpace := signalByID(signals, EmptySpaceSignalID)
	if emptySpace.State != stages.SignalUnknown || emptySpace.Cause != stages.CauseStale {
		t.Fatalf("empty-space signal = %+v, want unknown/stale", emptySpace)
	}
}

func signalByID(signals []stages.Signal, id string) stages.Signal {
	for _, signal := range signals {
		if signal.ID == id {
			return signal
		}
	}
	return stages.Signal{}
}

func hasSourceEvidence(signal stages.Signal, value string) bool {
	for _, entry := range signal.Evidence {
		if entry.Kind == "source" && entry.Value == value {
			return true
		}
	}
	return false
}
