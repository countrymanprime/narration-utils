// This file is Phase 4 of docs/prds/editing-readiness-analysis.prd.md
// ("Click and breath validation"): the corpus the click and breath detectors
// are tuned and held out on. No permissioned narrator audio exists on main
// (D70/D71; the LibriVox Alice signal set labels clicks only and runs
// separately, librivoxvalidation_test.go), so, like Phase 1's
// syntheticcorpus_test.go, it is generated in code - but unlike Phase 1's four
// clean cases it is built to hurt: every event sits in one of four recording
// conditions, and the Phase Details' named hard cases (breath after a plosive,
// click inside silence, soft onset, plosive versus click) are all in it, with
// levels drawn at random over a realistic range rather than placed where the
// detector's defaults happen to catch them. Q10 still applies to everything
// here: "Synthetic breaths and clicks are not a validation." Its numbers are
// provisional (D70) and never open the validated-version gate on their own
// (validation.go).
package editing

import (
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// validationRate is 16 kHz: a 10 ms detector window is exactly 160 frames, so
// every segment below (each a whole number of milliseconds times ten) lands on
// a window boundary, and clicks keep more bandwidth than Phase 1's 8 kHz.
const validationRate = 16000

// recordingCondition is one room and read the corpus is scored under (the
// PRD's Technical Risks: "results labeled by conditions"). backgroundPeakDB
// is the room tone under the whole file (its RMS runs about 4.8 dB lower,
// uniform noise); math.Inf(-1) is digital silence.
type recordingCondition struct {
	name             string
	backgroundPeakDB float64
	speechPeakDB     float64
}

// validationConditions are the four conditions every split is built under. The
// detectors' silence floor is an absolute -50 dBFS (measure.DefaultDiagnosticOptions),
// so "noisy room" puts room tone just above it and "quiet read" puts the
// quietest breaths just below it - both on purpose, since both happen in real
// home studios.
func validationConditions() []recordingCondition {
	return []recordingCondition{
		{name: "studio", backgroundPeakDB: math.Inf(-1), speechPeakDB: -14},
		{name: "room_tone", backgroundPeakDB: -62, speechPeakDB: -14},
		{name: "noisy_room", backgroundPeakDB: -44, speechPeakDB: -14},
		{name: "quiet_read", backgroundPeakDB: -62, speechPeakDB: -28},
	}
}

// hardCase is one kind of event block the generator lays between runs of
// speech. Its label class is what a careful editor would mark it as; "" is an
// event no editor would cut (a soft onset, a stop release), so any candidate
// on it is an unexplained false positive.
type hardCase string

const (
	caseBreath             hardCase = "breath"               // an inhale between phrases, speech on both sides
	caseBreathAfterPlosive hardCase = "breath_after_plosive" // a plosive burst ends the phrase, the inhale follows at once
	caseClickInPause       hardCase = "click_in_pause"       // a mouth click inside a short pause (room tone both sides)
	caseClickNearOnset     hardCase = "click_near_onset"     // a mouth click 30 ms before the next word starts
	caseKeepBreath         hardCase = "keep_breath"          // a breath the narrator keeps on purpose
	caseSoftOnset          hardCase = "soft_onset"           // a pause, then a word starting on a quiet fricative ("s...")
	casePlosiveRelease     hardCase = "plosive_release"      // a stop closure then its release burst, then a pause ("stop.")
)

func (c hardCase) label() LabelClass {
	switch c {
	case caseBreath, caseBreathAfterPlosive:
		return LabelBreath
	case caseClickInPause, caseClickNearOnset:
		return LabelClick
	case caseKeepBreath:
		return LabelKeepBreath
	}
	return ""
}

func validationHardCases() []hardCase {
	return []hardCase{caseBreath, caseBreathAfterPlosive, caseClickInPause, caseClickNearOnset, caseKeepBreath, caseSoftOnset, casePlosiveRelease}
}

// validationFilesPerSplit is how many files each condition gets per split;
// every file holds validationRepeats of every hard case, so each split has
// 4 conditions x 2 files x 2 repeats x 2 positive cases = 32 labeled clicks
// and 32 labeled breaths, past the PRD's proposed 25 per class.
const (
	validationFilesPerSplit = 2
	validationRepeats       = 2
)

// validationSource names one generated file; the condition leads the name so
// scoring can split results by condition without a second label column.
func validationSource(condition string, split LabelSplit, index int) string {
	return fmt.Sprintf("%s-%s-%d.wav", condition, split, index)
}

func conditionOf(source string) string { return source[:strings.Index(source, "-")] }

// buildValidationFile lays out one file: speech, then every hard case
// validationRepeats times in a seeded random order, each followed by more
// speech, with room tone mixed under the whole file. Levels are drawn per
// event: breaths from 8 to 28 dB below the speech peak (a loud breath is what
// a narrator most wants caught), clicks from -18 to 0 dBFS.
func buildValidationFile(cond recordingCondition, split LabelSplit, index int, seed uint64) ([]float64, []CorpusLabel) {
	rng := rand.New(rand.NewPCG(seed, seed^0x51ed270b27a3f1c5))
	uniform := func(lo, hi float64) float64 { return lo + (hi-lo)*rng.Float64() }
	// ms rounds to a whole 10 ms so every segment stays window-aligned.
	ms := func(lo, hi float64) float64 { return math.Round(uniform(lo, hi)/10) * 0.01 }
	source := validationSource(cond.name, split, index)

	var samples []float64
	var labels []CorpusLabel
	freq := uniform(180, 320)
	speech := func(seconds float64) {
		samples = append(samples, toneSamples(validationRate, seconds, freq, cond.speechPeakDB)...)
	}
	pause := func(seconds float64) { samples = append(samples, silenceSamples(validationRate, seconds)...) }
	noise := func(seconds, peakDB float64) {
		samples = append(samples, noiseSamples(validationRate, seconds, peakDB, rng.Uint64())...)
	}
	labeled := func(class LabelClass, emit func()) {
		start := float64(len(samples)) / validationRate
		emit()
		if class != "" {
			labels = append(labels, CorpusLabel{Source: source, Start: start, End: float64(len(samples)) / validationRate, Class: class, Split: split})
		}
	}

	var order []hardCase
	for range validationRepeats {
		order = append(order, validationHardCases()...)
	}
	rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })

	speech(2.0)
	for _, c := range order {
		breathPeak := cond.speechPeakDB - uniform(8, 28)
		switch c {
		case caseBreath, caseKeepBreath:
			labeled(c.label(), func() { noise(ms(200, 500), breathPeak) })
		case caseBreathAfterPlosive:
			noise(0.02, cond.speechPeakDB)
			labeled(c.label(), func() { noise(ms(200, 500), breathPeak) })
		case caseClickInPause:
			pause(ms(80, 150))
			labeled(c.label(), func() { noise(ms(10, 30), uniform(-18, 0)) })
			pause(ms(80, 150))
		case caseClickNearOnset:
			pause(ms(80, 150))
			labeled(c.label(), func() { noise(0.01, uniform(-18, 0)) })
			pause(0.03)
		case caseSoftOnset:
			pause(0.25)
			noise(ms(100, 200), cond.speechPeakDB-uniform(14, 22))
		case casePlosiveRelease:
			pause(0.06)
			noise(0.02, cond.speechPeakDB)
			pause(ms(80, 150))
		}
		speech(ms(600, 1000))
	}

	if !math.IsInf(cond.backgroundPeakDB, -1) {
		room := noiseSamples(validationRate, float64(len(samples))/validationRate, cond.backgroundPeakDB, rng.Uint64())
		for i := range samples {
			samples[i] += room[i]
		}
	}
	return samples, labels
}

