// This file is Phase 1 of docs/prds/editing-readiness-analysis.prd.md: the
// "synthetic generators (known silence lengths, impulses at known
// positions)" its Scope calls for, committed to the repo because they are
// code-generated, unlike real audio (Q10 recommendation: "synthetic
// generators for unit tests only. Synthetic breaths and clicks are not a
// validation."). Everything here builds small WAV fixtures with a label at
// every synthesized event, so harness_test.go always knows exactly what a
// case contains and where.
package editing

import (
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// syntheticRate is shared with decode_test.go's testRate: at 8000 Hz, a
// cleanupWindowSeconds (10 ms, cleanup.go) window is exactly 80 frames, so
// every segment length below - each a whole multiple of 0.01 s - lands on an
// exact window boundary. Misaligned boundaries would let one synthesized
// event bleed a few samples into its neighbor's window and occasionally
// flip that window's silence classification, which would make the labels
// below only approximately true.
const syntheticRate = 8000

// noiseSamples is uncorrelated noise scaled to levelDB (the peak amplitude a
// sine at levelDB would have; noise's own RMS runs a few dB under that,
// same convention as toneSamples' peakDB). It stands in for both a click (a
// short, loud burst) and a breath (a longer, quiet one): cleanup.go's
// detectors key on level and burst shape, not on any particular spectrum,
// and looked-for zero-crossing rate is naturally high for noise, exactly
// what breaths' detector wants. seed makes every call reproducible (Success
// Metrics: "Reproducibility... produce identical candidates").
func noiseSamples(rate int, seconds, levelDB float64, seed uint64) []float64 {
	n := int(seconds * float64(rate))
	amp := math.Pow(10, levelDB/20)
	rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	out := make([]float64, n)
	for i := range out {
		out[i] = amp * (2*rng.Float64() - 1)
	}
	return out
}

// syntheticSegment is one stretch of a synthetic case's audio: length
// seconds of samples from render, optionally labeled as class (an unexported
// empty class - "" is never one of LabelClass's valid values - marks a
// segment that exists only to satisfy a detector's own preconditions, such
// as a click's silent flank or a run of speech to establish the speech
// level, and is never written to the labels file).
type syntheticSegment struct {
	class  LabelClass
	length float64
	render func(rate int) []float64
}

// buildSyntheticCase concatenates segments' audio and derives every labeled
// segment's [start, end) directly from the running sample count (never from
// hand-summed durations), so the labels can never drift out of sync with
// the audio they describe - the property TestSyntheticCorpusLabelsMatchAudio
// checks.
func buildSyntheticCase(rate int, source string, split LabelSplit, segments []syntheticSegment) ([]float64, []CorpusLabel) {
	var samples []float64
	var labels []CorpusLabel
	for _, seg := range segments {
		rendered := seg.render(rate)
		start := float64(len(samples)) / float64(rate)
		samples = append(samples, rendered...)
		end := float64(len(samples)) / float64(rate)
		if seg.class != "" {
			labels = append(labels, CorpusLabel{Source: source, Start: start, End: end, Class: seg.class, Split: split})
		}
	}
	return samples, labels
}

// syntheticVariant is one set of parameters buildSyntheticVariantCase draws
// a case from; four variants (two per split) give each positive and
// negative class more than one sample without the cases being identical.
type syntheticVariant struct {
	id           string
	split        LabelSplit
	freq         float64
	speechDB     float64
	gapSeconds   float64
	breathDB     float64
	breathLen    float64
	clickLen     float64
	clickDB      float64
	keepPause    float64
	keepBreathLn float64
	seed         uint64
}

func syntheticVariants() []syntheticVariant {
	return []syntheticVariant{
		{id: "tune-1", split: SplitTune, freq: 220, speechDB: -14, gapSeconds: 0.40, breathDB: -30, breathLen: 0.30, clickLen: 0.02, clickDB: 0, keepPause: 2.50, keepBreathLn: 0.20, seed: 100},
		{id: "tune-2", split: SplitTune, freq: 260, speechDB: -16, gapSeconds: 0.45, breathDB: -32, breathLen: 0.40, clickLen: 0.03, clickDB: -3, keepPause: 2.20, keepBreathLn: 0.30, seed: 200},
		{id: "held-1", split: SplitHeldOut, freq: 300, speechDB: -13, gapSeconds: 0.50, breathDB: -29, breathLen: 0.25, clickLen: 0.01, clickDB: -1, keepPause: 3.00, keepBreathLn: 0.15, seed: 300},
		{id: "held-2", split: SplitHeldOut, freq: 340, speechDB: -15, gapSeconds: 0.42, breathDB: -31, breathLen: 0.35, clickLen: 0.02, clickDB: -2, keepPause: 2.10, keepBreathLn: 0.25, seed: 400},
	}
}

// buildSyntheticVariantCase lays out one case as, in order: a long speech run
// (to establish the speech level breaths.go needs), a trimmable gap, more
// speech, a real breath, more speech, a real click (with true-silence
// flanks on each side - clickFlankWindows, cleanup.go), more speech, a long
// "meant" pause (keep_pause), more speech, a kept breath (keep_breath,
// acoustically identical to the real one - the point being that this
// detector cannot yet tell them apart, Technical Risks: "Heuristics mislabel
// dramatic pauses... breaths"), and a closing speech run.
func buildSyntheticVariantCase(v syntheticVariant) ([]float64, []CorpusLabel) {
	tone := func(seconds float64) func(int) []float64 {
		return func(rate int) []float64 { return toneSamples(rate, seconds, v.freq, v.speechDB) }
	}
	silence := func(seconds float64) func(int) []float64 {
		return func(rate int) []float64 { return silenceSamples(rate, seconds) }
	}
	noise := func(seconds, levelDB float64, seed uint64) func(int) []float64 {
		return func(rate int) []float64 { return noiseSamples(rate, seconds, levelDB, seed) }
	}
	segments := []syntheticSegment{
		{length: 2.00, render: tone(2.00)},
		{class: LabelSilenceToTrim, length: v.gapSeconds, render: silence(v.gapSeconds)},
		{length: 1.00, render: tone(1.00)},
		{class: LabelBreath, length: v.breathLen, render: noise(v.breathLen, v.breathDB, v.seed+1)},
		{length: 1.00, render: tone(1.00)},
		{length: 0.08, render: silence(0.08)},
		{class: LabelClick, length: v.clickLen, render: noise(v.clickLen, v.clickDB, v.seed+2)},
		{length: 0.08, render: silence(0.08)},
		{length: 1.00, render: tone(1.00)},
		{class: LabelKeepPause, length: v.keepPause, render: silence(v.keepPause)},
		{length: 1.00, render: tone(1.00)},
		{class: LabelKeepBreath, length: v.keepBreathLn, render: noise(v.keepBreathLn, v.breathDB, v.seed+3)},
		{length: 1.00, render: tone(1.00)},
	}
	return buildSyntheticCase(syntheticRate, v.id+".wav", v.split, segments)
}

// writeSyntheticCorpus renders every variant into dir as "<id>.wav" and
// writes their combined labels as dir/labels.csv in Phase 1's own CSV
// format (labels_test.go), so a synthetic corpus directory has exactly the
// shape a real, permissioned one would (harness_test.go's scoring never
// special-cases either). It returns the labels for tests that score in
// memory without re-reading the file.
func writeSyntheticCorpus(t *testing.T, dir string) []CorpusLabel {
	t.Helper()
	var all []CorpusLabel
	for _, v := range syntheticVariants() {
		samples, labels := buildSyntheticVariantCase(v)
		path := filepath.Join(dir, v.id+".wav")
		if err := os.WriteFile(path, encodeWAV16(t, 1, syntheticRate, samples), 0o600); err != nil {
			t.Fatalf("writing synthetic case %s: %v", v.id, err)
		}
		all = append(all, labels...)
	}
	var buf strings.Builder
	if err := WriteCorpusLabels(&buf, all); err != nil {
		t.Fatalf("WriteCorpusLabels() for the synthetic corpus: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "labels.csv"), []byte(buf.String()), 0o600); err != nil {
		t.Fatalf("writing synthetic labels.csv: %v", err)
	}
	return all
}

// readCorpusLabels reads and parses a labels.csv file, failing the test on
// any I/O or format error - used to prove writeSyntheticCorpus's file on
// disk round-trips exactly like the in-memory WriteCorpusLabels/
// ParseCorpusLabels pair labels_test.go already checks.
func readCorpusLabels(t *testing.T, path string) []CorpusLabel {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	labels, err := ParseCorpusLabels(strings.NewReader(string(data)))
	if err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
	return labels
}

// TestSyntheticCorpusLabelsMatchAudio is Phase 1's success signal "labels
// validate against the format": every generated label must parse back out
// of labels.csv unchanged, name a file that exists, and fall entirely
// within that file's own duration - the guarantee buildSyntheticCase's
// running-sample-count derivation makes, checked here so a future edit to
// the segment list cannot silently break it.
func TestSyntheticCorpusLabelsMatchAudio(t *testing.T) {
	dir := t.TempDir()
	labels := writeSyntheticCorpus(t, dir)
	if len(labels) == 0 {
		t.Fatal("writeSyntheticCorpus() produced no labels")
	}
	roundTripped := readCorpusLabels(t, filepath.Join(dir, "labels.csv"))
	if len(roundTripped) != len(labels) {
		t.Fatalf("labels.csv has %d rows, want %d", len(roundTripped), len(labels))
	}
	durations := map[string]float64{}
	for _, v := range syntheticVariants() {
		samples, _ := buildSyntheticVariantCase(v)
		durations[v.id+".wav"] = float64(len(samples)) / float64(syntheticRate)
	}
	classes := map[LabelClass]int{}
	for _, label := range labels {
		classes[label.Class]++
		duration, ok := durations[label.Source]
		if !ok {
			t.Fatalf("label names source %q, which no variant produced", label.Source)
		}
		if label.Start < 0 || label.End > duration || label.End <= label.Start {
			t.Fatalf("label %+v falls outside [0, %v]", label, duration)
		}
	}
	for _, class := range append(append([]LabelClass{}, positiveClasses()...), LabelKeepPause, LabelKeepBreath) {
		if classes[class] == 0 {
			t.Errorf("synthetic corpus has no %q labels", class)
		}
	}
}
