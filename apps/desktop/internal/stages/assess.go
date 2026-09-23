package stages

import (
	"context"
	"errors"
	"fmt"
)

// read loads what one evaluation needs: the manuscript's document id, its
// narration chapters with their statuses, the shared evidence view and the
// decisions kept for this document. A decisions file that cannot be read is an
// error, never an empty list.
func (s *Service) read(ctx context.Context) (evaluation, error) {
	canonical, err := s.config.LoadManuscript()
	if err != nil {
		return evaluation{}, fmt.Errorf("could not read the manuscript: %w", err)
	}
	documentID, _ := canonical["documentId"].(string)
	if documentID == "" {
		return evaluation{}, errors.New("import a manuscript before checking chapter stages")
	}
	payloads, err := s.config.Chapters()
	if err != nil {
		return evaluation{}, fmt.Errorf("could not read the chapters: %w", err)
	}
	decisions, err := s.store.List(documentID)
	if err != nil {
		return evaluation{}, err
	}
	return evaluation{
		documentID: documentID,
		chapters:   narrationChapters(documentID, payloads),
		view:       s.view(ctx, documentID),
		decisions:  decisions,
	}, nil
}

func (s *Service) view(ctx context.Context, documentID string) EvidenceView {
	if s.config.View != nil {
		return s.config.View(ctx, documentID)
	}
	return EvidenceView{DocumentID: documentID, ProjectFolder: s.config.Project}
}

// narrationChapters keeps the chapters the Home breakdown lists: narration,
// where a chapter with no content kind is narration.
func narrationChapters(documentID string, payloads []map[string]any) []ChapterContext {
	chapters := make([]ChapterContext, 0, len(payloads))
	for _, payload := range payloads {
		if kind, _ := payload["contentKind"].(string); kind != "" && kind != "narration" {
			continue
		}
		id, _ := payload["id"].(string)
		title, _ := payload["title"].(string)
		status, _ := payload["status"].(string)
		chapters = append(chapters, ChapterContext{DocumentID: documentID, ChapterID: id, Title: title, Status: Stage(status)})
	}
	return chapters
}

// readChapter reads the project and finds chapterID among its narration
// chapters.
func (s *Service) readChapter(ctx context.Context, chapterID string) (evaluation, ChapterContext, error) {
	state, err := s.read(ctx)
	if err != nil {
		return evaluation{}, ChapterContext{}, err
	}
	for _, chapter := range state.chapters {
		if chapter.ChapterID == chapterID {
			return state, chapter, nil
		}
	}
	return evaluation{}, ChapterContext{}, fmt.Errorf("chapter %s is not a narration chapter of the manuscript", chapterID)
}

// assess evaluates chapter's current stage and, while a confirmation is live,
// re-evaluates the stage it confirmed as finished to find a contradiction.
func (s *Service) assess(ctx context.Context, chapter ChapterContext, view EvidenceView, decisions []Decision) ChapterRecommendation {
	target, _ := chapter.Status.Next()
	assessment := Evaluate(Input{
		Chapter:            chapter,
		Required:           DeclaredSignalIDs(s.config.Providers, chapter.Status),
		Signals:            Collect(ctx, s.config.Providers, chapter, view),
		DismissedBasisKeys: dismissedKeys(decisions, chapter.ChapterID, target),
	})
	recommendation := ChapterRecommendation{Assessment: assessment, Title: chapter.Title}
	live, ok := liveConfirmation(decisions, chapter)
	if !ok {
		return recommendation
	}
	confirmed := chapter
	confirmed.Status = live.From
	// No dismissals here: only the signals and the basis key are read, never the verdict.
	previous := Evaluate(Input{
		Chapter:  confirmed,
		Required: DeclaredSignalIDs(s.config.Providers, live.From),
		Signals:  Collect(ctx, s.config.Providers, confirmed, view),
	})
	confirmation := live
	confirmation.EvidenceChanged = previous.BasisKey != live.BasisKey
	recommendation.Confirmation = &confirmation
	if notMet := notMetSignals(previous.Signals); len(notMet) > 0 {
		recommendation.Contradiction = &Contradiction{RevertTo: live.From, Signals: notMet}
	}
	return recommendation
}

// liveConfirmation is the chapter's latest confirmed or reverted decision when
// it is a confirmation whose target is the chapter's status now. A manual
// status change, a revert, or a crash before the status was written all leave
// it not live, without a write.
func liveConfirmation(decisions []Decision, chapter ChapterContext) (Confirmation, bool) {
	for i := len(decisions) - 1; i >= 0; i-- {
		decision := decisions[i]
		if decision.ChapterID != chapter.ChapterID || decision.Kind == DecisionDismissed {
			continue
		}
		if decision.Kind != DecisionConfirmed || decision.Target != chapter.Status {
			return Confirmation{}, false
		}
		return Confirmation{From: decision.From, Target: decision.Target, BasisKey: decision.BasisKey, At: decision.At}, true
	}
	return Confirmation{}, false
}

func dismissedKeys(decisions []Decision, chapterID string, target Stage) []string {
	keys := []string{}
	for _, decision := range decisions {
		if decision.Kind == DecisionDismissed && decision.ChapterID == chapterID && decision.Target == target {
			keys = append(keys, decision.BasisKey)
		}
	}
	return keys
}

func notMetSignals(signals []Signal) []Signal {
	notMet := []Signal{}
	for _, signal := range signals {
		if signal.State == SignalNotMet {
			notMet = append(notMet, signal)
		}
	}
	return notMet
}

// basisOf is what a decision records of each signal: the basis key's inputs
// and the reason as a short summary.
func basisOf(signals []Signal) []SignalBasis {
	basis := make([]SignalBasis, 0, len(signals))
	for _, signal := range signals {
		basis = append(basis, SignalBasis{
			ID:              signal.ID,
			State:           signal.State,
			LedgerRecordIDs: distinctSorted(signal.Basis.LedgerRecordIDs),
			Fingerprint:     signal.Basis.Fingerprint,
			Summary:         signal.Reason,
		})
	}
	return basis
}
