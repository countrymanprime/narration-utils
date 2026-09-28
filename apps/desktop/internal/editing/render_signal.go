// This file is Phase 8 of docs/prds/editing-readiness-analysis.prd.md: the
// render-sourced signal and evidence (Q6). It mirrors signals.go's own
// item-path shape - a pure decision function over already-gathered input, no
// decode, no store access - but judges the chapter's rendered file instead:
// proofing.EvaluateRender (proofing-readiness-signals.prd.md Phase 4) owns
// whether the render is still the chapter's own, current association; this
// file adds only the second, editing-specific question of whether this
// package has actually scanned that exact file (RenderScanState).
package editing

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// RenderScanState is this package's own currency check for a render scan,
// layered on top of proofing's own render-association staleness:
// proofing.RenderCurrent only means "this is still the chapter's render"; it
// says nothing about whether editing's own DecodeRender has ever run over
// that exact file. RenderScanNever/RenderScanStale both read as
// editing.empty_space's own "unknown", with different causes and reasons
// (RenderEmptySpaceSignal below), exactly the never/stale distinction
// ledger.go's ItemStaleness already makes for the item path.
type RenderScanState string

const (
	RenderScanNever   RenderScanState = "never"
	RenderScanStale   RenderScanState = "stale"
	RenderScanCurrent RenderScanState = "current"
)

// renderAudible turns one whole-file RenderScan into the single synthetic
// ItemAudible ComposeEmptySpace (empty_space.go) needs: the render's whole
// duration is both its PlayedRange and its timeline Extent - there is no
// item position for a render, no played-range offset either - and its
// silence runs map straight across to timeline time since source time
// equals timeline time here (Phase 8 Scope: "no played range, no
// composition").
func renderAudible(path string, scan RenderScan) ItemAudible {
	audible := ItemAudible{
		File:        path,
		PlayedRange: PlayedRange{Start: 0, End: scan.DurationSeconds},
		Extent:      TimelineInterval{Start: 0, End: scan.DurationSeconds},
	}
	for _, region := range scan.Silences {
		audible.Silences = append(audible.Silences, TimelineInterval{Start: region.StartSeconds, End: region.EndSeconds})
	}
	return audible
}

// ComposeRenderEmptySpace runs the existing, already-tested ComposeEmptySpace
// (empty_space.go) over exactly one synthetic item: the whole render. Feeding
// it a single-item slice is deliberate, not a shortcut: with one item there
// are no cross-item gaps to compose, so head/gap/tail classification
// degenerates for free to "head and tail of the one file, no internal gaps
// possible" - satisfying Phase 8's "no composition" scope by construction,
// while reusing the tested composition code instead of a second, parallel
// implementation.
func ComposeRenderEmptySpace(path string, scan RenderScan, policy Policy) ([]EmptySpaceCandidate, bool) {
	return ComposeEmptySpace([]ItemAudible{renderAudible(path, scan)}, policy)
}

// RenderEmptySpaceInput is everything RenderEmptySpaceSignal reads.
type RenderEmptySpaceInput struct {
	Render     proofing.RenderStatus
	ScanState  RenderScanState
	Policy     Policy
	Candidates []CandidateStatus
	Running    bool
	Basis      stages.Basis
	ComputedAt time.Time
}

// RenderEmptySpaceSignal is Q6's render-sourced empty-space signal: the same
// tri-state rule EmptySpaceSignal (signals.go) applies (D2), judged against
// the chapter's rendered file instead of its items. It defers first to
// in.Render (proofing.EvaluateRender's own answer): a render that is not
// RenderCurrent - none, missing, stale or an unsupported format - reads
// unknown with that status's own Cause and Reason, verbatim, never a new
// cause text invented here (the same four causes
// apps/desktop/bindings_proofing_render.go's proofingRenderViewOf already
// surfaces for the exact same status to the render-association UI). Only once
// the render itself is current does this package's own ScanState matter.
func RenderEmptySpaceSignal(in RenderEmptySpaceInput) stages.Signal {
	signal := stages.Signal{
		ID: EmptySpaceSignalID, Stage: stages.StageEditing,
		Evidence: []stages.Evidence{processedAudioCaveat(), renderSourceEvidence()},
		Basis:    in.Basis, ComputedAt: in.ComputedAt,
	}
	if in.Render.State != proofing.RenderCurrent {
		return unknownEditingSignal(signal, in.Render.Cause, in.Render.Reason)
	}
	if in.Running {
		return unknownEditingSignal(signal, stages.CauseAnalysisRunning, "An editing check of the rendered file is running.")
	}
	switch in.ScanState {
	case RenderScanNever:
		return unknownEditingSignal(signal, stages.CauseNeverAnalyzed, "This chapter's render has not been checked yet.")
	case RenderScanStale:
		return unknownEditingSignal(signal, stages.CauseStale, "The rendered file was checked, but the render changed since - check it again.")
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
		signal.State, signal.Reason = stages.SignalNotMet, fmt.Sprintf("%d empty-space candidate(s) remain open in the rendered file.", open)
		return signal
	}
	signal.State, signal.Reason = stages.SignalMet, "No open empty-space candidates in the rendered file at its current state."
	return signal
}

// RenderClickBreathEvidence builds the render path's own evidence entries for
// the click or breath UnvalidatedSignal call: the source-naming entry every
// render-sourced signal carries, plus one "candidate" entry per matching
// measure.CleanupCandidate from the render's own decode, in the same shape
// provider.go's findingEvidence builds for the item path's findings. This
// package never persists a separate click/breath finding for either source
// (provider.go's own gatherCandidates has the same gap for items - Phase 4,
// which would validate these detectors, has not run); reading the raw
// candidates straight from the render's own ledger payload is enough to
// satisfy Phase 8's success signal ("a render with a known click reports
// it") without a store round-trip that would have nothing to add yet.
func RenderClickBreathEvidence(path string, candidates []measure.CleanupCandidate, class measure.CleanupClass) []stages.Evidence {
	evidenceEntries := []stages.Evidence{renderSourceEvidence()}
	for _, candidate := range candidates {
		if candidate.Class != class {
			continue
		}
		evidenceEntries = append(evidenceEntries, stages.Evidence{
			Kind: "candidate", Label: "Candidate", File: path,
			Range: &stages.TimeRange{Start: candidate.StartSeconds, End: candidate.EndSeconds},
			Value: candidate.Why,
		})
	}
	return evidenceEntries
}
