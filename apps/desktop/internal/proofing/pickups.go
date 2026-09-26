// Package proofing is docs/prds/proofing-readiness-signals.prd.md: the
// proofing stage's signals for the chapter stage recommendations engine
// (apps/desktop/internal/stages). It computes, on read and from stored
// evidence only, whether a chapter in the proofing stage has pickups left to
// clear up (proofing.pickups, Phase 1) and whether its rendered file meets
// each delivery check (proofing.delivery.<check>, Phase 5), and it keeps the
// two records those answers need that nothing else supplies: a Transcript
// Compare run's chapter identity and currency (Phase 2, compare.go) and the
// narrator's chapter-to-render association (Phase 4, renders.go). Nothing here
// changes a chapter status, audio or the manuscript, and no signal starts an
// analysis (D1, Q12 of the stage recommendations PRD).
package proofing

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// PickupsSignalID is the always-required proofing signal (Proposed Solution 1).
const PickupsSignalID = "proofing.pickups"

// Evidence kinds this package's signals use (stages.Evidence.Kind).
const (
	// EvidenceSource is one pickup source's summary line: open, dismissed and
	// resolved counts, and whether its last run is current.
	EvidenceSource = "source"
	// EvidencePickup is one open item, with its finding id.
	EvidencePickup = "pickup"
)

// RunState is how a pickup source's last run stands against the chapter as it
// is now. Only RunCurrent can let the roll-up be met.
type RunState string

const (
	// RunNever: the source keeps run records and has none for this chapter.
	RunNever RunState = "never"
	// RunCurrent: the latest run is complete, covers every played item of the
	// chapter's confirmed track, and the project was saved after it (Q4).
	RunCurrent RunState = "current"
	// RunUnknown: the source ran but its result cannot vouch for the chapter
	// now (stale, partial, failed, unmapped, ambiguous chapter, unreadable
	// project); Cause and Reason say which and what to do.
	RunUnknown RunState = "unknown"
	// RunUntracked: the source keeps no record of its runs, so it can neither
	// vouch for a chapter nor be found stale. Its open items still count.
	RunUntracked RunState = "untracked"
)

// RunStatus is one source's run state with the cause and the narrator-facing
// reason (which names the action) for RunUnknown, and the ledger records and
// fingerprint it was judged from.
type RunStatus struct {
	State       RunState
	Cause       stages.UnknownCause
	Reason      string
	RecordIDs   []string
	Fingerprint string
	At          time.Time
}

// PickupItem is one finding of a pickup category (Q1: transcript_discrepancy,
// pickup, duplicate_read) for the chapter, with what the roll-up needs to
// decide whether it is open.
type PickupItem struct {
	FindingID string
	Category  findings.Category
	Status    findings.Status
	// NotInLatestRun is the store's merge flag: the source's latest run did
	// not reproduce the finding.
	NotInLatestRun bool
	// ResolvedByRun says the run that did not reproduce it was complete and
	// covered its audio, so its absence is evidence it is gone (Architecture
	// Notes' merge rule). An absent finding without it stays open.
	ResolvedByRun bool
	Text          string
	File          string
	Range         *stages.TimeRange
	ParagraphID   string
}

// Open is D9 (Q2): unreviewed, deferred and accepted are open, dismissed is
// not; a finding the latest run did not reproduce is resolved only when that
// run covered it.
func (item PickupItem) Open() bool {
	if item.Status == findings.StatusDismissed {
		return false
	}
	return !(item.NotInLatestRun && item.ResolvedByRun)
}

// SourceReport is everything the roll-up knows about one pickup source for
// one chapter. Tracked says the source keeps run records (so results with no
// record are results the roll-up cannot date).
type SourceReport struct {
	Analyzer string
	Label    string
	Tracked  bool
	Run      RunStatus
	Items    []PickupItem
}

// PickupsInput is everything PickupsSignal reads. Mapping, when set, is the
// chapter's confirmed-track problem (unmapped, unconfirmed, several tracks): it
// is the action shown when no source is current, before "run Compare".
type PickupsInput struct {
	Sources            []SourceReport
	Mapping            *RunStatus
	ProjectFileModTime time.Time
	ComputedAt         time.Time
}

