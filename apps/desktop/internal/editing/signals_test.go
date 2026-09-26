package editing

import (
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

func baseCoverage() ChapterCoverage {
	return ChapterCoverage{
		Mapping: MappingOK, HasAnalyzableItems: true,
		Items: []ItemCoverage{{GUID: "item-1", State: evidence.StateCurrent}},
	}
}

func baseInput() EmptySpaceInput {
	return EmptySpaceInput{Coverage: baseCoverage(), Policy: Policy{MaxGapSeconds: sec(2)}, ComputedAt: time.Now().UTC()}
}

// TestEmptySpaceSignalMet is the one path that reaches met: mapped, every
// item current, a maximum gap set, no open candidate.
func TestEmptySpaceSignalMet(t *testing.T) {
	signal := EmptySpaceSignal(baseInput())
	if signal.State != stages.SignalMet {
		t.Fatalf("State = %q, want %q (reason: %s, cause: %s)", signal.State, stages.SignalMet, signal.Reason, signal.Cause)
	}
	if err := signal.Validate(); err != nil {
		t.Fatalf("signal failed Validate(): %v", err)
	}
}

func TestEmptySpaceSignalNotMetWithOpenCandidate(t *testing.T) {
	in := baseInput()
	in.Candidates = []CandidateStatus{{Open: true}, {Open: false}}
	signal := EmptySpaceSignal(in)
	if signal.State != stages.SignalNotMet {
		t.Fatalf("State = %q, want %q", signal.State, stages.SignalNotMet)
	}
}

func TestEmptySpaceSignalMetWithOnlyDismissedCandidates(t *testing.T) {
	in := baseInput()
	in.Candidates = []CandidateStatus{{Open: false}, {Open: false}}
	signal := EmptySpaceSignal(in)
	if signal.State != stages.SignalMet {
		t.Fatalf("State = %q, want %q (every candidate dismissed, D9)", signal.State, stages.SignalMet)
	}
}

// TestEmptySpaceSignalNeverMetFromUncoveredInput is the Success Metrics
// gate: "Unknown is never met: 100% of unmapped, never-run, stale, partial,
// failed, unsupported-format, missing-file, playrate-not-1 and
// unvalidated-detector inputs yield unknown."
func TestEmptySpaceSignalNeverMetFromUncoveredInput(t *testing.T) {
	cases := map[string]func(*EmptySpaceInput){
		"unmapped": func(in *EmptySpaceInput) { in.Coverage.Mapping = MappingUnmapped },
		"unmapped, unconfirmed suggestion": func(in *EmptySpaceInput) {
			in.Coverage.Mapping, in.Coverage.Unconfirmed = MappingUnmapped, true
		},
		"multiple tracks":       func(in *EmptySpaceInput) { in.Coverage.Mapping = MappingMultiple },
		"mapped track missing":  func(in *EmptySpaceInput) { in.Coverage.Mapping = MappingTrackMissing },
		"analysis running":      func(in *EmptySpaceInput) { in.Running = true },
		"unsupported: playrate": func(in *EmptySpaceInput) { in.Coverage.UnsupportedReasons = []UnknownReason{ReasonPlayRateNotOne} },
		"unsupported: format":   func(in *EmptySpaceInput) { in.Coverage.UnsupportedReasons = []UnknownReason{ReasonUnsupportedFormat} },
		"unsupported: missing file": func(in *EmptySpaceInput) {
			in.Coverage.UnsupportedReasons = []UnknownReason{ReasonMissingFile}
		},
		"no analyzable items": func(in *EmptySpaceInput) {
			in.Coverage.HasAnalyzableItems, in.Coverage.Items = false, nil
		},
		"never analyzed": func(in *EmptySpaceInput) {
			in.Coverage.Items = []ItemCoverage{{GUID: "item-1", State: evidence.StateNever}}
		},
		"stale": func(in *EmptySpaceInput) {
			in.Coverage.Items = []ItemCoverage{{GUID: "item-1", State: evidence.StateStale, Reasons: []evidence.EvaluatorReason{evidence.ReasonItemMoved}}}
		},
		"no maximum gap set": func(in *EmptySpaceInput) { in.Policy = Policy{} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			in := baseInput()
			mutate(&in)
			signal := EmptySpaceSignal(in)
			if signal.State != stages.SignalUnknown {
				t.Fatalf("State = %q, want %q (reason: %s)", signal.State, stages.SignalUnknown, signal.Reason)
			}
			if signal.Cause == "" {
				t.Fatalf("an unknown signal has no Cause")
			}
			if err := signal.Validate(); err != nil {
				t.Fatalf("signal failed Validate(): %v", err)
			}
		})
	}
}

