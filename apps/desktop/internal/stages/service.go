package stages

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

var (
	// ErrBasisChanged refuses a Confirm or Dismiss whose basis key is not the
	// one the evidence gives now: the narrator decided on something else.
	ErrBasisChanged = errors.New("the evidence changed while you were looking; check again")
	// ErrNotRecommended refuses a Confirm or Dismiss of a chapter with no
	// suggestion to act on.
	ErrNotRecommended = errors.New("there is no suggestion to act on for this chapter")
	// ErrNothingToRevert refuses a Revert of a chapter with no live
	// confirmation.
	ErrNothingToRevert = errors.New("this chapter has no confirmed suggestion to revert")
)

// Config is what the host gives the service. The manuscript is read through
// functions (manuscript.Service's Load, Chapters and SetChapterStatus) so this
// package does not depend on the manuscript package, which clears the
// decisions file in its resetDerived.
type Config struct {
	// Project is the project folder; the decisions file lives under it.
	Project string
	// LoadManuscript returns the canonical manuscript, read for its documentId.
	LoadManuscript func() (map[string]any, error)
	// Chapters returns the reader's chapters with their stored statuses.
	Chapters func() ([]map[string]any, error)
	// SetChapterStatus is the existing status path Confirm and Revert write through.
	SetChapterStatus func(chapterID string, status Stage) error
	// Providers supply the signals; every declared id is required until the
	// required-check settings exist (Q8).
	Providers []Provider
	// View builds the evidence every provider shares, once per evaluation. Nil
	// gives a view with only the document id and the project folder.
	View func(ctx context.Context, documentID string) EvidenceView
	// Reporter says what happened to a decisions file that cannot be read; may be nil.
	Reporter *persist.Reporter
	// Now stamps decisions; nil is time.Now.
	Now func() time.Time
}

// Confirmation is a chapter's live confirmation: the narrator confirmed From
// to Target, and the status is still Target. EvidenceChanged says the signals
// that justified it no longer give the confirmed basis key; that alone is
// shown quietly and raises no notice (Q10).
type Confirmation struct {
	From            Stage     `json:"from"`
	Target          Stage     `json:"target"`
	BasisKey        string    `json:"basisKey"`
	At              time.Time `json:"at"`
	EvidenceChanged bool      `json:"evidenceChanged"`
}

// Contradiction is the "evidence changed since you confirmed" notice: fresh
// not_met signals of the stage the narrator confirmed as finished. It never
// changes anything; Revert to RevertTo is the narrator's one click.
type Contradiction struct {
	RevertTo Stage    `json:"revertTo"`
	Signals  []Signal `json:"signals"`
}

// ChapterRecommendation is one narration chapter's assessment with its title
// and, while a confirmation is live, the confirmation and any contradiction.
type ChapterRecommendation struct {
	Assessment
	Title         string         `json:"title"`
	Confirmation  *Confirmation  `json:"confirmation,omitempty"`
	Contradiction *Contradiction `json:"contradiction,omitempty"`
}

// Service composes the providers, the engine, the decision store and the
// manuscript's status path. Recommendations are computed on every read and
// never stored (D1, Q5); only Confirm and Revert change a status, and only
// Confirm, Dismiss and Revert write a decision.
type Service struct {
	config Config
	store  *DecisionStore
	mu     sync.Mutex
}

// NewService returns a service over config.
func NewService(config Config) *Service {
	return &Service{config: config, store: NewDecisionStore(config.Project, config.Reporter)}
}

// evaluation is what one read of the project gives every chapter.
type evaluation struct {
	documentID string
	chapters   []ChapterContext
	view       EvidenceView
	decisions  []Decision
}

// Recommendations assesses every narration chapter in manuscript order.
func (s *Service) Recommendations(ctx context.Context) ([]ChapterRecommendation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.read(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]ChapterRecommendation, 0, len(state.chapters))
	for _, chapter := range state.chapters {
		result = append(result, s.assess(ctx, chapter, state.view, state.decisions))
	}
	return result, nil
}

