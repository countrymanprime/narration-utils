// This file is Phase 4's run of docs/prds/editing-readiness-analysis.prd.md:
// DX Phase 9's click and breath detectors (measure/cleanup.go, exercised,
// never changed here) swept on the tuning half of the validation corpus
// (validationcorpus_test.go), scored on the held-out half per class and
// condition, and one fixture per failure the run found. Its tests pin the
// product to the run: the shipped defaults must be what the sweep chooses, and
// the recorded validations (validation.go) must be what the held-out half
// scores now. A change to the detector that moves a number fails here, and
// the fix is a new analyzer version with a new recorded run, not an edited
// number. docs/research/editing-click-breath-validation.md reports it.
package editing

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// validatedClasses are the two classes Phase 4 validates, with the analyzer
// each one's record belongs to.
var validatedClasses = []struct {
	label    LabelClass
	analyzer string
}{{LabelClick, AnalyzerClick}, {LabelBreath, AnalyzerBreath}}

// scoreByCondition scores split once per recording condition.
func scoreByCondition(t *testing.T, dir string, labels []CorpusLabel, cleanup measure.CleanupOptions, split LabelSplit) map[string]map[LabelClass]*ClassMetrics {
	t.Helper()
	out := map[string]map[LabelClass]*ClassMetrics{}
	for _, cond := range validationConditions() {
		var subset []CorpusLabel
		for _, label := range labels {
			if conditionOf(label.Source) == cond.name {
				subset = append(subset, label)
			}
		}
		out[cond.name] = scoreCorpus(t, dir, subset, measure.DefaultDiagnosticOptions(), cleanup, split, scoringTolerance)
	}
	return out
}

// pooled adds one class's metrics over every condition.
func pooled(byCondition map[string]map[LabelClass]*ClassMetrics, class LabelClass) ClassMetrics {
	total := ClassMetrics{Class: class}
	for _, metrics := range byCondition {
		m := metrics[class]
		total.TruePositives += m.TruePositives
		total.FalseNegatives += m.FalseNegatives
		total.FalsePositives += m.FalsePositives
		total.FalsePositivesIntentional += m.FalsePositivesIntentional
	}
	return total
}

// sweepStep is one value of one class's sensitivity knob.
type sweepStep struct {
	value   float64
	cleanup measure.CleanupOptions
}

// clickSweep and breathSweep are the values tried on the tuning half: each
// class's one sensitivity knob, around DX's shipped default, the rest held
// at DX's defaults.
func clickSweep() []sweepStep {
	var out []sweepStep
	for _, v := range []float64{20, 25, 30, 35, 40} {
		c := measure.DefaultCleanupOptions()
		c.ClickAboveSilenceDB = v
		out = append(out, sweepStep{v, c})
	}
	return out
}

func breathSweep() []sweepStep {
	var out []sweepStep
	for _, v := range []float64{6, 8, 10, 12, 15} {
		c := measure.DefaultCleanupOptions()
		c.BreathBelowSpeechDB = v
		out = append(out, sweepStep{v, c})
	}
	return out
}

// chooseConservative is Phase 4's selection rule on the tuning half: the
// highest recall (a missed click or breath is the false-"done" risk); among
// those, only values at least as sensitive as DX's default (for both knobs, a
// lower value raises more candidates), since precision measured on synthetic
// audio never justifies giving up recall margin on real audio; then the
// highest precision; then the value nearest DX's default. tune scores one
// step's cleanup options on the tuning half, so the synthetic and the
// LibriVox runs (librivoxvalidation_test.go) share the rule.
func chooseConservative(t *testing.T, class LabelClass, steps []sweepStep, dxDefault float64, tune func(measure.CleanupOptions) ClassMetrics) float64 {
	t.Helper()
	best, bestRecall, bestPrecision := math.NaN(), -1.0, -1.0
	for _, step := range steps {
		m := tune(step.cleanup)
		recall, precision := m.Recall(), m.Precision()
		if math.IsNaN(precision) {
			precision = 0
		}
		t.Logf("tuning half, %s at %v dB: recall %.2f (%d/%d), precision %.2f (%d/%d)", class, step.value,
			recall, m.TruePositives, m.TruePositives+m.FalseNegatives, precision, m.TruePositives, m.TruePositives+m.FalsePositives)
		if step.value > dxDefault {
			continue
		}
		better := recall > bestRecall ||
			(recall == bestRecall && precision > bestPrecision) ||
			(recall == bestRecall && precision == bestPrecision && math.Abs(step.value-dxDefault) < math.Abs(best-dxDefault))
		if better {
			best, bestRecall, bestPrecision = step.value, recall, precision
		}
	}
	return best
}