// TestEmptySpaceSignalStaleEvenWithOpenCandidates proves precedence: stale
// coverage must never be shadowed by an apparently-open candidate list, and
// must never resolve to not_met from evidence that might no longer be true.
func TestEmptySpaceSignalStaleEvenWithOpenCandidates(t *testing.T) {
	in := baseInput()
	in.Coverage.Items = []ItemCoverage{{GUID: "item-1", State: evidence.StateStale, Reasons: []evidence.EvaluatorReason{evidence.ReasonItemTrimmed}}}
	in.Candidates = []CandidateStatus{{Open: true}}
	signal := EmptySpaceSignal(in)
	if signal.State != stages.SignalUnknown || signal.Cause != stages.CauseStale {
		t.Fatalf("State=%q Cause=%q, want unknown/stale (stale coverage must win over any candidate list)", signal.State, signal.Cause)
	}
}

// TestUnvalidatedSignalNeverMet is this pass's own required property: the
// click and breath signals can never be met, whatever they carry as
// evidence, because validatedAnalyzerVersions is empty (Phase 4 not run).
func TestUnvalidatedSignalNeverMet(t *testing.T) {
	for _, id := range []string{ClickSignalID, BreathSignalID} {
		signal := UnvalidatedSignal(id, AnalyzerVersion, nil, stages.Basis{LedgerRecordIDs: []string{}}, time.Now().UTC())
		if signal.State == stages.SignalMet {
			t.Fatalf("UnvalidatedSignal(%s) = met, want never met", id)
		}
		if signal.State != stages.SignalUnknown {
			t.Fatalf("UnvalidatedSignal(%s) state = %q, want %q", id, signal.State, stages.SignalUnknown)
		}
		if err := signal.Validate(); err != nil {
			t.Fatalf("signal failed Validate(): %v", err)
		}
	}
}

func TestIsValidatedAlwaysFalseInThisBuild(t *testing.T) {
	if IsValidated(AnalyzerVersion) {
		t.Fatalf("IsValidated(%q) = true; Phase 4 has not run, no version should ever validate", AnalyzerVersion)
	}
	if IsValidated("anything-else") {
		t.Fatalf("IsValidated of an arbitrary string = true, want false")
	}
}

// TestEmptySpaceSignalNeverMetProperty is a small property test over random
// combinations of uncovered inputs (Success Metrics: "a property test finds
// no path from unknown or stale input to met"): whenever any uncovered
// condition holds, the signal must never be met.
func TestEmptySpaceSignalNeverMetProperty(t *testing.T) {
	mappings := []MappingState{MappingOK, MappingUnmapped, MappingMultiple, MappingTrackMissing}
	states := []evidence.EvaluatorState{evidence.StateCurrent, evidence.StateStale, evidence.StateNever}
	policies := []Policy{{MaxGapSeconds: sec(1)}, {}}
	for _, mapping := range mappings {
		for _, state := range states {
			for _, policy := range policies {
				for _, running := range []bool{false, true} {
					in := EmptySpaceInput{
						Coverage: ChapterCoverage{
							Mapping: mapping, HasAnalyzableItems: true,
							Items: []ItemCoverage{{GUID: "item-1", State: state, Reasons: []evidence.EvaluatorReason{evidence.ReasonItemMoved}}},
						},
						Policy: policy, Running: running, ComputedAt: time.Now().UTC(),
					}
					uncovered := mapping != MappingOK || state != evidence.StateCurrent || policy.MaxGapSeconds == nil || running
					signal := EmptySpaceSignal(in)
					if uncovered && signal.State == stages.SignalMet {
						t.Fatalf("met from uncovered input: mapping=%v state=%v policy=%+v running=%v", mapping, state, policy, running)
					}
				}
			}
		}
	}
}
