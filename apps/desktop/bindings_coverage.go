package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The recording coverage bindings (docs/utilities/recording-coverage.md, ADR 0129). A check runs only when the narrator
// asks (Q14): nothing here starts one on its own, and the chapter payload's recordedFraction only reads stored
// results. A running check reports every state change as the "coverage:state" live event and ends with one job:ended
// event (ADR 0076).

// coverageStateEvent is the live event every state change of a check is sent as.
const coverageStateEvent = "coverage:state"

// coverageSettings are the narrator's four recording check settings (Q3) from the layered store. Every check and every
// read takes its alignment from here, so a start and a read cannot disagree; a changed alignment makes older results
// stale (Q13 B), a changed threshold only changes how a result is judged.
func coverageSettings(store *settings.Store) coverage.Settings {
	return coverage.ResolveSettings(func(key string) string {
		value, _ := store.Effective(coverage.SettingsTool, key, "")
		return value
	})
}

// coverageIdle is the state reported when no project (so no coverage service) is open.
var coverageIdle = coverage.State{Phase: coverage.PhaseIdle, Message: "Open a project, save it in REAPER, then check a chapter's recording."}

// CoverageStart starts a recording check of one chapter with the narrator's Transcript Compare model (Q7 A). It
// answers {status: "started", state}; {status: "refused", reason, message} when the chapter cannot be measured as the
// saved project stands (nothing was run or written); or {status: "asset_required", ...} when the model is not
// installed yet (the first-use gate TranscriptStart has). Anything else (a file that could not be written, a sidecar
// that did not start) is a rejected promise.
func (h *Host) CoverageStart(chapterID string) (string, error) {
	return encodeBinding(h.coverageStart(chapterID))
}

func (h *Host) coverageStart(chapterID string) (any, error) {
	svc := h.services()
	if svc.coverage == nil {
		return nil, fmt.Errorf("open a project before checking a recording")
	}
	models := h.registry().whisper
	if models == nil {
		return nil, h.registry().catalogUnavailable("Whisper")
	}
	modelID := resolveWhisperModelID(svc.settings, nil)
	model, knownModel := models.Model(modelID)
	if !knownModel {
		return nil, fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	modelDir, err := models.Dir(modelID)
	if err != nil {
		return modelAssetRequired(model, models.State(model), models.InstallDir(model.ID)), nil
	}
	state, err := svc.coverage.Start(coverage.Request{
		ChapterID:     chapterID,
		Transcription: coverage.Transcription{Model: modelID, ModelDir: modelDir},
		Alignment:     coverageSettings(svc.settings).Alignment,
	})
	if reason, refused := coverage.ReasonOf(err); refused {
		return coverageRefusal(reason, err.Error()), nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": "started", "state": state}, nil
}

// coverageRefusal is the answer to a start that was refused with a typed reason (coverage.RefusalReasons).
func coverageRefusal(reason coverage.Reason, message string) map[string]any {
	return map[string]any{"status": "refused", "reason": string(reason), "message": message}
}

// CoverageState is the current check, or the last one that ended.
func (h *Host) CoverageState() (string, error) {
	if service := h.services().coverage; service != nil {
		return encodeBinding(service.State(), nil)
	}
	return encodeBinding(coverageIdle, nil)
}

// CoverageCancel asks a running check to stop; the items it finished stay cached. With nothing running it does nothing.
func (h *Host) CoverageCancel() (string, error) {
	if service := h.services().coverage; service != nil {
		service.Cancel()
	}
	return encodeBinding(nil, nil)
}

// CoverageResult reads a chapter's newest complete check back and says whether it is current, stale or never, with
// reasons (coverage.ResultView). It never runs anything (Q14).
func (h *Host) CoverageResult(chapterID string) (string, error) {
	svc := h.services()
	service := svc.coverage
	if service == nil {
		return encodeBinding(coverage.ResultView{ChapterID: chapterID, State: evidence.StateNever, Reasons: []string{string(coverage.ReasonNoProject)}}, nil)
	}
	result, err := service.Result(chapterID, coverageSettings(svc.settings).Alignment)
	if err != nil {
		return "", err
	}
	return encodeBinding(result.View(chapterID), nil)
}

// coverageRecordedFractions is the manuscript service's recordedFraction provider: measured fractions of chapters
// with a current, complete check (D11). It is bound to one project's coverage service and settings in configureLocked.
func coverageRecordedFractions(service *coverage.Service, store *settings.Store) func() map[string]float64 {
	return func() map[string]float64 { return service.RecordedFractions(coverageSettings(store).Alignment) }
}

// emitCoverage is the coverage service's state callback: a check that just ended is reported once as a job end, then
// every state goes out as the live event.
func (h *Host) emitCoverage(state coverage.State) {
	if event, ended := h.coverageRuns.observe(state); ended {
		h.publishJobEnded(event)
	}
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil {
		runtime.EventsEmit(ctx, coverageStateEvent, state)
	}
}

// coverageWatch turns a check's states into one jobEnded per run: the first terminal state of a run id ends it.
type coverageWatch struct {
	mu sync.Mutex
	// +checklocks:mu
	ended string
}

// coverageJobPhase maps a check's terminal phase to the job phase words endedJob knows.
func coverageJobPhase(phase coverage.Phase) (string, bool) {
	switch phase {
	case coverage.PhaseComplete:
		return "success", true
	case coverage.PhaseFailed:
		return "error", true
	case coverage.PhaseCancelled:
		return "cancelled", true
	}
	return "", false
}

func (w *coverageWatch) observe(state coverage.State) (jobEnded, bool) {
	phase, terminal := coverageJobPhase(state.Phase)
	if !terminal || state.RunID == "" {
		return jobEnded{}, false
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.ended == state.RunID {
		return jobEnded{}, false
	}
	w.ended = state.RunID
	var started time.Time
	if state.StartedAt != nil {
		started = *state.StartedAt
	}
	return endedJob(state.RunID, jobKindCoverage, phase, state.Message, started)
}