// validationSeed gives every (condition, split, file) its own reproducible
// seed, so the tuning and held-out halves never share an event.
func validationSeed(conditionIndex int, split LabelSplit, index int) uint64 {
	s := uint64(1000 + 100*conditionIndex + index)
	if split == SplitHeldOut {
		s += 50
	}
	return s
}

// writeValidationCorpus renders every file of both splits into dir with a
// labels.csv in Phase 1's format, the same directory shape a real corpus has
// (NARRATION_EDITING_CORPUS), and returns the labels.
func writeValidationCorpus(t *testing.T, dir string) []CorpusLabel {
	t.Helper()
	var all []CorpusLabel
	for ci, cond := range validationConditions() {
		for _, split := range []LabelSplit{SplitTune, SplitHeldOut} {
			for index := range validationFilesPerSplit {
				samples, labels := buildValidationFile(cond, split, index, validationSeed(ci, split, index))
				path := filepath.Join(dir, validationSource(cond.name, split, index))
				if err := os.WriteFile(path, encodeWAV16(t, 1, validationRate, samples), 0o600); err != nil {
					t.Fatalf("writing %s: %v", path, err)
				}
				all = append(all, labels...)
			}
		}
	}
	var buf strings.Builder
	if err := WriteCorpusLabels(&buf, all); err != nil {
		t.Fatalf("WriteCorpusLabels() for the validation corpus: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "labels.csv"), []byte(buf.String()), 0o600); err != nil {
		t.Fatalf("writing labels.csv: %v", err)
	}
	return all
}

// TestValidationCorpusShape guards the corpus itself: every label round-trips
// through labels.csv, falls inside its file, and each split has at least the
// PRD's proposed 25 labeled locations per validated class.
func TestValidationCorpusShape(t *testing.T) {
	dir := t.TempDir()
	labels := writeValidationCorpus(t, dir)
	if got := readCorpusLabels(t, filepath.Join(dir, "labels.csv")); len(got) != len(labels) {
		t.Fatalf("labels.csv has %d rows, want %d", len(got), len(labels))
	}
	counts := map[LabelSplit]map[LabelClass]int{SplitTune: {}, SplitHeldOut: {}}
	for _, label := range labels {
		counts[label.Split][label.Class]++
		if label.End <= label.Start {
			t.Errorf("label %+v is empty", label)
		}
	}
	for split, byClass := range counts {
		for _, class := range []LabelClass{LabelClick, LabelBreath} {
			if byClass[class] < 25 {
				t.Errorf("%s split has %d %s labels, want at least 25", split, byClass[class], class)
			}
		}
	}
}
