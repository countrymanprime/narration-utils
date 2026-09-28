// This file is the real-speech follow-up to Phase 4 of
// docs/prds/editing-readiness-analysis.prd.md: validationrun_test.go's
// selection rule and scoring, run on the LibriVox Alice signal corpus
// (tests/fixtures/audio/librivox-alice, `build.py signal`) as a second
// evaluation set beside the synthetic one. That corpus is Kara Shallenberg's
// real reading of Chapter IX with 2 ms clicks added at known times in her
// pauses, so the room tone, breaths and mouth noise around every click are
// real. It has no breath labels. The audio is fetched from archive.org and
// never committed (ADR 0125/0416), so the run is skipped unless
// NARRATION_SIGNAL_CORPUS names a built corpus, like measure's
// TestLibriVoxSignalCorpus. docs/research/editing-click-breath-validation.md
// reports it; ADR 0575 says what the set can and cannot decide.
package editing

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// librivoxSignalCorpusEnv is the variable measure's TestLibriVoxSignalCorpus
// reads: one built signal corpus serves both runs.
const librivoxSignalCorpusEnv = "NARRATION_SIGNAL_CORPUS"

// librivoxClickSeconds is the builder's click length (signal_corpus.py
// CLICK_SECONDS): a click label runs from at_s for this long.
const librivoxClickSeconds = 0.002

// minLabelsPerSplit is the PRD's proposed corpus size per class and split
// (TestValidationCorpusShape holds the synthetic corpus to it too). A set
// under it can report a rate but never meet the target.
const minLabelsPerSplit = 25

// librivoxSignalCase is the part of one labels.json case this run reads.
type librivoxSignalCase struct {
	ID     string `json:"id"`
	File   string `json:"file"`
	Events []struct {
		Kind       string  `json:"kind"`
		AtS        float64 `json:"at_s"`
		KnownIssue string  `json:"known_issue"`
	} `json:"events"`
}

// librivoxClickLabel is one labeled click. Its condition is the case it sits
// in (a loud click in a pause, a quiet one, one touching a breath), since
// every case is the same reader, room and excerpt and differs only in how the
// click was put in. KnownIssue is the builder's note that the detectors are
// known to miss it.
type librivoxClickLabel struct {
	CorpusLabel
	Condition  string
	KnownIssue string
}

