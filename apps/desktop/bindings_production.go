package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/production"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The Production page's bindings (docs/prds/production-tracking.prd.md Phase 4). ProductionOverview only reads: the
// chapters and their measured recorded time from the manuscript, each chapter's readiness from the stage
// recommendations (read live, Q8 A), and the time log. ProductionStartTimer and ProductionStopTimer are the only two
// paths that write a session (PRD success metric "Timer honesty"), and only when the narrator clicks. None of them
// writes a chapter status.

// errProductionNoProject is the answer of every production binding before a project is open.
var errProductionNoProject = errors.New("open a project before tracking production time")

// ProductionOverview is the Production page's board, KPI figures and "Next up" list.
func (h *Host) ProductionOverview() (string, error) {
	svc := h.services()
	if svc.production == nil || svc.manuscript == nil {
		return "", errProductionNoProject
	}
	chapters, err := productionChapters(svc.manuscript, svc.stages)
	if err != nil {
		return "", err
	}
	sessions, err := svc.production.Sessions()
	if err != nil {
		return "", err
	}
	return encodeBinding(production.BuildOverview(production.OverviewInput{
		Chapters: chapters,
		Sessions: sessions,
		Plan:     productionPlan(),
		Now:      time.Now(),
	}), nil)
}

// ProductionStartTimer starts a timer on chapterID's stage. It answers {status: "started", session}, or
// {status: "refused", reason: "timer_running", message} while another timer runs; any other failure is a rejected
// promise.
func (h *Host) ProductionStartTimer(chapterID, stage string) (string, error) {
	svc := h.services()
	if svc.production == nil || svc.manuscript == nil {
		return "", errProductionNoProject
	}
	chapters, err := svc.manuscript.ChaptersUnmeasured()
	if err != nil {
		return "", err
	}
	if !hasChapter(chapters, chapterID) {
		return "", fmt.Errorf("the manuscript has no chapter %q", chapterID)
	}
	session, err := svc.production.Start(chapterID, stages.Stage(stage))
	if errors.Is(err, production.ErrTimerRunning) {
		return encodeBinding(map[string]any{"status": "refused", "reason": "timer_running", "message": err.Error()}, nil)
	}
	if err != nil {
		return "", err
	}
	return encodeBinding(map[string]any{"status": "started", "session": session}, nil)
}

// ProductionStopTimer stops the running timer. It answers {stopped: true, session} with the session it logged, or
// {stopped: false, session: null} when no timer was running.
func (h *Host) ProductionStopTimer() (string, error) {
	svc := h.services()
	if svc.production == nil {
		return "", errProductionNoProject
	}
	session, stopped, err := svc.production.Stop()
	if err != nil {
		return "", err
	}
	if !stopped {
		return encodeBinding(map[string]any{"stopped": false, "session": nil}, nil)
	}
	return encodeBinding(map[string]any{"stopped": true, "session": session}, nil)
}

// productionPlan is the book's deadline and contracted amount. They live on the project manifest from Phase 3 of the
// PRD, which has not landed: until it does the plan is empty, so the deadline is not shown and the effective rate is
// undefined ("—"), never guessed.
func productionPlan() production.Plan {
	return production.Plan{}
}

// productionRecorded is the production service's Recorded port over the manuscript's chapter list: each chapter's
// measured recorded seconds (recordedlengths.go, the confirmed track's RecordedSeconds), and nothing for a chapter
// whose length is unavailable.
func productionRecorded(text *manuscript.Service) production.Recorded {
	return func() (map[string]float64, error) {
		chapters, err := text.Chapters()
		if err != nil {
			return nil, err
		}
		recorded := map[string]float64{}
		for _, chapter := range chapters {
			id, _ := chapter["id"].(string)
			if seconds, ok := chapter["recordedSeconds"].(float64); ok && id != "" {
				recorded[id] = seconds
			}
		}
		return recorded, nil
	}
}

// productionChapters reads the manuscript's chapters with their measured recorded time, and each one's readiness from
// the stage recommendations. A stage service that is missing or cannot answer leaves every readiness nil (shown as
// unknown on the board) rather than failing the whole page.
func productionChapters(text *manuscript.Service, recommendations *stages.Service) ([]production.ChapterInput, error) {
	chapters, err := text.Chapters()
	if err != nil {
		return nil, err
	}
	readiness := map[string]*production.Readiness{}
	if recommendations != nil {
		if assessed, err := recommendations.Recommendations(context.Background()); err == nil {
			for _, chapter := range assessed {
				readiness[chapter.ChapterID] = readinessOf(chapter.Assessment)
			}
		}
	}
	inputs := make([]production.ChapterInput, 0, len(chapters))
	for _, chapter := range chapters {
		id, _ := chapter["id"].(string)
		title, _ := chapter["title"].(string)
		subtitle, _ := chapter["subtitle"].(string)
		kind, _ := chapter["contentKind"].(string)
		status, _ := chapter["status"].(string)
		input := production.ChapterInput{
			ID:          id,
			Title:       title,
			Subtitle:    subtitle,
			ContentKind: kind,
			Status:      stages.Stage(status),
			WordCount:   wordCount(chapter["wordCount"]),
			Readiness:   readiness[id],
		}
		if seconds, ok := chapter["recordedSeconds"].(float64); ok {
			input.RecordedSeconds = &seconds
		}
		input.RecordedUnavailable, _ = chapter["recordedUnavailable"].(string)
		inputs = append(inputs, input)
	}
	return inputs, nil
}

// readinessOf is an assessment's verdict and the reason of its first signal that holds the stage back, or, with none,
// its first unknown one.
func readinessOf(assessment stages.Assessment) *production.Readiness {
	readiness := &production.Readiness{Verdict: assessment.Verdict, Target: assessment.Target}
	for _, want := range []stages.SignalState{stages.SignalNotMet, stages.SignalUnknown} {
		for _, signal := range assessment.Signals {
			if signal.State == want && readiness.Reason == "" {
				readiness.Reason = signal.Reason
			}
		}
	}
	return readiness
}

func hasChapter(chapters []map[string]any, id string) bool {
	for _, chapter := range chapters {
		if chapter["id"] == id {
			return true
		}
	}
	return false
}

// wordCount reads a chapter's word count whether the manuscript stored it as a JSON number or it came from a fixture
// as a Go int.
func wordCount(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	}
	return 0
}
