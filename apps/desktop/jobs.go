package main

import (
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
)

// jobEndedEvent is the one event every host job ends with (ADR 0076). The UI shows the completion from it whatever page the narrator is
// on, and the notification work reads it to decide whether to raise an operating system notification (kind, duration and id are in it).
const jobEndedEvent = "job:ended"

// The kinds of job that end with a jobEndedEvent. They are the words the UI matches on (apps/ui/src/api/contracts/system.ts).
const (
	jobKindStoryBible       = "story_bible"
	jobKindManuscriptImport = "manuscript_import"
	jobKindTtsInstall       = "tts_install"
	jobKindWhisperInstall   = "whisper_install"
	jobKindSpacyInstall     = "spacy_install"
	jobKindMoonshineInstall = "moonshine_install"
	jobKindAppUpdate        = "app_update"
	jobKindTranscript       = "transcript_compare"
	jobKindCoverage         = "recording_coverage"
)

// How a job ended. A job that was cancelled is reported too, so a listener can tell the narrator's own Cancel from a failure.
const (
	jobOutcomeSuccess   = "success"
	jobOutcomeError     = "error"
	jobOutcomeCancelled = "cancelled"
)

// jobEnded is the payload of jobEndedEvent. Message is a sentence for the narrator (the failure text for an error), never a log line.
type jobEnded struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Outcome    string `json:"outcome"`
	Message    string `json:"message"`
	DurationMs int64  `json:"durationMs"`
}

// jobOutcome maps a job's own phase word to how it ended; ok is false for a phase that is not an end.
func jobOutcome(phase string) (outcome string, ok bool) {
	switch phase {
	case "success", updatePhaseReady:
		return jobOutcomeSuccess, true
	case "error":
		return jobOutcomeError, true
	case "cancelled":
		return jobOutcomeCancelled, true
	}
	return "", false
}

// endedJob builds the event for a job that has just ended. It reads nothing but its arguments, so a caller passes values it read under
// the job's own lock and publishes after releasing it.
func endedJob(id, kind, phase, message string, started time.Time) (jobEnded, bool) {
	outcome, ok := jobOutcome(phase)
	if !ok {
		return jobEnded{}, false
	}
	var took time.Duration
	if !started.IsZero() {
		took = time.Since(started)
	}
	return jobEnded{ID: id, Kind: kind, Outcome: outcome, Message: message, DurationMs: took.Milliseconds()}, true
}

// publishJobEnded sends the event. It never holds h.mu while emitting, and before the window exists (or in a test with a sink) it goes to
// the seam or nowhere.
func (h *Host) publishJobEnded(event jobEnded) {
	h.mu.RLock()
	ctx, sink := h.ctx, h.jobEvents
	h.mu.RUnlock()
	if sink != nil {
		sink(event)
		return
	}
	if ctx != nil {
		runtime.EventsEmit(ctx, jobEndedEvent, event)
	}
}

// importJobEnded is the manuscript service's callback: a commit finished, well or badly.
func (h *Host) importJobEnded(job manuscript.ImportJob) {
	if event, ok := endedJob(job.ID, jobKindManuscriptImport, job.Phase, job.Message, time.Now().Add(-time.Duration(job.Elapsed*float64(time.Second)))); ok {
		h.publishJobEnded(event)
	}
}

// transcriptWatch turns the transcript's state changes into one jobEnded per run: it notices the state leaving an active phase for
// success, error or cancelled. The state itself keeps arriving through transcript:state.
type transcriptWatch struct {
	mu      sync.Mutex
	active  bool
	started time.Time
}

// transcriptActive is every phase a comparison is still going through; need_chapter waits for the narrator, so it belongs to the run.
func transcriptActive(phase string) bool {
	switch phase {
	case "preparing", "running", "inspecting", "need_chapter":
		return true
	}
	return false
}

// observe is called with every state the transcript service reports. It returns the event to publish when this state ended a run.
func (w *transcriptWatch) observe(state map[string]any) (jobEnded, bool) {
	phase, _ := state["phase"].(string)
	w.mu.Lock()
	defer w.mu.Unlock()
	if transcriptActive(phase) {
		if !w.active {
			w.active, w.started = true, time.Now()
		}
		return jobEnded{}, false
	}
	if !w.active {
		return jobEnded{}, false
	}
	w.active = false
	id, _ := state["runId"].(string)
	message, _ := state["message"].(string)
	// idle after a reset is not an end: the run was discarded, not finished.
	return endedJob(id, jobKindTranscript, phase, message, w.started)
}