// TestShippedDefaultsAreTheTuningHalfChoice: DefaultScanOptions is what the
// selection rule picks on the tuning half, and nothing else changed from DX's
// defaults.
func TestShippedDefaultsAreTheTuningHalfChoice(t *testing.T) {
	dir := t.TempDir()
	labels := writeValidationCorpus(t, dir)
	dx, shipped := measure.DefaultCleanupOptions(), DefaultScanOptions()
	tune := func(class LabelClass) func(measure.CleanupOptions) ClassMetrics {
		return func(cleanup measure.CleanupOptions) ClassMetrics {
			return pooled(scoreByCondition(t, dir, labels, cleanup, SplitTune), class)
		}
	}

	if got := chooseConservative(t, LabelClick, clickSweep(), dx.ClickAboveSilenceDB, tune(LabelClick)); got != shipped.Cleanup.ClickAboveSilenceDB {
		t.Errorf("tuning half chooses ClickAboveSilenceDB %v, DefaultScanOptions ships %v", got, shipped.Cleanup.ClickAboveSilenceDB)
	}
	if got := chooseConservative(t, LabelBreath, breathSweep(), dx.BreathBelowSpeechDB, tune(LabelBreath)); got != shipped.Cleanup.BreathBelowSpeechDB {
		t.Errorf("tuning half chooses BreathBelowSpeechDB %v, DefaultScanOptions ships %v", got, shipped.Cleanup.BreathBelowSpeechDB)
	}
	rest := shipped.Cleanup
	rest.ClickAboveSilenceDB, rest.BreathBelowSpeechDB = dx.ClickAboveSilenceDB, dx.BreathBelowSpeechDB
	if rest != dx || shipped.Silence != measure.DefaultDiagnosticOptions() {
		t.Errorf("DefaultScanOptions changes a value the tuning half did not choose: %+v", shipped)
	}
}

// TestRecordedValidationsAreTheHeldOutRun scores the held-out half at the
// shipped defaults and requires the recorded runs to match it exactly, per
// condition. It also prints the table the research note reports.
func TestRecordedValidationsAreTheHeldOutRun(t *testing.T) {
	dir := t.TempDir()
	labels := writeValidationCorpus(t, dir)
	heldOut := scoreByCondition(t, dir, labels, DefaultScanOptions().Cleanup, SplitHeldOut)

	records := map[string]DetectorValidation{}
	for _, v := range DetectorValidations() {
		records[v.AnalyzerID+" "+v.AnalyzerVersion] = v
	}
	for _, class := range validatedClasses {
		version := ClickAnalyzerVersion
		if class.analyzer == AnalyzerBreath {
			version = BreathAnalyzerVersion
		}
		record, ok := records[class.analyzer+" "+version]
		if !ok {
			t.Fatalf("no recorded run for %s %s", class.analyzer, version)
		}
		if record.Corpus != CorpusSynthetic {
			t.Errorf("%s: recorded corpus %q, but this run is synthetic", class.analyzer, record.Corpus)
		}
		recorded := map[string]ConditionResult{}
		for _, r := range record.HeldOut {
			recorded[r.Condition] = r
		}
		for _, cond := range validationConditions() {
			m := heldOut[cond.name][class.label]
			got := ConditionResult{
				Condition: cond.name, TruePositives: m.TruePositives,
				Labels: m.TruePositives + m.FalseNegatives, Candidates: m.TruePositives + m.FalsePositives,
			}
			t.Logf("held-out %-6s %-10s recall %.2f (%d/%d)  precision %.2f (%d/%d, %d on a kept breath)", class.label, cond.name,
				m.Recall(), got.TruePositives, got.Labels, m.Precision(), got.TruePositives, got.Candidates, m.FalsePositivesIntentional)
			if recorded[cond.name] != got {
				t.Errorf("%s %s: recorded %+v, the held-out run gives %+v - a changed detector is a new version with a new recorded run",
					class.analyzer, cond.name, recorded[cond.name], got)
			}
		}
		total := record.Total()
		t.Logf("held-out %-6s all        recall %.2f (%d/%d), target %.2f: validated=%v", class.label, total.Recall(), total.TruePositives, total.Labels, RecallTarget, record.Validated())
		if len(record.HeldOut) != len(validationConditions()) {
			t.Errorf("%s: %d recorded conditions, want %d", class.analyzer, len(record.HeldOut), len(validationConditions()))
		}
	}
}

// failureFixture is one event the run got wrong, rebuilt on its own so the
// failure has a name and a regression test. editorWants is whether a careful
// editor cuts it; detectorFinds is what the shipped detector does today. The
// fixtures where the two differ are the failures; the two where they agree
// are the Phase Details' named hard cases the detector gets right.
type failureFixture struct {
	name          string
	class         measure.CleanupClass
	condition     recordingCondition
	build         func(c recordingCondition) (samples []float64, eventStart, eventEnd float64)
	editorWants   bool
	detectorFinds bool
}