// sourceOrder puts the pickup sources in a fixed reading order; others follow
// by analyzer name.
var sourceOrder = []string{AnalyzerTranscriptCompare, AnalyzerTakeReview, AnalyzerTeleprompter}

// causePriority orders the unknown causes by which action unblocks the others
// first: a readable project, then the track mapping, then a finished and
// complete run, then a fresh one.
var causePriority = []stages.UnknownCause{
	stages.CauseProjectUnreadable, stages.CauseUnmappedTrack, stages.CauseUnconfirmedMapping, stages.CauseMultipleTracks,
	stages.CauseAnalysisRunning, stages.CauseIncompleteRun, stages.CauseStale, stages.CauseMeasurementUnavailable,
	stages.CauseNeverAnalyzed, stages.CauseProviderError,
}

// PickupsSignal is the pure roll-up (Architecture Notes, "Pickup roll-up
// rule"): not_met when any source has an open item; otherwise unknown when any
// source that ran cannot vouch for the chapter now, or when no source is
// current; met only when some source is current and nothing is open. The same
// input always gives the same signal.
func PickupsSignal(in PickupsInput) stages.Signal {
	sources := slices.Clone(in.Sources)
	slices.SortStableFunc(sources, compareSources)

	signal := stages.Signal{ID: PickupsSignalID, Stage: stages.StageProofing, Evidence: []stages.Evidence{}, ComputedAt: in.ComputedAt}
	var openParts []string
	openTotal, current := 0, 0
	var unknown []RunStatus
	var recordIDs []string
	var pickups []stages.Evidence
	for _, source := range sources {
		open, dismissed, resolved := countItems(source.Items)
		signal.Evidence = append(signal.Evidence, stages.Evidence{Kind: EvidenceSource, Label: source.Label, Value: sourceSummary(source, open, dismissed, resolved)})
		for _, it := range sortedItems(source.Items) {
			if it.Open() {
				pickups = append(pickups, pickupEvidence(source, it))
			}
		}
		recordIDs = append(recordIDs, source.Run.RecordIDs...)
		if open > 0 {
			openTotal += open
			openParts = append(openParts, fmt.Sprintf("%d %s", open, source.Label))
		}
		switch {
		case source.Run.State == RunCurrent:
			current++
		case source.Run.State == RunUnknown:
			unknown = append(unknown, source.Run)
		case source.Run.State == RunNever && source.Tracked && len(source.Items) > 0:
			unknown = append(unknown, RunStatus{State: RunUnknown, Cause: stages.CauseStale,
				Reason: source.Label + " has results for this chapter but no record of the run they came from. Run it again."})
		}
	}
	signal.Evidence = append(signal.Evidence, pickups...)
	signal.Basis = stages.Basis{LedgerRecordIDs: distinct(recordIDs), Fingerprint: basisFingerprint(sources), ProjectFileModTime: in.ProjectFileModTime}

	switch {
	case openTotal > 0:
		signal.State = stages.SignalNotMet
		signal.Reason = fmt.Sprintf("%d open pickup(s) to clear up (%s). Decide each on the Review page; a dismissal is the only way to close one without re-recording.", openTotal, strings.Join(openParts, ", "))
	case len(unknown) > 0:
		first := firstByCause(unknown)
		signal.State, signal.Cause, signal.Reason = stages.SignalUnknown, first.Cause, first.Reason
	case current == 0 && in.Mapping != nil:
		signal.State, signal.Cause, signal.Reason = stages.SignalUnknown, in.Mapping.Cause, in.Mapping.Reason
	case current == 0:
		signal.State, signal.Cause = stages.SignalUnknown, stages.CauseNeverAnalyzed
		signal.Reason = "No pickup check is current for this chapter. Run Transcript Compare on every item of the chapter's track, then save the project in REAPER."
	default:
		signal.State = stages.SignalMet
		signal.Reason = "No open pickups, and a current comparison covers every played item of the chapter."
	}
	return signal
}

