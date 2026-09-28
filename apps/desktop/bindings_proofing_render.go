package main

import (
	"context"
	"errors"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The chapter-to-render association bindings (proofing-readiness-signals.prd.md Phase 6): the narrator chooses which
// rendered file a chapter's delivery checks are about (Q9), and can clear the choice. The checks themselves are read
// through StageRecommendations, which already reads the same proofing.RenderStore (bindings_stages.go's
// proofingProvider); these bindings only let the narrator change what it points at. Measuring the chosen file reuses
// the existing measurement job (MeasureAnalyze/MeasureState in bindings_measure.go): ProofingChooseRender marks the
// picked path measurable the same way MeasurePickFiles does, so Measure needs no second picker, and
// renderMeasurementRecorder (proofing_host.go), already wired into every measurement job, records the result against
// this chapter's association the moment the file finishes.

// errProofingRenderNoProject is the answer of every render-association binding before a project is open.
var errProofingRenderNoProject = errors.New("open a project before choosing a chapter's rendered file")

// ProofingRenderView is a chapter's render association and its latest measurement, as the UI shows it.
type ProofingRenderView struct {
	State  string `json:"state"`
	Cause  string `json:"cause,omitempty"`
	Reason string `json:"reason"`
	// Path and Format are set once an association exists, whatever its state.
	Path       string     `json:"path,omitempty"`
	Format     string     `json:"format,omitempty"`
	AttestedAt *time.Time `json:"attestedAt"`
	// Measurement and MeasuredAt are set only for a current render's own latest measurement; MeasurementFailed says
	// that measurement ended without one (a value nil, NaN or infinite is still a Measurement, never this).
	Measurement       *measure.Report `json:"measurement"`
	MeasuredAt        *time.Time      `json:"measuredAt"`
	MeasurementFailed bool            `json:"measurementFailed"`
}

// proofingRenderViewOf shapes a proofing.RenderStatus for the wire.
func proofingRenderViewOf(status proofing.RenderStatus) ProofingRenderView {
	view := ProofingRenderView{State: string(status.State), Cause: string(status.Cause), Reason: status.Reason, MeasurementFailed: status.MeasurementFailed}
	if status.Association != nil {
		view.Path = status.Association.Path
		view.Format = status.Association.Format
		at := status.Association.AttestedAt
		view.AttestedAt = &at
	}
	if status.Measurement != nil {
		report := status.Measurement.Report
		view.Measurement = &report
		at := status.Measurement.MeasuredAt
		view.MeasuredAt = &at
	}
	return view
}

// proofingRenderChapter builds the render store, chapter context and evidence view a render-association binding
// needs, over the same coverage-parsed saved project every stage signal reads (coverage.Service.EvidenceView), so a
// choice made here is judged consistently the moment the narrator checks again.
func (h *Host) proofingRenderChapter(chapterID string) (*proofing.RenderStore, stages.ChapterContext, stages.EvidenceView, error) {
	svc := h.services()
	if svc.config.projectFolder == "" || svc.manuscript == nil || svc.coverage == nil {
		return nil, stages.ChapterContext{}, stages.EvidenceView{}, errProofingRenderNoProject
	}
	documentID := manuscriptDocumentID(svc.manuscript)
	chapter := stages.ChapterContext{DocumentID: documentID, ChapterID: chapterID}
	view := svc.coverage.EvidenceView(context.Background(), documentID)
	return proofing.NewRenderStore(svc.config.projectFolder), chapter, view, nil
}

// ProofingRenderState reads the chapter's render association and, once it is current, its latest measurement of
// exactly that render. It starts nothing.
func (h *Host) ProofingRenderState(chapterID string) (string, error) {
	store, chapter, view, err := h.proofingRenderChapter(chapterID)
	if err != nil {
		return "", err
	}
	status, err := proofing.EvaluateRender(store, chapter, view)
	if err != nil {
		return "", err
	}
	return encodeBinding(proofingRenderViewOf(status), nil)
}

// ProofingChooseRender opens the native file picker for the chapter's rendered file and, once one is chosen, attests
// it was made from the chapter as the saved project has it now (Q9 A). It answers {status: "cancelled"} when the
// narrator closes the dialog without choosing, {status: "refused", message} when the file could not be read or the
// chapter has no one confirmed track in the saved project, or {status: "ok", render} with the render evaluated again.
func (h *Host) ProofingChooseRender(chapterID string) (string, error) {
	store, chapter, view, err := h.proofingRenderChapter(chapterID)
	if err != nil {
		return "", err
	}
	pick := h.pickRenderFile
	if pick == nil {
		pick = h.openRenderFileDialog
	}
	path, err := pick()
	if err != nil {
		return "", err
	}
	if path == "" {
		return encodeBinding(map[string]any{"status": "cancelled"}, nil)
	}
	if _, err := proofing.Attest(store, chapter, view, path, time.Now()); err != nil {
		return encodeBinding(map[string]any{"status": "refused", "message": err.Error()}, nil)
	}
	// The dialog is this build's own trust boundary for a file the app reads (ADR 0156): once the narrator has chosen
	// it here, Measure may read it too, with no second picker.
	h.markPathMeasurable(path)
	status, err := proofing.EvaluateRender(store, chapter, view)
	if err != nil {
		return "", err
	}
	return encodeBinding(map[string]any{"status": "ok", "render": proofingRenderViewOf(status)}, nil)
}

// ProofingClearRender removes the chapter's render association and answers the render state again (none).
func (h *Host) ProofingClearRender(chapterID string) (string, error) {
	store, chapter, view, err := h.proofingRenderChapter(chapterID)
	if err != nil {
		return "", err
	}
	if err := store.Clear(chapter.DocumentID, chapter.ChapterID); err != nil {
		return "", err
	}
	status, err := proofing.EvaluateRender(store, chapter, view)
	if err != nil {
		return "", err
	}
	return encodeBinding(proofingRenderViewOf(status), nil)
}

// openRenderFileDialog is the real picker: WAV first (the only format Measure can read), but any file, so a wrong
// one is refused by Attest with a reason rather than hidden by the filter.
func (h *Host) openRenderFileDialog() (string, error) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx == nil {
		return "", errHostNotReady
	}
	return pickFile("Choose the chapter's rendered file", []fileFilter{
		{"WAV audio (*.wav)", "*.wav;*.wave"},
		{"All files (*.*)", "*.*"},
	})
}

// markPathMeasurable adds path to the paths MeasureAnalyze accepts this session (measure_job.go's h.measurePicked),
// the same allowlist MeasurePickFiles fills, so choosing a chapter's render here is enough to measure it there too.
func (h *Host) markPathMeasurable(path string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.measurePicked == nil {
		h.measurePicked = map[string]bool{}
	}
	h.measurePicked[filepath.Clean(path)] = true
}