func failureFixtures() []failureFixture {
	conds := map[string]recordingCondition{}
	for _, c := range validationConditions() {
		conds[c.name] = c
	}
	speech := func(c recordingCondition, s float64) []float64 {
		return toneSamples(validationRate, s, 220, c.speechPeakDB)
	}
	pause := func(s float64) []float64 { return silenceSamples(validationRate, s) }
	noise := func(s, db float64, seed uint64) []float64 { return noiseSamples(validationRate, s, db, seed) }
	// event lays out lead speech, the pre-event audio, the event, the
	// post-event audio and tail speech, and returns where the event is.
	event := func(c recordingCondition, before, ev, after []float64) ([]float64, float64, float64) {
		lead := concatSamples(speech(c, 2), before)
		start := float64(len(lead)) / validationRate
		end := start + float64(len(ev))/validationRate
		return concatSamples(lead, ev, after, speech(c, 1)), start, end
	}
	return []failureFixture{
		{
			name: "click inside a pause of room tone", class: measure.CleanupClick, condition: conds["room_tone"], editorWants: true, detectorFinds: true,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, pause(0.1), noise(0.02, -6, 11), pause(0.1))
			},
		},
		{
			name: "breath right after a plosive", class: measure.CleanupBreath, condition: conds["studio"], editorWants: true, detectorFinds: true,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, noise(0.02, c.speechPeakDB, 12), noise(0.3, c.speechPeakDB-16, 13), speech(c, 0.5))
			},
		},
		{
			name: "mouth click 30 ms before a word", class: measure.CleanupClick, condition: conds["studio"], editorWants: true, detectorFinds: false,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, pause(0.1), noise(0.01, -6, 14), pause(0.03))
			},
		},
		{
			name: "click in a pause of a noisy room (room tone above the -50 dBFS floor)", class: measure.CleanupClick, condition: conds["noisy_room"], editorWants: true, detectorFinds: false,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, pause(0.1), noise(0.02, -6, 15), pause(0.1))
			},
		},
		{
			name: "plosive release after a stop closure, before a pause", class: measure.CleanupClick, condition: conds["studio"], editorWants: false, detectorFinds: true,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, pause(0.06), noise(0.02, c.speechPeakDB, 16), pause(0.12))
			},
		},
		{
			name: "soft fricative onset after a pause", class: measure.CleanupBreath, condition: conds["studio"], editorWants: false, detectorFinds: true,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, pause(0.25), noise(0.15, c.speechPeakDB-18, 17), nil)
			},
		},
		{
			name: "loud breath 6 dB under the speech peak", class: measure.CleanupBreath, condition: conds["studio"], editorWants: true, detectorFinds: false,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, nil, noise(0.35, c.speechPeakDB-6, 18), nil)
			},
		},
		{
			name: "quiet breath in a quiet read (below the absolute -50 dBFS floor)", class: measure.CleanupBreath, condition: conds["quiet_read"], editorWants: true, detectorFinds: false,
			build: func(c recordingCondition) ([]float64, float64, float64) {
				return event(c, nil, noise(0.35, c.speechPeakDB-24, 19), nil)
			},
		},
	}
}

// TestDetectorFailureFixtures pins every failure the run found (and the named
// hard cases it passes) against the shipped detector. When DX Phase 9 fixes
// one, this fails on purpose: update the fixture, bump the class's analyzer
// version and record a new run.
func TestDetectorFailureFixtures(t *testing.T) {
	for _, fx := range failureFixtures() {
		t.Run(fx.name, func(t *testing.T) {
			samples, start, end := fx.build(fx.condition)
			if !math.IsInf(fx.condition.backgroundPeakDB, -1) {
				room := noiseSamples(validationRate, float64(len(samples))/validationRate, fx.condition.backgroundPeakDB, 99)
				for i := range samples {
					samples[i] += room[i]
				}
			}
			path := filepath.Join(t.TempDir(), "fixture.wav")
			if err := os.WriteFile(path, encodeWAV16(t, 1, validationRate, samples), 0o600); err != nil {
				t.Fatalf("writing fixture: %v", err)
			}
			opts := DefaultScanOptions()
			diagnostics, err := measure.DiagnoseFile(context.Background(), path, measure.DiagnosticInput{
				SourceKind: measure.SourceRawRecording, Options: opts.Silence, Cleanup: opts.Cleanup,
			})
			if err != nil {
				t.Fatalf("DiagnoseFile: %v", err)
			}
			found := false
			for _, c := range diagnostics.Cleanup.Candidates {
				if c.Class == fx.class && overlapsWithTolerance(scoringInterval{start, end}, scoringInterval{c.StartSeconds, c.EndSeconds}, scoringTolerance) {
					found = true
				}
			}
			if found != fx.detectorFinds {
				t.Fatalf("detector finds a %s here = %v, recorded %v (an editor would cut it: %v); update the fixture, the analyzer version and the recorded run together",
					fx.class, found, fx.detectorFinds, fx.editorWants)
			}
		})
	}
}