func compareSources(a, b SourceReport) int {
	ai, bi := slices.Index(sourceOrder, a.Analyzer), slices.Index(sourceOrder, b.Analyzer)
	if ai < 0 {
		ai = len(sourceOrder)
	}
	if bi < 0 {
		bi = len(sourceOrder)
	}
	if c := cmp.Compare(ai, bi); c != 0 {
		return c
	}
	return cmp.Compare(a.Analyzer, b.Analyzer)
}

func countItems(items []PickupItem) (open, dismissed, resolved int) {
	for _, it := range items {
		switch {
		case it.Status == findings.StatusDismissed:
			dismissed++
		case !it.Open():
			resolved++
		default:
			open++
		}
	}
	return open, dismissed, resolved
}

// sourceSummary is the source's evidence line: its counts first, then what its
// run says about the chapter now.
func sourceSummary(source SourceReport, open, dismissed, resolved int) string {
	counts := fmt.Sprintf("%d open, %d dismissed", open, dismissed)
	if resolved > 0 {
		counts += fmt.Sprintf(", %d resolved by a later run", resolved)
	}
	switch source.Run.State {
	case RunCurrent:
		return counts + "; " + runLabel(source.Run)
	case RunUnknown:
		return counts + "; not current: " + source.Run.Reason
	case RunNever:
		if len(source.Items) == 0 {
			return "not run for this chapter"
		}
		return counts + "; no record of the run these came from"
	default:
		if len(source.Items) == 0 {
			return "no findings for this chapter (its runs are not recorded, so it cannot vouch for the chapter)"
		}
		return counts + " (its runs are not recorded, so it cannot vouch for the chapter)"
	}
}

func runLabel(run RunStatus) string {
	if run.At.IsZero() {
		return "current"
	}
	return "current, run " + run.At.UTC().Format(time.RFC3339)
}

func sortedItems(items []PickupItem) []PickupItem {
	sorted := slices.Clone(items)
	slices.SortStableFunc(sorted, func(a, b PickupItem) int { return cmp.Compare(a.FindingID, b.FindingID) })
	return sorted
}

func pickupEvidence(source SourceReport, it PickupItem) stages.Evidence {
	entry := stages.Evidence{Kind: EvidencePickup, Label: source.Label + ": " + categoryLabel(it.Category), Value: it.Text, File: it.File, Range: it.Range, FindingID: it.FindingID}
	if it.ParagraphID != "" {
		entry.ParagraphIDs = []string{it.ParagraphID}
	}
	if it.NotInLatestRun {
		entry.Value = strings.TrimSpace(entry.Value + " (not in the latest run, which did not cover it)")
	}
	return entry
}

func categoryLabel(category findings.Category) string {
	switch category {
	case findings.CategoryTranscriptDiscrepancy:
		return "discrepancy"
	case findings.CategoryPickup:
		return "pickup"
	case findings.CategoryDuplicateRead:
		return "repeated read"
	}
	return string(category)
}

func firstByCause(runs []RunStatus) RunStatus {
	best := runs[0]
	for _, run := range runs[1:] {
		if rank(run.Cause) < rank(best.Cause) {
			best = run
		}
	}
	return best
}

func rank(cause stages.UnknownCause) int {
	if index := slices.Index(causePriority, cause); index >= 0 {
		return index
	}
	return len(causePriority)
}

// basisFingerprint hashes what the verdict rests on: each source's run state,
// cause and records, and each item's id, review status and resolution. The
// clock and wording are left out, so a dismissal survives a re-read.
func basisFingerprint(sources []SourceReport) string {
	hash := sha256.New()
	for _, source := range sources {
		fmt.Fprintf(hash, "source\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\n", source.Analyzer, source.Run.State, source.Run.Cause, strings.Join(distinct(source.Run.RecordIDs), ","), source.Run.Fingerprint)
		for _, it := range sortedItems(source.Items) {
			fmt.Fprintf(hash, "item\x1f%s\x1f%s\x1f%t\x1f%t\n", it.FindingID, it.Status, it.NotInLatestRun, it.Open())
		}
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// distinct returns a sorted copy of values without duplicates, never nil.
func distinct(values []string) []string {
	out := slices.Clone(values)
	if out == nil {
		out = []string{}
	}
	slices.Sort(out)
	return slices.Compact(out)
}
