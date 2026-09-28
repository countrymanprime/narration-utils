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
// (D9: dismissed is the only status that is not open) and, for an open one,
// the evidence entry a narrator would see for it (chapter-stage-
// recommendations.prd.md Phase 7: "evidence lists remaining candidates -
// time range, class, confidence and reason").
type CandidateStatus struct {
	Open     bool
	Evidence stages.Evidence
}

// processedAudioCaveat is chapter-stage-recommendations.prd.md Phase 7's own
// evidence entry, carried on every editing signal regardless of its state:
// this package analyzes the source audio (editing-readiness-analysis.prd.md
// Architecture Notes), so what REAPER's take FX, item gain and fades apply
// at playback can differ from what a candidate here reports.
func processedAudioCaveat() stages.Evidence {
	return stages.Evidence{Kind: "caveat", Label: "Caveat", Value: "Analysis of source audio; take FX, item gain and fades are not applied."}
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
		ID: EmptySpaceSignalID, Stage: stages.StageEditing, Evidence: []stages.Evidence{processedAudioCaveat()},
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
			signal.Evidence = append(signal.Evidence, candidate.Evidence)
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
