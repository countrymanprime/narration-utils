// Package stages is the chapter stage recommendations core (Phase 1 of
// docs/prds/chapter-stage-recommendations.prd.md): the signal contract the
// recording, editing and proofing signal owners implement, the Provider
// interface they plug in through, and a pure engine that turns a chapter's
// required signals into a verdict. It only suggests: nothing here writes a
// chapter status, stores a recommendation, or starts an analysis (D1). The
// contract is described for implementers in
// docs/architecture/stage-recommendations.md and decided in ADR 0160.
package stages

import (
	"fmt"
	"strings"
	"time"
)

// Stage is a chapter's production stage. The values are exactly the stored
// ChapterStatus strings (apps/desktop/internal/manuscript/reader.go's
// validChapterStatus, apps/ui/src/api/contracts/manuscript.ts): the status
// is the stage (D3), and no new value is added (Q3).
type Stage string

const (
	StageNotStarted Stage = "not_started"
	StageRecording  Stage = "recording"
	StageEditing    Stage = "editing"
	StageProofing   Stage = "proofing"
	StageFinalized  Stage = "finalized"
)

// nextStage is the one-stage advance each narrator rule judges (D3). A stage
// missing from it (not_started, finalized, anything unknown) is never
// evaluated (Q4).
var nextStage = map[Stage]Stage{
	StageRecording: StageEditing,
	StageEditing:   StageProofing,
	StageProofing:  StageFinalized,
}

// Next returns the stage a chapter at s may be recommended for, and false
// when s is not an evaluated stage.
func (s Stage) Next() (Stage, bool) {
	next, ok := nextStage[s]
	return next, ok
}

// SignalState is a signal's tri-state answer (D2). Only met can contribute to
// a recommendation; unknown is never read as met.
type SignalState string

const (
	SignalMet     SignalState = "met"
	SignalNotMet  SignalState = "not_met"
	SignalUnknown SignalState = "unknown"
)

func (s SignalState) valid() bool {
	return s == SignalMet || s == SignalNotMet || s == SignalUnknown
}

// UnknownCause says why a signal is unknown, so the UI can route the action
// that resolves it. It is set only when the state is unknown.
type UnknownCause string

const (
	CauseNeverAnalyzed          UnknownCause = "never_analyzed"
	CauseStale                  UnknownCause = "stale"
	CauseIncompleteRun          UnknownCause = "incomplete_run"
	CauseAnalysisRunning        UnknownCause = "analysis_running"
	CauseUnmappedTrack          UnknownCause = "unmapped_track"
	CauseUnconfirmedMapping     UnknownCause = "unconfirmed_mapping"
	CauseMultipleTracks         UnknownCause = "multiple_tracks"
	CauseMeasurementUnavailable UnknownCause = "measurement_unavailable"
	CauseProjectUnreadable      UnknownCause = "project_unreadable"
	CauseProviderError          UnknownCause = "provider_error"
)

var knownCauses = map[UnknownCause]bool{
	CauseNeverAnalyzed:          true,
	CauseStale:                  true,
	CauseIncompleteRun:          true,
	CauseAnalysisRunning:        true,
	CauseUnmappedTrack:          true,
	CauseUnconfirmedMapping:     true,
	CauseMultipleTracks:         true,
	CauseMeasurementUnavailable: true,
	CauseProjectUnreadable:      true,
	CauseProviderError:          true,
}

// TimeRange is a span of source audio in seconds, relative to the source
// file (the findings contract's source-relative offsets).
type TimeRange struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// Evidence is one typed fact behind a signal. Kind is owned by the signal
// (for example "coverage" or "region" for the recording signal); Label and
// Value are what the evidence view shows; File, Range and ParagraphIDs are
// set where they apply so the UI can link to the audio or the text.
// FindingID, when set, is the findings-store id the entry is about (the
// proofing pickups roll-up lists each open item by it, so the UI can open it
// on the Review page).
type Evidence struct {
	Kind         string     `json:"kind"`
	Label        string     `json:"label"`
	Value        string     `json:"value"`
	File         string     `json:"file,omitempty"`
	Range        *TimeRange `json:"range,omitempty"`
	ParagraphIDs []string   `json:"paragraphIds,omitempty"`
	FindingID    string     `json:"findingId,omitempty"`
}

// Basis is what a signal was computed from. The engine treats every field as
// opaque (D6): LedgerRecordIDs are the analysis evidence ledger records read,
// Fingerprint is the chapter fingerprint they were compared at, and
// ProjectFileModTime is the saved project's modified time, shown to the
// narrator but excluded from the basis key.
type Basis struct {
	LedgerRecordIDs    []string  `json:"ledgerRecordIds"`
	Fingerprint        string    `json:"fingerprint"`
	ProjectFileModTime time.Time `json:"projectFileModTime"`
}

// Signal is one required check's answer for one chapter. ID is
// "<stage>.<name>" (owned by the signal's PRD), Stage is the chapter's
// current stage the signal judges as finished, Reason is a short human
// string, and Cause is set only when State is unknown.
type Signal struct {
	ID         string       `json:"id"`
	Stage      Stage        `json:"stage"`
	State      SignalState  `json:"state"`
	Reason     string       `json:"reason"`
	Cause      UnknownCause `json:"cause,omitempty"`
	Evidence   []Evidence   `json:"evidence"`
	Basis      Basis        `json:"basis"`
	ComputedAt time.Time    `json:"computedAt"`
}

// Validate reports whether s honours the contract: an ID prefixed by its own
// evaluated stage, a known state, and a cause exactly when the state is
// unknown. The engine replaces an invalid signal with an unknown one
// (CauseProviderError) rather than trusting it.
func (s Signal) Validate() error {
	if _, ok := s.Stage.Next(); !ok {
		return fmt.Errorf("signal %q: stage %q is not an evaluated stage", s.ID, s.Stage)
	}
	name, ok := strings.CutPrefix(s.ID, string(s.Stage)+".")
	if !ok || name == "" {
		return fmt.Errorf("signal %q: id must be %q followed by a name", s.ID, string(s.Stage)+".")
	}
	if !s.State.valid() {
		return fmt.Errorf("signal %q: unknown state %q", s.ID, s.State)
	}
	if s.State == SignalUnknown && !knownCauses[s.Cause] {
		return fmt.Errorf("signal %q: an unknown signal needs a known cause, got %q", s.ID, s.Cause)
	}
	if s.State != SignalUnknown && s.Cause != "" {
		return fmt.Errorf("signal %q: cause %q is only allowed on an unknown signal", s.ID, s.Cause)
	}
	return nil
}

// UnknownSignal builds a contract-valid unknown signal with no evidence, the
// shape the engine and Collect use when a provider fails, and a convenience
// for providers answering an unknown case.
func UnknownSignal(id string, stage Stage, cause UnknownCause, reason string) Signal {
	return Signal{
		ID:       id,
		Stage:    stage,
		State:    SignalUnknown,
		Reason:   reason,
		Cause:    cause,
		Evidence: []Evidence{},
		Basis:    Basis{LedgerRecordIDs: []string{}},
	}
}