// Confirm sets the chapter's status to target and records the basis, only if
// the current evidence still recommends target with basisKey. The record is
// written first and removed again if the status write fails (a crash between
// the two leaves a record whose target is not the status, which is ignored).
func (s *Service) Confirm(ctx context.Context, chapterID string, target Stage, basisKey string) (ChapterRecommendation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, chapter, current, err := s.current(ctx, chapterID, target, basisKey)
	if err != nil {
		return ChapterRecommendation{}, err
	}
	decision := s.decision(chapterID, DecisionConfirmed, chapter.Status, target, basisKey, current.Signals)
	if err := s.writeThenSetStatus(state.documentID, decision, target); err != nil {
		return ChapterRecommendation{}, err
	}
	chapter.Status = target
	return s.assess(ctx, chapter, state.view, append(state.decisions, decision)), nil
}

// Dismiss hides the chapter's suggestion of target while its basis key stays
// basisKey (Q7). It writes a decision only; the status is untouched.
func (s *Service) Dismiss(ctx context.Context, chapterID string, target Stage, basisKey string) (ChapterRecommendation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, chapter, current, err := s.current(ctx, chapterID, target, basisKey)
	if err != nil {
		return ChapterRecommendation{}, err
	}
	if current.Verdict == VerdictDismissed {
		return current, nil
	}
	decision := s.decision(chapterID, DecisionDismissed, chapter.Status, target, basisKey, current.Signals)
	if err := s.store.Append(state.documentID, decision); err != nil {
		return ChapterRecommendation{}, err
	}
	return s.assess(ctx, chapter, state.view, append(state.decisions, decision)), nil
}

// Revert undoes the chapter's live confirmation: the status returns to the
// stage it was confirmed from, and a reverted record retires the confirmation.
func (s *Service) Revert(ctx context.Context, chapterID string) (ChapterRecommendation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, chapter, err := s.readChapter(ctx, chapterID)
	if err != nil {
		return ChapterRecommendation{}, err
	}
	live, ok := liveConfirmation(state.decisions, chapter)
	if !ok {
		return ChapterRecommendation{}, ErrNothingToRevert
	}
	decision := s.decision(chapterID, DecisionReverted, live.Target, live.From, live.BasisKey, nil)
	if err := s.writeThenSetStatus(state.documentID, decision, live.From); err != nil {
		return ChapterRecommendation{}, err
	}
	chapter.Status = live.From
	return s.assess(ctx, chapter, state.view, append(state.decisions, decision)), nil
}

// current reads the project and assesses chapterID, refusing when the
// suggestion the narrator acted on (target, basisKey) is no longer the one the
// evidence gives, or the chapter has no suggestion to act on.
func (s *Service) current(ctx context.Context, chapterID string, target Stage, basisKey string) (evaluation, ChapterContext, ChapterRecommendation, error) {
	state, chapter, err := s.readChapter(ctx, chapterID)
	if err != nil {
		return evaluation{}, ChapterContext{}, ChapterRecommendation{}, err
	}
	current := s.assess(ctx, chapter, state.view, state.decisions)
	if current.Target != target || current.BasisKey != basisKey {
		return evaluation{}, ChapterContext{}, ChapterRecommendation{}, ErrBasisChanged
	}
	if current.Verdict != VerdictRecommended && current.Verdict != VerdictDismissed {
		return evaluation{}, ChapterContext{}, ChapterRecommendation{}, ErrNotRecommended
	}
	return state, chapter, current, nil
}

// writeThenSetStatus records decision, then sets the status, and takes the
// record back if the status write fails.
func (s *Service) writeThenSetStatus(documentID string, decision Decision, status Stage) error {
	if err := s.store.Append(documentID, decision); err != nil {
		return fmt.Errorf("could not record the decision: %w", err)
	}
	statusErr := s.config.SetChapterStatus(decision.ChapterID, status)
	if statusErr == nil {
		return nil
	}
	statusErr = fmt.Errorf("could not set the chapter status: %w", statusErr)
	if removeErr := s.store.Remove(documentID, decision); removeErr != nil {
		return errors.Join(statusErr, fmt.Errorf("and could not take back the decision record: %w", removeErr))
	}
	return statusErr
}

func (s *Service) decision(chapterID string, kind DecisionKind, from, target Stage, basisKey string, signals []Signal) Decision {
	return Decision{
		ChapterID: chapterID, Kind: kind, From: from, Target: target, BasisKey: basisKey,
		Basis: basisOf(signals), At: s.now(),
	}
}

func (s *Service) now() time.Time {
	if s.config.Now != nil {
		return s.config.Now().UTC()
	}
	return time.Now().UTC()
}
