// This file is Phase 1 of docs/prds/editing-readiness-analysis.prd.md
// ("Editing corpus and evaluation harness"): "a Go harness computing
// per-class recall, precision and a sensitivity sweep on a tuning half and
// a held-out half." It scores DX Phase 9's real, already-shipped cleanup
// detector (measure.CleanupFindings' own candidates, apps/desktop/internal/
// measure/cleanup.go) against a labeled corpus (labels_test.go's format), on
// whichever corpus is at hand: the committed synthetic one
// (syntheticcorpus_test.go, always available) and, when
// NARRATION_EDITING_CORPUS names a directory, a real one (D70/D71:
// permissioned narrator audio, outside the repo, provisional). No product
// code changes: this only calls the detector that already ships.
package editing

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// detectorClassFor names the measure.CleanupClass DX Phase 9's detector uses
// for one of Phase 1's three positive label classes. Only positiveClasses()
// (labels_test.go) are ever passed in.
func detectorClassFor(class LabelClass) measure.CleanupClass {
	switch class {
	case LabelSilenceToTrim:
		return measure.CleanupSilence
	case LabelClick:
		return measure.CleanupClick
	case LabelBreath:
		return measure.CleanupBreath
	default:
		return ""
	}
}

// ClassMetrics is one class's recall and precision over one scored split.
// FalsePositivesIntentional is the subset of FalsePositives that overlap a
// "keep_" negative label (Q4/Q7: expected, and paid for by dismissal, not a
// detector bug) - reported separately so a table can show both.
type ClassMetrics struct {
	Class                     LabelClass
	TruePositives             int
	FalseNegatives            int
	FalsePositives            int
	FalsePositivesIntentional int
}

// Recall is TruePositives over every labeled location of Class, or NaN when
// the corpus has none (never silently 0 or 1, which would misreport an
// untested class as perfect or as failing).
func (m ClassMetrics) Recall() float64 {
	total := m.TruePositives + m.FalseNegatives
	if total == 0 {
		return math.NaN()
	}
	return float64(m.TruePositives) / float64(total)
}

// Precision is TruePositives over every candidate the detector raised for
// Class, or NaN when it raised none.
func (m ClassMetrics) Precision() float64 {
	total := m.TruePositives + m.FalsePositives
	if total == 0 {
		return math.NaN()
	}
	return float64(m.TruePositives) / float64(total)
}

// scoringInterval is a plain [start, end) span in one source's own seconds,
// used for both a label's range and a detector candidate's range so overlap
// matching does not care which one it came from.
type scoringInterval struct{ start, end float64 }

// overlapsWithTolerance reports whether a and b overlap once each is padded
// by tolerance seconds on both sides - Phase 1 Scope's "within a labeled
// tolerance": neither a label's boundary nor a detector's is exact to the
// sample, so an exact-overlap requirement would undercount recall on
// correctly-found events whose edges simply differ by a few tens of
// milliseconds.
func overlapsWithTolerance(a, b scoringInterval, tolerance float64) bool {
	return a.start < b.end+tolerance && b.start < a.end+tolerance
}

// scoreCorpus decodes every source file split's labels name (via
// measure.DiagnoseFile, the same entry point DX Phase 9's own findings use)
// and accumulates recall/precision per positive class. It is the harness's
// only entry point into the detector: neither editing.Decode nor a Source is
// needed, since Phase 1 scores whole files, not played ranges (Phase 2's own
// scope).
func scoreCorpus(t *testing.T, dir string, labels []CorpusLabel, opts measure.DiagnosticOptions, cleanup measure.CleanupOptions, split LabelSplit, tolerance float64) map[LabelClass]*ClassMetrics {
	t.Helper()
	metrics := map[LabelClass]*ClassMetrics{}
	for _, class := range positiveClasses() {
		metrics[class] = &ClassMetrics{Class: class}
	}
	bySource := map[string][]CorpusLabel{}
	for _, label := range labels {
		if label.Split != split {
			continue
		}
		bySource[label.Source] = append(bySource[label.Source], label)
	}
	sources := make([]string, 0, len(bySource))
	for source := range bySource {
		sources = append(sources, source)
	}
	sort.Strings(sources)
	for _, source := range sources {
		diagnostics, err := measure.DiagnoseFile(context.Background(), filepath.Join(dir, source), measure.DiagnosticInput{
			SourceKind: measure.SourceRawRecording,
			Options:    opts,
			Cleanup:    cleanup,
		})
		if err != nil {
			t.Fatalf("DiagnoseFile(%s): %v", source, err)
		}
		scoreSource(bySource[source], diagnostics.Cleanup.Candidates, tolerance, metrics)
	}
	return metrics
}

