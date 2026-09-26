package proofing

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

var rollupNow = time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)

func item(id string, status findings.Status) PickupItem {
	return PickupItem{FindingID: id, Category: findings.CategoryTranscriptDiscrepancy, Status: status, Text: "a line"}
}

func absentItem(id string, status findings.Status, resolvedByRun bool) PickupItem {
	it := item(id, status)
	it.NotInLatestRun, it.ResolvedByRun = true, resolvedByRun
	return it
}

func compareSource(run RunStatus, items ...PickupItem) SourceReport {
	return SourceReport{Analyzer: AnalyzerTranscriptCompare, Label: "Transcript Compare", Tracked: true, Run: run, Items: items}
}

func takeReviewSource(items ...PickupItem) SourceReport {
	return SourceReport{Analyzer: AnalyzerTakeReview, Label: "Take review", Run: RunStatus{State: RunUntracked}, Items: items}
}

var (
	runCurrent    = RunStatus{State: RunCurrent, RecordIDs: []string{"rec-1"}, At: rollupNow.Add(-time.Hour)}
	runNever      = RunStatus{State: RunNever}
	runStale      = RunStatus{State: RunUnknown, Cause: stages.CauseStale, Reason: "Re-run Transcript Compare: an item was trimmed since the last comparison."}
	runPartial    = RunStatus{State: RunUnknown, Cause: stages.CauseIncompleteRun, Reason: "Compare every item on the chapter track."}
	runFailed     = RunStatus{State: RunUnknown, Cause: stages.CauseIncompleteRun, Reason: "The last comparison did not finish."}
	runUnmapped   = RunStatus{State: RunUnknown, Cause: stages.CauseUnmappedTrack, Reason: "Link this chapter to its REAPER track."}
	runUnreadable = RunStatus{State: RunUnknown, Cause: stages.CauseProjectUnreadable, Reason: "The saved project could not be read."}
)

// TestPickupsSignalMatrix is the Success Metrics row "False done ... 0": every
// source state crossed with the review states D9 (Q2) names, and the answer
// the roll-up rule in the Architecture Notes gives. A case whose want is met is
// one of the few that may be met; every other case asserts it is not.
func TestPickupsSignalMatrix(t *testing.T) {
	cases := []struct {
		name      string
		sources   []SourceReport
		want      stages.SignalState
		wantCause stages.UnknownCause
	}{
		{"no source at all is unknown, never met", nil, stages.SignalUnknown, stages.CauseNeverAnalyzed},
		{"compare never ran", []SourceReport{compareSource(runNever)}, stages.SignalUnknown, stages.CauseNeverAnalyzed},
		{"compare current with zero findings is met", []SourceReport{compareSource(runCurrent)}, stages.SignalMet, ""},
		{"compare current, only dismissed", []SourceReport{compareSource(runCurrent, item("a", findings.StatusDismissed))}, stages.SignalMet, ""},
		{"compare current, unreviewed open", []SourceReport{compareSource(runCurrent, item("a", findings.StatusUnreviewed))}, stages.SignalNotMet, ""},
		{"compare current, accepted is open (D9)", []SourceReport{compareSource(runCurrent, item("a", findings.StatusAccepted))}, stages.SignalNotMet, ""},
		{"compare current, deferred is open (D9)", []SourceReport{compareSource(runCurrent, item("a", findings.StatusDeferred))}, stages.SignalNotMet, ""},
		{"compare stale, zero open", []SourceReport{compareSource(runStale)}, stages.SignalUnknown, stages.CauseStale},
		{"compare stale, only dismissed", []SourceReport{compareSource(runStale, item("a", findings.StatusDismissed))}, stages.SignalUnknown, stages.CauseStale},
		{"compare stale, open item is still not_met", []SourceReport{compareSource(runStale, item("a", findings.StatusUnreviewed))}, stages.SignalNotMet, ""},
		{"compare partial, zero open", []SourceReport{compareSource(runPartial)}, stages.SignalUnknown, stages.CauseIncompleteRun},
		{"compare failed, zero open", []SourceReport{compareSource(runFailed)}, stages.SignalUnknown, stages.CauseIncompleteRun},
		{"compare unmapped", []SourceReport{compareSource(runUnmapped)}, stages.SignalUnknown, stages.CauseUnmappedTrack},
		{"project unreadable", []SourceReport{compareSource(runUnreadable)}, stages.SignalUnknown, stages.CauseProjectUnreadable},
		{"compare results without a run record cannot vouch", []SourceReport{compareSource(runNever, item("a", findings.StatusDismissed))}, stages.SignalUnknown, stages.CauseStale},
		{"absent finding resolved by a covering complete run", []SourceReport{compareSource(runCurrent, absentItem("a", findings.StatusUnreviewed, true))}, stages.SignalMet, ""},
		{"absent finding not covered by the run stays open", []SourceReport{compareSource(runCurrent, absentItem("a", findings.StatusUnreviewed, false))}, stages.SignalNotMet, ""},
		{"absent dismissed finding is not open", []SourceReport{compareSource(runCurrent, absentItem("a", findings.StatusDismissed, false))}, stages.SignalMet, ""},
		{"take review alone never vouches", []SourceReport{takeReviewSource()}, stages.SignalUnknown, stages.CauseNeverAnalyzed},
		{"take review dismissed only, compare current", []SourceReport{compareSource(runCurrent), takeReviewSource(item("t", findings.StatusDismissed))}, stages.SignalMet, ""},
		{"take review open blocks a current compare", []SourceReport{compareSource(runCurrent), takeReviewSource(item("t", findings.StatusDeferred))}, stages.SignalNotMet, ""},
		{"stale compare blocks even with a clean take review", []SourceReport{compareSource(runStale), takeReviewSource()}, stages.SignalUnknown, stages.CauseStale},
		{"not_met outranks unknown", []SourceReport{compareSource(runStale), takeReviewSource(item("t", findings.StatusUnreviewed))}, stages.SignalNotMet, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			signal := PickupsSignal(PickupsInput{Sources: tc.sources, ComputedAt: rollupNow})
			if err := signal.Validate(); err != nil {
				t.Fatalf("Validate() = %v", err)
			}
			if signal.State != tc.want {
				t.Fatalf("state = %q (%s), want %q", signal.State, signal.Reason, tc.want)
			}
			if signal.Cause != tc.wantCause {
				t.Fatalf("cause = %q, want %q", signal.Cause, tc.wantCause)
			}
			if signal.Reason == "" {
				t.Fatal("every signal carries a reason")
			}
		})
	}
}