// loadLibriVoxClickCorpus reads labels.json and splits its clicks. The
// synthetic corpus splits by file, which a set of one reading cannot do and
// still put every condition in both halves, so this one splits by pause:
// within each case, in time order, the clicks alternate held-out, tune,
// held-out... Starting on held-out keeps a one-click condition in the half
// that is reported.
func loadLibriVoxClickCorpus(path string) ([]librivoxSignalCase, []librivoxClickLabel, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	var parsed struct {
		Cases []librivoxSignalCase `json:"cases"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, nil, fmt.Errorf("parse %s: %w", path, err)
	}
	var labels []librivoxClickLabel
	for _, c := range parsed.Cases {
		if c.ID == "" || c.File == "" {
			return nil, nil, fmt.Errorf("%s: a case needs an id and a file: %+v", path, c)
		}
		var clicks []librivoxClickLabel
		for _, event := range c.Events {
			if event.Kind != "click" {
				continue
			}
			clicks = append(clicks, librivoxClickLabel{
				CorpusLabel: CorpusLabel{Source: c.File, Start: event.AtS, End: event.AtS + librivoxClickSeconds, Class: LabelClick},
				Condition:   c.ID, KnownIssue: event.KnownIssue,
			})
		}
		sort.SliceStable(clicks, func(i, j int) bool { return clicks[i].Start < clicks[j].Start })
		for i := range clicks {
			clicks[i].Split = SplitHeldOut
			if i%2 == 1 {
				clicks[i].Split = SplitTune
			}
		}
		labels = append(labels, clicks...)
	}
	return parsed.Cases, labels, nil
}

// librivoxConditions lists the conditions that hold a click, in case order.
func librivoxConditions(labels []librivoxClickLabel) []string {
	var out []string
	seen := map[string]bool{}
	for _, label := range labels {
		if !seen[label.Condition] {
			seen[label.Condition] = true
			out = append(out, label.Condition)
		}
	}
	return out
}

// librivoxRun decodes each (file, options) pair once.
type librivoxRun struct {
	t     *testing.T
	dir   string
	cache map[string]measure.Diagnostics
}

func (r *librivoxRun) diagnose(file string, cleanup measure.CleanupOptions) measure.Diagnostics {
	r.t.Helper()
	key := fmt.Sprintf("%s %+v", file, cleanup)
	if d, ok := r.cache[key]; ok {
		return d
	}
	d, err := measure.DiagnoseFile(context.Background(), filepath.Join(r.dir, file), measure.DiagnosticInput{
		SourceKind: measure.SourceRawRecording, Options: measure.DefaultDiagnosticOptions(), Cleanup: cleanup,
	})
	if err != nil {
		r.t.Fatalf("DiagnoseFile(%s): %v", file, err)
	}
	r.cache[key] = d
	return d
}

// clicks scores the click labels that keep says to, file by file, with the
// Phase 1 harness's own matching (scoreSource). Only the true positives and
// false negatives mean anything here: the candidates of a file are shared by
// labels in both halves, so precision is taken per case instead.
func (r *librivoxRun) clicks(labels []librivoxClickLabel, cleanup measure.CleanupOptions, keep func(librivoxClickLabel) bool) ClassMetrics {
	r.t.Helper()
	bySource := map[string][]CorpusLabel{}
	var sources []string
	for _, label := range labels {
		if !keep(label) {
			continue
		}
		if _, ok := bySource[label.Source]; !ok {
			sources = append(sources, label.Source)
		}
		bySource[label.Source] = append(bySource[label.Source], label.CorpusLabel)
	}
	total := ClassMetrics{Class: LabelClick}
	for _, source := range sources {
		metrics := emptyMetrics()
		scoreSource(bySource[source], r.diagnose(source, cleanup).Cleanup.Candidates, scoringTolerance, metrics)
		total.TruePositives += metrics[LabelClick].TruePositives
		total.FalseNegatives += metrics[LabelClick].FalseNegatives
	}
	return total
}

func emptyMetrics() map[LabelClass]*ClassMetrics {
	out := map[LabelClass]*ClassMetrics{}
	for _, class := range positiveClasses() {
		out[class] = &ClassMetrics{Class: class}
	}
	return out
}

// meetsTarget is the bar a class must clear on this set before a Proposed ADR
// may ask to open it (ADR 0510, 0575): enough labels, and held-out recall at
// RecallTarget overall and in every condition.
func meetsTarget(total ClassMetrics, byCondition map[string]ClassMetrics) bool {
	if total.TruePositives+total.FalseNegatives < minLabelsPerSplit || total.Recall() < RecallTarget {
		return false
	}
	for _, m := range byCondition {
		if !(m.Recall() >= RecallTarget) {
			return false
		}
	}
	return true
}

// TestLibriVoxClickLabelsSplit checks the loader and the split rule without
// any audio: every click becomes a label in its case's condition, clicks
// alternate held-out and tune in time order, a one-click case is held out,
// other events are ignored, and a known issue is carried.
func TestLibriVoxClickLabelsSplit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "labels.json")
	body := `{"cases": [
		{"id": "a-control", "file": "a-control.wav", "events": []},
		{"id": "a-clicks", "file": "a-clicks.wav", "events": [
			{"kind": "click", "at_s": 30.5, "peak_dbfs": -6},
			{"kind": "click", "at_s": 10.25, "peak_dbfs": -6},
			{"kind": "click", "at_s": 50, "peak_dbfs": -6, "known_issue": "no silent flank"}
		]},
		{"id": "a-before-breath", "file": "a-before-breath.wav", "events": [{"kind": "click", "at_s": 7, "peak_dbfs": -6}]},
		{"id": "a-hiss", "file": "a-hiss.wav", "events": [{"kind": "hiss", "from_s": 0, "rms_dbfs": -50}]}
	]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	cases, labels, err := loadLibriVoxClickCorpus(path)
	if err != nil {
		t.Fatalf("loadLibriVoxClickCorpus: %v", err)
	}
	if len(cases) != 4 {
		t.Fatalf("%d cases, want 4", len(cases))
	}
	type row struct {
		condition string
		start     float64
		split     LabelSplit
		known     bool
	}
	want := []row{
		{"a-clicks", 10.25, SplitHeldOut, false},
		{"a-clicks", 30.5, SplitTune, false},
		{"a-clicks", 50, SplitHeldOut, true},
		{"a-before-breath", 7, SplitHeldOut, false},
	}
	if len(labels) != len(want) {
		t.Fatalf("%d labels, want %d: %+v", len(labels), len(want), labels)
	}
	for i, w := range want {
		got := labels[i]
		if got.Condition != w.condition || got.Start != w.start || got.Split != w.split || (got.KnownIssue != "") != w.known {
			t.Errorf("label %d = %+v, want %+v", i, got, w)
		}
		if got.Class != LabelClick || math.Abs(got.End-got.Start-librivoxClickSeconds) > 1e-9 || got.Source != w.condition+".wav" {
			t.Errorf("label %d is not a %v s click in its case's file: %+v", i, librivoxClickSeconds, got)
		}
	}
	if got := librivoxConditions(labels); strings.Join(got, ",") != "a-clicks,a-before-breath" {
		t.Errorf("conditions = %v", got)
	}

	if err := os.WriteFile(path, []byte(`{"cases": [{"id": "", "file": "x.wav"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadLibriVoxClickCorpus(path); err == nil {
		t.Error("a case without an id was accepted")
	}
	if err := os.WriteFile(path, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadLibriVoxClickCorpus(path); err == nil {
		t.Error("malformed JSON was accepted")
	}
}

// TestMeetsTarget pins the bar: label count, overall recall, and every
// condition.
func TestMeetsTarget(t *testing.T) {
	at := func(tp, fn int) ClassMetrics { return ClassMetrics{TruePositives: tp, FalseNegatives: fn} }
	cases := []struct {
		name        string
		total       ClassMetrics
		byCondition map[string]ClassMetrics
		want        bool
	}{
		{"every condition at target", at(27, 3), map[string]ClassMetrics{"a": at(18, 2), "b": at(9, 1)}, true},
		{"too few labels", at(24, 0), map[string]ClassMetrics{"a": at(24, 0)}, false},
		{"overall under target", at(26, 4), map[string]ClassMetrics{"a": at(26, 4)}, false},
		{"one condition under target", at(28, 2), map[string]ClassMetrics{"a": at(20, 0), "b": at(8, 2)}, false},
		{"a condition with no labels", at(30, 0), map[string]ClassMetrics{"a": at(30, 0), "b": at(0, 0)}, false},
	}
	for _, c := range cases {
		if got := meetsTarget(c.total, c.byCondition); got != c.want {
			t.Errorf("%s: meetsTarget = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestClickBreathOnLibriVoxSignalCorpus is the real-speech run. On the tuning
// half it sweeps the click knob with the synthetic run's selection rule and
// reports whether real speech picks the value DefaultScanOptions ships; it
// never changes the default (a default chosen here would be tuned to pass).
// On the held-out half it reports click recall per condition at
// DefaultScanOptions and whether the class meets the target. Per case it
// reports click and breath candidates, and how many unlabeled ones the
// unedited control has at the same time (the reader's own mouth noise and
// breaths, or false positives: nobody has listened yet). It fails only on a
// broken corpus or a stale known issue (a click the builder says is missed
// that is now found), like TestLibriVoxSignalCorpus: low numbers are the
// result, not a failure.
func TestClickBreathOnLibriVoxSignalCorpus(t *testing.T) {
	dir := os.Getenv(librivoxSignalCorpusEnv)
	if dir == "" {
		t.Skipf("set %s to a built signal corpus to run this (tests/fixtures/audio/librivox-alice/README.md)", librivoxSignalCorpusEnv)
	}
	cases, labels, err := loadLibriVoxClickCorpus(filepath.Join(dir, "labels.json"))
	if err != nil {
		t.Fatalf("labels: %v", err)
	}
	if len(labels) == 0 {
		t.Fatal("the signal corpus has no click labels")
	}
	run := &librivoxRun{t: t, dir: dir, cache: map[string]measure.Diagnostics{}}
	conditions := librivoxConditions(labels)
	shipped, dx := DefaultScanOptions(), measure.DefaultCleanupOptions()
	inSplit := func(split LabelSplit, condition string) func(librivoxClickLabel) bool {
		return func(l librivoxClickLabel) bool {
			return l.Split == split && (condition == "" || l.Condition == condition)
		}
	}

	// Tuning half: the synthetic run's rule, on real speech.
	tuneLabels := run.clicks(labels, shipped.Cleanup, inSplit(SplitTune, ""))
	t.Logf("tuning half: %d clicks over %d conditions (breaths: no labels in this corpus, so no sweep)", tuneLabels.TruePositives+tuneLabels.FalseNegatives, len(conditions))
	chosen := chooseConservative(t, LabelClick, clickSweep(), dx.ClickAboveSilenceDB, func(cleanup measure.CleanupOptions) ClassMetrics {
		return run.clicks(labels, cleanup, inSplit(SplitTune, ""))
	})
	agrees := "agrees with"
	if chosen != shipped.Cleanup.ClickAboveSilenceDB {
		agrees = "differs from"
	}
	t.Logf("real speech's tuning half chooses ClickAboveSilenceDB %v, which %s the shipped %v (reported, never applied)", chosen, agrees, shipped.Cleanup.ClickAboveSilenceDB)

	// Held-out half at the shipped defaults.
	byCondition := map[string]ClassMetrics{}
	for _, condition := range conditions {
		m := run.clicks(labels, shipped.Cleanup, inSplit(SplitHeldOut, condition))
		byCondition[condition] = m
		t.Logf("held-out click %-28s recall %.2f (%d/%d)", condition, m.Recall(), m.TruePositives, m.TruePositives+m.FalseNegatives)
	}
	total := run.clicks(labels, shipped.Cleanup, inSplit(SplitHeldOut, ""))
	t.Logf("held-out click %-28s recall %.2f (%d/%d); needs %.2f in every condition and at least %d labels: meets target = %v",
		"all", total.Recall(), total.TruePositives, total.TruePositives+total.FalseNegatives, RecallTarget, minLabelsPerSplit, meetsTarget(total, byCondition))
	t.Log("held-out breath: not measurable (the signal corpus labels no breaths); meets target = false")

	// Every label at the shipped defaults: a missed click is logged, a
	// known issue that is now found fails (the note is stale).
	for _, label := range labels {
		found := run.clicks([]librivoxClickLabel{label}, shipped.Cleanup, func(librivoxClickLabel) bool { return true }).TruePositives == 1
		switch {
		case label.KnownIssue != "" && found:
			t.Errorf("%s click at %.3f s is found, but labels.json says it is missed (%q): remove the knownIssue from recipes/signal.json", label.Condition, label.Start, label.KnownIssue)
		case label.KnownIssue != "":
			t.Logf("  %s click at %.3f s (%s): missed, a known issue", label.Condition, label.Start, label.Split)
		case !found:
			t.Logf("  %s click at %.3f s (%s): MISSED", label.Condition, label.Start, label.Split)
		}
	}

	// Per case: candidates, and the unedited control as the baseline.
	var control *measure.Diagnostics
	for _, c := range cases {
		if strings.HasSuffix(c.ID, "-control") {
			d := run.diagnose(c.File, shipped.Cleanup)
			control = &d
		}
	}
	for _, c := range cases {
		d := run.diagnose(c.File, shipped.Cleanup)
		var own []CorpusLabel
		for _, label := range labels {
			if label.Source == c.File {
				own = append(own, label.CorpusLabel)
			}
		}
		metrics := emptyMetrics()
		scoreSource(own, d.Cleanup.Candidates, scoringTolerance, metrics)
		click, breath := metrics[LabelClick], metrics[LabelBreath]
		baseline := "n/a (time inserted or trimmed, or no control)"
		if control != nil && math.Abs(control.DurationSeconds-d.DurationSeconds) < 0.001 {
			baseline = fmt.Sprintf("%d click, %d breath", inControl(d, *control, measure.CleanupClick), inControl(d, *control, measure.CleanupBreath))
		}
		t.Logf("case %-28s clicks: %d candidates, %d at a label, %d unlabeled; breaths: %d candidates (unlabeled); also in the control at the same time: %s",
			c.ID, click.TruePositives+click.FalsePositives, click.TruePositives, click.FalsePositives, breath.FalsePositives, baseline)
	}
}

// inControl counts d's candidates of class that the control also raises at
// the same time: the reader's own sounds (or the same false positive), not
// something the edit caused.
func inControl(d, control measure.Diagnostics, class measure.CleanupClass) int {
	n := 0
	for _, c := range d.Cleanup.Candidates {
		if c.Class != class {
			continue
		}
		for _, b := range control.Cleanup.Candidates {
			if b.Class == class && overlapsWithTolerance(scoringInterval{c.StartSeconds, c.EndSeconds}, scoringInterval{b.StartSeconds, b.EndSeconds}, scoringTolerance) {
				n++
				break
			}
		}
	}
	return n
}
