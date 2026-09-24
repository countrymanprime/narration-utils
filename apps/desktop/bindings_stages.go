package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The chapter stage recommendation bindings (docs/prds/chapter-stage-recommendations.prd.md Phase 4,
// docs/architecture/stage-recommendations.md). StageRecommendations only reads: it computes every narration chapter's
// verdict from the evidence as it stands and never stores it or starts an analysis (D1, Q5, Q12). Only StageConfirm and
// StageRevert change a chapter status, and only when the narrator clicks.

// stageRefusal is why a Confirm, Dismiss or Revert changed nothing: the UI re-checks on basis_changed and says so on the
// other two. Any other failure (a file that could not be read or written) is a rejected promise.
type stageRefusal string

const (
	stageRefusalBasisChanged    stageRefusal = "basis_changed"
	stageRefusalNotRecommended  stageRefusal = "not_recommended"
	stageRefusalNothingToRevert stageRefusal = "nothing_to_revert"
)

// stageRefusals maps the service's refusals to their wire reason.
var stageRefusals = map[error]stageRefusal{
	stages.ErrBasisChanged:    stageRefusalBasisChanged,
	stages.ErrNotRecommended:  stageRefusalNotRecommended,
	stages.ErrNothingToRevert: stageRefusalNothingToRevert,
}

// errStagesNoProject is the answer of every stage binding before a project is open.
var errStagesNoProject = errors.New("open a project before checking chapter stages")

// stageRecommendations is the StageRecommendations answer: every narration chapter in manuscript order.
type stageRecommendations struct {
	Chapters []stages.ChapterRecommendation `json:"chapters"`
}

// StageRecommendations assesses every narration chapter of the manuscript. It reads stored evidence only.
func (h *Host) StageRecommendations() (string, error) {
	service := h.services().stages
	if service == nil {
		return "", errStagesNoProject
	}
	chapters, err := service.Recommendations(context.Background())
	if err != nil {
		return "", err
	}
	return encodeBinding(stageRecommendations{Chapters: chapters}, nil)
}

// StageConfirm sets the chapter's status to target and records the basis the narrator saw, if basisKey is still the one
// the evidence gives. It answers {status: "ok", chapter} or {status: "refused", reason, message}.
func (h *Host) StageConfirm(chapterID, target, basisKey string) (string, error) {
	return h.stageDecision(func(ctx context.Context, service *stages.Service) (stages.ChapterRecommendation, error) {
		return service.Confirm(ctx, chapterID, stages.Stage(target), basisKey)
	})
}

// StageDismiss hides the chapter's suggestion of target until its basis changes (Q7); the status is untouched.
func (h *Host) StageDismiss(chapterID, target, basisKey string) (string, error) {
	return h.stageDecision(func(ctx context.Context, service *stages.Service) (stages.ChapterRecommendation, error) {
		return service.Dismiss(ctx, chapterID, stages.Stage(target), basisKey)
	})
}

// StageRevert returns a chapter with a live confirmation to the stage it was confirmed from.
func (h *Host) StageRevert(chapterID string) (string, error) {
	return h.stageDecision(func(ctx context.Context, service *stages.Service) (stages.ChapterRecommendation, error) {
		return service.Revert(ctx, chapterID)
	})
}

func (h *Host) stageDecision(decide func(context.Context, *stages.Service) (stages.ChapterRecommendation, error)) (string, error) {
	service := h.services().stages
	if service == nil {
		return "", errStagesNoProject
	}
	chapter, err := decide(context.Background(), service)
	for refusal, reason := range stageRefusals {
		if errors.Is(err, refusal) {
			return encodeBinding(map[string]any{"status": "refused", "reason": string(reason), "message": err.Error()}, nil)
		}
	}
	if err != nil {
		return "", err
	}
	return encodeBinding(map[string]any{"status": "ok", "chapter": chapter}, nil)
}

// stagesService builds one project's stage recommendation service in configureLocked: the manuscript's status path, the
// recording signal over the coverage service, and the coverage service's shared evidence view. unavailable says why a
// recording check cannot be run here now, read at evaluation time.
func stagesService(project string, text *manuscript.Service, checks *coverage.Service, store *settings.Store, unavailable func() string, reporter *persist.Reporter) *stages.Service {
	return stages.NewService(stages.Config{
		Project:        project,
		LoadManuscript: text.Load,
		Chapters:       text.ChaptersUnmeasured,
		SetChapterStatus: func(chapterID string, status stages.Stage) error {
			_, err := text.SetChapterStatus(chapterID, string(status))
			return err
		},
		Providers: []stages.Provider{coverage.NewSignalProvider(checks, coverage.SignalSources{
			Settings:    func() coverage.Settings { return coverageSettings(store) },
			Unavailable: unavailable,
		})},
		View:     checks.EvidenceView,
		Reporter: reporter,
	})
}

// coverageUnavailable says why a recording check could not be started here now, "" when one could: the same gates
// CoverageStart has before it launches anything (the sidecar and the narrator's Whisper model).
func (h *Host) coverageUnavailable(comparePython string, store *settings.Store) func() string {
	return func() string {
		if comparePython == "" {
			return "the Transcript Compare sidecar is not set up"
		}
		models := h.registry().whisper
		if models == nil {
			return "the Whisper model catalog is not available"
		}
		model, known := models.Model(resolveWhisperModelID(store, nil))
		if !known {
			return "the selected Whisper model is not in the approved catalog"
		}
		if _, err := models.Dir(model.ID); err != nil {
			return fmt.Sprintf("the Whisper model %s is not installed", model.DisplayName)
		}
		return ""
	}
}