// TestPickupsSignalUnknownCausePriority: when several sources are unknown the
// cause names the one whose action unblocks the rest first (a mapping before a
// re-run).
func TestPickupsSignalUnknownCausePriority(t *testing.T) {
	signal := PickupsSignal(PickupsInput{Sources: []SourceReport{
		compareSource(runStale),
		{Analyzer: "other", Label: "Other", Tracked: true, Run: runUnmapped},
	}, ComputedAt: rollupNow})
	if signal.Cause != stages.CauseUnmappedTrack {
		t.Fatalf("cause = %q, want unmapped_track first", signal.Cause)
	}
}

// TestPickupsSignalMappingCauseWhenNothingRan: with no current source and a
// known mapping problem, the action is the mapping, not "run Compare".
func TestPickupsSignalMappingCauseWhenNothingRan(t *testing.T) {
	signal := PickupsSignal(PickupsInput{
		Sources:    []SourceReport{compareSource(runNever)},
		Mapping:    &RunStatus{State: RunUnknown, Cause: stages.CauseUnconfirmedMapping, Reason: "Confirm the track for this chapter."},
		ComputedAt: rollupNow,
	})
	if signal.State != stages.SignalUnknown || signal.Cause != stages.CauseUnconfirmedMapping {
		t.Fatalf("signal = %q/%q, want unknown/unconfirmed_mapping", signal.State, signal.Cause)
	}
}

// TestPickupsSignalCountsMatchSources is the Success Metrics row "Open-pickup
// count agrees with the sources": per source, open and dismissed counts equal a
// hand count, and every open item is listed with its finding id.
func TestPickupsSignalCountsMatchSources(t *testing.T) {
	signal := PickupsSignal(PickupsInput{Sources: []SourceReport{
		compareSource(runCurrent,
			item("c1", findings.StatusUnreviewed), item("c2", findings.StatusAccepted), item("c3", findings.StatusDismissed),
			absentItem("c4", findings.StatusUnreviewed, true), absentItem("c5", findings.StatusDeferred, false)),
		takeReviewSource(item("t1", findings.StatusDeferred), item("t2", findings.StatusDismissed), item("t3", findings.StatusDismissed)),
	}, ComputedAt: rollupNow})
	if signal.State != stages.SignalNotMet {
		t.Fatalf("state = %q, want not_met", signal.State)
	}
	if !strings.Contains(signal.Reason, "4 open") {
		t.Fatalf("reason %q should count 4 open (c1, c2, c5, t1)", signal.Reason)
	}
	sources := map[string]string{}
	var open []string
	for _, entry := range signal.Evidence {
		switch entry.Kind {
		case EvidenceSource:
			sources[entry.Label] = entry.Value
		case EvidencePickup:
			open = append(open, entry.FindingID)
		}
	}
	if got := sources["Transcript Compare"]; !strings.HasPrefix(got, "3 open, 1 dismissed, 1 resolved by a later run") {
		t.Fatalf("compare summary = %q", got)
	}
	if got := sources["Take review"]; !strings.HasPrefix(got, "1 open, 2 dismissed") {
		t.Fatalf("take review summary = %q", got)
	}
	if fmt.Sprint(open) != "[c1 c2 c5 t1]" {
		t.Fatalf("open finding ids = %v, want [c1 c2 c5 t1]", open)
	}
}