// scoreSource scores one source file's labels against its own detector
// candidates, matching each label at most once and each candidate at most
// once (a candidate that already matched a genuine positive can never also
// be blamed as a false positive against a negative label). Order per class:
// match real positives first (recall), then check whatever is left over
// against the class's negative label (an intentional pause or kept breath,
// Q4/Q7) before finally counting any still-unmatched candidate as an
// unexplained false positive.
func scoreSource(labels []CorpusLabel, candidates []measure.CleanupCandidate, tolerance float64, metrics map[LabelClass]*ClassMetrics) {
	matched := make([]bool, len(candidates))
	for _, class := range positiveClasses() {
		detectorClass := detectorClassFor(class)
		negative := negativeClassFor(class)
		var candidateIdx []int
		for i, candidate := range candidates {
			if candidate.Class == detectorClass {
				candidateIdx = append(candidateIdx, i)
			}
		}
		for _, label := range labels {
			if label.Class != class {
				continue
			}
			if matchOne(label, candidates, candidateIdx, matched, tolerance) {
				metrics[class].TruePositives++
			} else {
				metrics[class].FalseNegatives++
			}
		}
		if negative != "" {
			for _, label := range labels {
				if label.Class != negative {
					continue
				}
				if matchOne(label, candidates, candidateIdx, matched, tolerance) {
					metrics[class].FalsePositives++
					metrics[class].FalsePositivesIntentional++
				}
			}
		}
		for _, idx := range candidateIdx {
			if !matched[idx] {
				matched[idx] = true
				metrics[class].FalsePositives++
			}
		}
	}
}

// matchOne finds the first not-yet-matched candidate (by index into
// candidateIdx) overlapping label within tolerance, marks it matched in
// matched, and reports whether it found one.
func matchOne(label CorpusLabel, candidates []measure.CleanupCandidate, candidateIdx []int, matched []bool, tolerance float64) bool {
	target := scoringInterval{start: label.Start, end: label.End}
	for _, idx := range candidateIdx {
		if matched[idx] {
			continue
		}
		candidate := scoringInterval{start: candidates[idx].StartSeconds, end: candidates[idx].EndSeconds}
		if overlapsWithTolerance(target, candidate, tolerance) {
			matched[idx] = true
			return true
		}
	}
	return false
}

// printMetricsTable is Phase 1's own success signal: "the harness runs...
// and prints a per-class table."
func printMetricsTable(t *testing.T, label string, metrics map[LabelClass]*ClassMetrics) {
	t.Helper()
	t.Logf("%s:", label)
	for _, class := range positiveClasses() {
		m := metrics[class]
		t.Logf("  %-16s recall=%.2f (%d/%d)  precision=%.2f (%d/%d, %d against an intentional label)",
			class, m.Recall(), m.TruePositives, m.TruePositives+m.FalseNegatives,
			m.Precision(), m.TruePositives, m.TruePositives+m.FalsePositives, m.FalsePositivesIntentional)
	}
}

// scoringTolerance is the boundary slack overlap matching allows (Phase 1
// Scope: "within a labeled tolerance"). It is generous relative to the
// detector's own 10 ms window (cleanup.go's cleanupWindowSeconds) so a
// candidate whose edge lands a window or two from a hand-drawn label
// boundary still counts as the same event.
const scoringTolerance = 0.05

