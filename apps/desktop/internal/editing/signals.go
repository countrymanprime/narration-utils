// This file is Phase 6 of docs/prds/editing-readiness-analysis.prd.md: the
// three tri-state signals, in the shape chapter-stage-recommendations.prd.md
// defines (apps/desktop/internal/stages). It mirrors
// apps/desktop/internal/coverage/signal.go's own split: a pure decision
// function (EmptySpaceSignal) over an already-gathered ChapterCoverage
// (provider.go does the gathering, reading stored evidence only - Q12: "A
// provider reads existing evidence only... must not decode audio"), so the
// signal rule itself is unit-testable with no file, cache or ledger at all.
package editing

import (
	"fmt"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// EmptySpaceSignalID, ClickSignalID and BreathSignalID are this package's
// three signal ids (the stage recommendations contract's "<stage>.<name>").
const (
	EmptySpaceSignalID = "editing.empty_space"
	ClickSignalID      = "editing.clicks"
	BreathSignalID     = "editing.breaths"
)

// MappingState is what the chapter's confirmed-track mapping (D5) looks
// like, gathered by the provider before anything else is checked: an
// unmapped or multiply-mapped chapter, or one whose mapped track no longer
// exists in the saved project, can never reach met or not_met - there is no
// single track to compose against.
type MappingState string

const (
	MappingOK           MappingState = "ok"
	MappingUnmapped     MappingState = "unmapped"
	MappingMultiple     MappingState = "multiple_tracks"
	MappingTrackMissing MappingState = "mapped_track_missing"
)

// ItemCoverage is one analyzable item's own staleness (EL Phase 6's
// per-item comparison, ledger.go's CurrentItemRecord): never analyzed,
// stale (with typed reasons), or current.
type ItemCoverage struct {
	GUID    string
	State   evidence.EvaluatorState
	Reasons []evidence.EvaluatorReason
}

// ChapterCoverage is everything EmptySpaceSignal needs about one chapter's
// items, gathered by the provider from stored evidence only (never a
// decode): the mapping's own state, each analyzable item's coverage, the
// typed reasons of every item Resolve refused (playrate, format, ...), and
// whether there is at least one analyzable item at all.
type ChapterCoverage struct {
	Mapping            MappingState
	Unconfirmed        bool // an unconfirmed fuzzy match exists (D5); only meaningful when Mapping is MappingUnmapped
	Items              []ItemCoverage
	UnsupportedReasons []UnknownReason
	HasAnalyzableItems bool
}

// CandidateStatus is one composed empty-space candidate's open/closed state
// (D9: dismissed is the only status that is not open).
type CandidateStatus struct {
	Open bool
}

// EmptySpaceInput is everything EmptySpaceSignal reads.
type EmptySpaceInput struct {
	Coverage   ChapterCoverage
	Policy     Policy
	Candidates []CandidateStatus
	Running    bool
	Basis      stages.Basis
	ComputedAt time.Time
}

// EmptySpaceSignal is the pure empty-space signal (D2): met only when the
// mapping is confirmed, every analyzable item's own record is current, no
// item is unsupported, a maximum gap is actually set (Q2), and no open
// candidate remains; not_met when an open candidate remains; unknown, with a
// cause, for everything else. The same input always gives the same signal.
func EmptySpaceSignal(in EmptySpaceInput) stages.Signal {
	signal := stages.Signal{
		ID: EmptySpaceSignalID, Stage: stages.StageEditing, Evidence: []stages.Evidence{},
		Basis: in.Basis, ComputedAt: in.ComputedAt,
	}
	if cause, reason, ok := mappingCause(in.Coverage, in.Unconfirmed()); ok {
		return unknownEditingSignal(signal, cause, reason)
	}
	if in.Running {
		return unknownEditingSignal(signal, stages.CauseAnalysisRunning, "An editing check of this chapter is running.")
	}
	if len(in.Coverage.UnsupportedReasons) > 0 {
		return unknownEditingSignal(signal, stages.CauseMeasurementUnavailable, unsupportedReason(in.Coverage.UnsupportedReasons))
	}
	if !in.Coverage.HasAnalyzableItems {
		return unknownEditingSignal(signal, stages.CauseNeverAnalyzed, "There is no analyzable audio on this chapter's track yet.")
	}
	if cause, reason, ok := itemCoverageCause(in.Coverage.Items); ok {
		return unknownEditingSignal(signal, cause, reason)
	}
	if in.Policy.MaxGapSeconds == nil {
		return unknownEditingSignal(signal, stages.CauseMeasurementUnavailable, "No maximum gap is set. Set one in Editing settings to check empty space.")
	}
	open := 0
	for _, candidate := range in.Candidates {
		if candidate.Open {
			open++
		}
	}
	if open > 0 {
		signal.State, signal.Reason = stages.SignalNotMet, fmt.Sprintf("%d empty-space candidate(s) remain open.", open)
		return signal
	}
	signal.State, signal.Reason = stages.SignalMet, "No open empty-space candidates; every played item was checked at its current state."
	return signal
}

// Unconfirmed is a small adapter so EmptySpaceInput can carry the mapping's
// Unconfirmed flag without a second parameter to EmptySpaceSignal (kept as a
// method for readability at the call site, mappingCause(in.Coverage,
// in.Unconfirmed())).
func (in EmptySpaceInput) Unconfirmed() bool { return in.Coverage.Unconfirmed }

func mappingCause(coverage ChapterCoverage, unconfirmed bool) (stages.UnknownCause, string, bool) {
	switch coverage.Mapping {
	case MappingUnmapped:
		if unconfirmed {
			return stages.CauseUnconfirmedMapping, "A track's name matches this chapter. Confirm the link to check its editing.", true
		}
		return stages.CauseUnmappedTrack, "Link this chapter to the REAPER track it is edited on.", true
	case MappingMultiple:
		return stages.CauseMultipleTracks, "This chapter is linked to more than one REAPER track. Keep one link.", true
	case MappingTrackMissing:
		return stages.CauseUnmappedTrack, "The track this chapter is linked to is no longer in the saved project. Link it again.", true
	}
	return "", "", false
}

// unsupportedReason names the first typed reason an item could not be
// analyzed, so the narrator sees a specific, stable string rather than "some
// items could not be checked."
func unsupportedReason(reasons []UnknownReason) string {
	if len(reasons) == 0 {
		return "An item on this chapter's track could not be analyzed."
	}
	return fmt.Sprintf("An item on this chapter's track could not be analyzed: %s.", reasons[0].Text())
}

// itemCoverageCause reports never/stale across every item's own coverage,
// never first (a chapter that has literally never been checked reads
// "never_analyzed", not "stale" - the same precedence coverage.RecordingSignal
// gives its own never/stale ordering).
func itemCoverageCause(items []ItemCoverage) (stages.UnknownCause, string, bool) {
	for _, item := range items {
		if item.State == evidence.StateNever {
			return stages.CauseNeverAnalyzed, "This chapter's editing has not been checked yet.", true
		}
	}
	var reasons []string
	for _, item := range items {
		if item.State != evidence.StateStale {
			continue
		}
		for _, reason := range item.Reasons {
			text := staleEditingText[reason]
			if text == "" {
				text = string(reason)
			}
			if !containsString(reasons, text) {
				reasons = append(reasons, text)
			}
		}
	}
	if len(reasons) > 0 {
		return stages.CauseStale, "Check again: since the last check " + strings.Join(reasons, ", ") + ".", true
	}
	return "", "", false
}

var staleEditingText = map[evidence.EvaluatorReason]string{
	evidence.ReasonItemAdded:       "audio was added",
	evidence.ReasonItemRemoved:     "audio was removed",
	evidence.ReasonItemTrimmed:     "an item was trimmed",
	evidence.ReasonItemMoved:       "an item was moved",
	evidence.ReasonItemMuted:       "an item was muted or unmuted",
	evidence.ReasonTakeSwitched:    "a different take was chosen",
	evidence.ReasonSourceChanged:   "an audio file changed",
	evidence.ReasonAnalyzerChanged: "the check itself was updated",
	evidence.ReasonParamsChanged:   "the editing check settings changed",
	evidence.ReasonMappingChanged:  "the chapter was linked to another track",
}

func unknownEditingSignal(signal stages.Signal, cause stages.UnknownCause, reason string) stages.Signal {
	signal.State, signal.Cause, signal.Reason = stages.SignalUnknown, cause, reason
	return signal
}

// unvalidatedReason is the fixed reason the click and breath signals always
// give (Q5's D22 default, applied because Phase 4 - the corpus validation
// that would ever populate a "this version is validated" registry - is out
// of this pass's scope, per the parent task's own instruction: "the click
// and breath signals must report unknown... and must NEVER report met - do
// not invent a validated version to make them pass"). validatedAnalyzerVersions
// is deliberately empty, not absent: it documents, in code, that no version
// of this package's click or breath detector has ever been validated on the
// corpus, rather than silently special-casing the two signals with no
// explanation of why.
var validatedAnalyzerVersions = map[string]bool{}

const unvalidatedReason = "This detector has not been validated on a labeled corpus yet (Phase 4 of the editing-readiness-analysis PRD has not run), so it can never say \"done\" - only \"unknown\"."

// IsValidated reports whether analyzerVersion is recorded as validated on
// the corpus (Q5): the actual gate mechanism Phase 4 would populate.
// validatedAnalyzerVersions is empty in this pass (Phase 4, the corpus
// validation run, is out of scope), so this always answers false today -
// but it is a real conditional, not a hardcoded "always unknown" comment,
// so a later Phase 4 landing entries in the map is enough to flip a
// version's own signal, with no change needed here.
func IsValidated(analyzerVersion string) bool { return validatedAnalyzerVersions[analyzerVersion] }

// UnvalidatedSignal answers id (ClickSignalID or BreathSignalID) unknown
// when analyzerVersion is not validated (IsValidated), which is always, in
// this build (validatedAnalyzerVersions is empty - see its own doc comment).
// The parent task's own instruction is exactly this: "the click and breath
// signals must report unknown... and must NEVER report met - do not invent
// a validated version to make them pass." It still carries the click/breath
// findings this package's scan already persists (Phase 5) as evidence, so a
// narrator can see raw candidates even though the signal itself can never
// resolve them from an unvalidated detector.
func UnvalidatedSignal(id, analyzerVersion string, evidenceEntries []stages.Evidence, basis stages.Basis, now time.Time) stages.Signal {
	signal := stages.Signal{ID: id, Stage: stages.StageEditing, Basis: basis, ComputedAt: now, Evidence: []stages.Evidence{}}
	if evidenceEntries != nil {
		signal.Evidence = evidenceEntries
	}
	if !IsValidated(analyzerVersion) {
		return unknownEditingSignal(signal, stages.CauseMeasurementUnavailable, unvalidatedReason)
	}
	// Unreachable while validatedAnalyzerVersions is empty; kept so a future
	// Phase 4 has a real branch to land validated behaviour in, rather than
	// this function needing to be rewritten from an unconditional unknown.
	signal.State, signal.Reason = stages.SignalUnknown, "validated detector output is not yet wired into this signal"
	signal.Cause = stages.CauseProviderError
	return signal
}
