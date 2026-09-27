package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/production"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// Production plan bindings (production-tracking.prd.md Phase 3, Q3 A, Q5 A): the book's deadline, contracted amount
// and milestones, stored on the project manifest beside Credits so they survive Replace manuscript and Clear derived
// data. Each answers the whole plan (production.Plan), so the page never merges a partial answer into what it holds.

// ProductionPlan reads this project's deadline, contracted amount and milestones. A project that has set none answers
// an empty plan: no deadline, no amount, no milestones.
func (h *Host) ProductionPlan() (string, error) {
	projectFolder := h.services().config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before reading its deadline and milestones")
	}
	manifest, _, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	return encodeBinding(production.PlanOf(manifest), nil)
}

// ProductionSetDeadline sets the book's delivery date ("YYYY-MM-DD"; empty clears it) and contracted amount (a number
// of zero or more in the narrator's own currency; nil clears it). An invalid date or amount is refused and nothing is
// written.
func (h *Host) ProductionSetDeadline(deadline string, contractedAmount *float64) (string, error) {
	if deadline != "" {
		checked, err := production.CheckDate(deadline)
		if err != nil {
			return "", fmt.Errorf("the deadline: %w", err)
		}
		deadline = checked
	}
	if err := production.CheckAmount(contractedAmount); err != nil {
		return "", err
	}
	return h.saveProductionPlan("the deadline", func(manifest *project.Manifest) {
		manifest.Deadline = deadline
		manifest.ContractedAmount = nil
		if contractedAmount != nil {
			amount := *contractedAmount
			manifest.ContractedAmount = &amount
		}
	})
}

// ProductionSaveMilestones replaces the book's milestones with milestones, in the narrator's order. Each needs a name
// and a real date ("YYYY-MM-DD"); a note is optional. A list with any invalid milestone is refused whole and nothing
// is written.
func (h *Host) ProductionSaveMilestones(milestones []project.Milestone) (string, error) {
	cleaned, err := production.CleanMilestones(milestones)
	if err != nil {
		return "", err
	}
	return h.saveProductionPlan("the milestones", func(manifest *project.Manifest) {
		manifest.Milestones = cleaned
		if len(cleaned) == 0 {
			manifest.Milestones = nil
		}
	})
}

// saveProductionPlan loads the manifest (a fresh one for a project that has none yet), applies change, saves it and
// answers the whole plan.
func (h *Host) saveProductionPlan(what string, change func(*project.Manifest)) (string, error) {
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before setting %s", what)
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil {
		manifest = project.New(svc.config.projectName, time.Now())
	}
	change(manifest)
	if err := manifest.Save(projectFolder); err != nil {
		return "", fmt.Errorf("could not save %s: %w", what, err)
	}
	return encodeBinding(production.PlanOf(manifest), nil)
}

// The Production page's bindings (docs/prds/production-tracking.prd.md Phase 4). ProductionOverview only reads: the
// chapters and their measured recorded time from the manuscript, each chapter's readiness from the stage
// recommendations (read live, Q8 A), and the time log. ProductionStartTimer and ProductionStopTimer are the only two
// paths that write a session (PRD success metric "Timer honesty"), and only when the narrator clicks. None of them
// writes a chapter status.

// errProductionNoProject is the answer of every production binding before a project is open.
var errProductionNoProject = errors.New("open a project before tracking production time")

// ProductionOverview is the Production page's board, KPI figures and "Next up" list.
func (h *Host) ProductionOverview() (string, error) {
	overview, _, err := h.buildProductionOverview()
	if err != nil {
		return "", err
	}
	return encodeBinding(overview, nil)
}

// buildProductionOverview is ProductionOverview's own build, shared with the status report export (Phase 5) so the
// two never drift: the report is exactly the figures the page just showed. It also answers the plan's milestones,
// which Overview does not carry (only the deadline).
func (h *Host) buildProductionOverview() (production.Overview, []project.Milestone, error) {
	svc := h.services()
	if svc.production == nil || svc.manuscript == nil {
		return production.Overview{}, nil, errProductionNoProject
	}
	chapters, err := productionChapters(svc.manuscript, svc.stages)
	if err != nil {
		return production.Overview{}, nil, err
	}
	sessions, err := svc.production.Sessions()
	if err != nil {
		return production.Overview{}, nil, err
	}
	// The deadline and contracted amount the narrator set (Phase 3, ProductionSetDeadline); an unreadable manifest is an
	// error, never read as "none set".
	manifest, _, err := project.Load(h.persist, svc.config.projectFolder)
	if err != nil {
		return production.Overview{}, nil, fmt.Errorf("could not read the project manifest: %w", err)
	}
	plan := production.PlanOf(manifest)
	overview := production.BuildOverview(production.OverviewInput{
		Chapters: chapters,
		Sessions: sessions,
		Plan:     plan,
		Now:      time.Now(),
	})
	return overview, plan.Milestones, nil
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