// TestClassRecallPrecisionOnSyntheticCorpus is Phase 1's success signal
// applied to the corpus every checkout has: "synthetic unit tests pass."
// It is a regression guard on DX Phase 9's detector and this harness's own
// matching, not a calibration: the Success Metrics' proposed 90% recall
// target is scored on real, permissioned audio once Phase 1's corpus plan
// (docs/research/editing-corpus-and-harness.md) has material, per D70/D71.
func TestClassRecallPrecisionOnSyntheticCorpus(t *testing.T) {
	dir := t.TempDir()
	labels := writeSyntheticCorpus(t, dir)
	opts := measure.DefaultDiagnosticOptions()
	cleanup := measure.DefaultCleanupOptions()

	tune := scoreCorpus(t, dir, labels, opts, cleanup, SplitTune, scoringTolerance)
	printMetricsTable(t, "synthetic corpus, tuning half", tune)
	heldOut := scoreCorpus(t, dir, labels, opts, cleanup, SplitHeldOut, scoringTolerance)
	printMetricsTable(t, "synthetic corpus, held-out half", heldOut)

	for _, class := range positiveClasses() {
		if recall := heldOut[class].Recall(); recall < 1.0 {
			t.Errorf("held-out %s recall = %.2f, want 1.0: every synthesized event is unambiguous by construction, "+
				"so anything less is a regression in DX-9's detector or in this harness's matching, not a corpus problem", class, recall)
		}
	}
	// The two "keep_" locations are acoustically identical to a genuine
	// breath/pause (Technical Risks: the detector cannot yet tell them
	// apart), so the detector is expected to fire on them - proving
	// precision is imperfect by construction, never that this is a bug.
	if got := heldOut[LabelSilenceToTrim].FalsePositivesIntentional; got == 0 {
		t.Error("held-out set: expected at least one silence_to_trim false positive against the keep_pause label (Q4/Q7 - an intentional pause still gets flagged, and the narrator's dismissal is the exit)")
	}
	if got := heldOut[LabelBreath].FalsePositivesIntentional; got == 0 {
		t.Error("held-out set: expected at least one breath false positive against the keep_breath label")
	}
}

// TestSensitivitySweepOnTuningHalf is Phase 1's other success signal: "a
// sensitivity sweep on a tuning half." It never touches the held-out split
// (scoreCorpus is called only with SplitTune below), matching Phase 4's own
// later job of actually choosing values from a sweep like this one on real
// data - Phase 1 only proves the harness can run one.
func TestSensitivitySweepOnTuningHalf(t *testing.T) {
	dir := t.TempDir()
	labels := writeSyntheticCorpus(t, dir)
	opts := measure.DefaultDiagnosticOptions()

	stricterBreath := measure.DefaultCleanupOptions()
	stricterBreath.BreathBelowSpeechDB = 18
	stricterClick := measure.DefaultCleanupOptions()
	stricterClick.ClickAboveSilenceDB = 40

	sweep := []struct {
		name    string
		cleanup measure.CleanupOptions
	}{
		{"default thresholds", measure.DefaultCleanupOptions()},
		{"stricter breath (18 dB below speech)", stricterBreath},
		{"stricter click (40 dB above silence)", stricterClick},
	}
	for _, step := range sweep {
		t.Run(step.name, func(t *testing.T) {
			metrics := scoreCorpus(t, dir, labels, opts, step.cleanup, SplitTune, scoringTolerance)
			printMetricsTable(t, "tuning half at "+step.name, metrics)
		})
	}
}

// TestClassRecallPrecisionOnRealCorpus is Phase 1's real-corpus run: skipped
// unless NARRATION_EDITING_CORPUS names a directory holding a labels.csv
// (labels_test.go's format) and the WAV files it names (D71: LibriVox or
// another permissioned source, audio kept out of git). Its numbers are
// PROVISIONAL (D70) until re-run on the owner's own recordings, tracked on
// #510 - this test only runs and reports, per D12 ("no threshold is a fact
// before Phase 4"): it never fails on a low number.
func TestClassRecallPrecisionOnRealCorpus(t *testing.T) {
	dir := os.Getenv("NARRATION_EDITING_CORPUS")
	if dir == "" {
		t.Skip("NARRATION_EDITING_CORPUS not set; see docs/research/editing-corpus-and-harness.md for the corpus layout")
	}
	data, err := os.ReadFile(filepath.Join(dir, "labels.csv"))
	if err != nil {
		t.Fatalf("reading %s/labels.csv: %v", dir, err)
	}
	labels, err := ParseCorpusLabels(strings.NewReader(string(data)))
	if err != nil {
		t.Fatalf("parsing %s/labels.csv: %v", dir, err)
	}
	opts := measure.DefaultDiagnosticOptions()
	cleanup := measure.DefaultCleanupOptions()
	const realCorpusTolerance = 0.1

	tune := scoreCorpus(t, dir, labels, opts, cleanup, SplitTune, realCorpusTolerance)
	printMetricsTable(t, "PROVISIONAL (D70/D71): real corpus, tuning half", tune)
	heldOut := scoreCorpus(t, dir, labels, opts, cleanup, SplitHeldOut, realCorpusTolerance)
	printMetricsTable(t, "PROVISIONAL (D70/D71): real corpus, held-out half", heldOut)
	t.Log("record these held-out numbers, the corpus conditions and the source provenance in docs/research/editing-corpus-and-harness.md, and file the real re-run as a QA item on #510 before this ships to users")
}