// TestPickupsSignalBasisTracksEvidence: the basis (what SR keys a dismissal and
// a confirmation on) changes when an item's review changes or a new run is
// recorded, and not when only the clock moves.
func TestPickupsSignalBasisTracksEvidence(t *testing.T) {
	base := PickupsInput{Sources: []SourceReport{compareSource(runCurrent, item("a", findings.StatusDismissed))}, ComputedAt: rollupNow}
	first := PickupsSignal(base)
	later := base
	later.ComputedAt = rollupNow.Add(time.Hour)
	if PickupsSignal(later).Basis.Fingerprint != first.Basis.Fingerprint {
		t.Fatal("the clock alone must not change the basis")
	}
	reopened := PickupsInput{Sources: []SourceReport{compareSource(runCurrent, item("a", findings.StatusDeferred))}, ComputedAt: rollupNow}
	if PickupsSignal(reopened).Basis.Fingerprint == first.Basis.Fingerprint {
		t.Fatal("a changed review must change the basis")
	}
	rerun := runCurrent
	rerun.RecordIDs = []string{"rec-2"}
	next := PickupsInput{Sources: []SourceReport{compareSource(rerun, item("a", findings.StatusDismissed))}, ComputedAt: rollupNow}
	got := PickupsSignal(next)
	if got.Basis.Fingerprint == first.Basis.Fingerprint || fmt.Sprint(got.Basis.LedgerRecordIDs) != "[rec-2]" {
		t.Fatalf("a new run must change the basis, got %+v", got.Basis)
	}
}

// TestPickupsSignalIsDeterministic: source and item order in the input do not
// change the answer (the store and map iteration give no order).
func TestPickupsSignalIsDeterministic(t *testing.T) {
	a := PickupsSignal(PickupsInput{Sources: []SourceReport{
		takeReviewSource(item("t2", findings.StatusUnreviewed), item("t1", findings.StatusUnreviewed)),
		compareSource(runCurrent, item("c1", findings.StatusUnreviewed)),
	}, ComputedAt: rollupNow})
	b := PickupsSignal(PickupsInput{Sources: []SourceReport{
		compareSource(runCurrent, item("c1", findings.StatusUnreviewed)),
		takeReviewSource(item("t1", findings.StatusUnreviewed), item("t2", findings.StatusUnreviewed)),
	}, ComputedAt: rollupNow})
	if fmt.Sprint(a.Evidence) != fmt.Sprint(b.Evidence) || a.Basis.Fingerprint != b.Basis.Fingerprint || a.Reason != b.Reason {
		t.Fatalf("order changed the answer:\n%v\n%v", a, b)
	}
}

// TestPickupsSignalNeverMetWhenUncovered sweeps every combination of source
// state and review status the matrix names and asserts the one rule the
// Key Hypothesis turns on: met only when some tracked source is current and
// nothing is open, never otherwise.
func TestPickupsSignalNeverMetWhenUncovered(t *testing.T) {
	runs := []RunStatus{runCurrent, runNever, runStale, runPartial, runFailed, runUnmapped, runUnreadable}
	statuses := []findings.Status{"", findings.StatusUnreviewed, findings.StatusAccepted, findings.StatusDeferred, findings.StatusDismissed}
	for _, compareRun := range runs {
		for _, compareStatus := range statuses {
			for _, trStatus := range statuses {
				var compareItems, trItems []PickupItem
				if compareStatus != "" {
					compareItems = append(compareItems, item("c", compareStatus))
				}
				if trStatus != "" {
					trItems = append(trItems, item("t", trStatus))
				}
				signal := PickupsSignal(PickupsInput{Sources: []SourceReport{compareSource(compareRun, compareItems...), takeReviewSource(trItems...)}, ComputedAt: rollupNow})
				open := (compareStatus != "" && compareStatus != findings.StatusDismissed) || (trStatus != "" && trStatus != findings.StatusDismissed)
				wantMet := compareRun.State == RunCurrent && !open
				if (signal.State == stages.SignalMet) != wantMet {
					t.Fatalf("run=%v compare=%q tr=%q: state %q, want met=%v", compareRun, compareStatus, trStatus, signal.State, wantMet)
				}
				if open && signal.State != stages.SignalNotMet {
					t.Fatalf("run=%v compare=%q tr=%q: an open item must give not_met, got %q", compareRun, compareStatus, trStatus, signal.State)
				}
			}
		}
	}
}
