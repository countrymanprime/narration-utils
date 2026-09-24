package measure

import (
	"bytes"
	"context"
	"math"
	"math/rand/v2"
	"testing"
)

// Diagnostics fixtures are generated in code, deterministically: a "read"
// is phrases of a tone over room tone (seeded white noise), separated by
// pauses of room tone alone, with one timed word per phrase.

const (
	fixtureRate      = 48000
	fixtureBits      = 24
	phraseSeconds    = 1.5
	pauseSeconds     = 0.5
	phrasePeakDB     = -14
	fixtureToneDB    = -65
	fixtureFadeFrame = 960 // 20 ms
)

// roomTone is seeded white noise with the given RMS in dBFS: a uniform
// distribution on [-a, a] has an RMS of a/sqrt(3).
func roomTone(rate int, seconds, rmsDB float64, seed uint64) []float64 {
	random := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	amplitude := dbToAmp(rmsDB) * math.Sqrt(3)
	out := make([]float64, int(math.Round(seconds*float64(rate))))
	for i := range out {
		out[i] = amplitude * (2*random.Float64() - 1)
	}
	return out
}

// readSpec describes one stretch of a generated read.
type readSpec struct {
	phrases int
	peakDB  float64 // phrase level
	toneDB  float64 // room tone under everything
	seed    uint64
}

// narration builds a read of phrase-then-pause cycles and returns the
// samples with one word per phrase, timed from the start of the audio.
func narration(offset float64, spec readSpec) ([]float64, []Word) {
	var samples []float64
	var words []Word
	for i := 0; i < spec.phrases; i++ {
		start := offset + float64(i)*(phraseSeconds+pauseSeconds)
		phrase := fadeInOut(sine(fixtureRate, phraseSeconds, 220, spec.peakDB, 0), fixtureFadeFrame)
		samples = append(samples, phrase...)
		samples = append(samples, silence(fixtureRate, pauseSeconds)...)
		words = append(words, Word{Text: "word", StartSeconds: start, EndSeconds: start + phraseSeconds})
	}
	return mix(samples, roomTone(fixtureRate, float64(len(samples))/fixtureRate, spec.toneDB, spec.seed)), words
}

// mix sums b into a copy of a; b must be at least as long as a.
func mix(a, b []float64) []float64 {
	out := make([]float64, len(a))
	for i := range a {
		out[i] = a[i] + b[i]
	}
	return out
}

// cleanRead is 20 s of an even read: ten phrases and ten pauses.
func cleanRead() ([]float64, []Word) {
	return narration(0, readSpec{phrases: 10, peakDB: phrasePeakDB, toneDB: fixtureToneDB, seed: 1})
}

func encodeFixture(t testing.TB, samples []float64) []byte {
	t.Helper()
	return encodeWAV(t, 1, fixtureRate, fixtureBits, false, samples)
}

func rawInput() DiagnosticInput {
	return DiagnosticInput{SourceKind: SourceRawRecording, Options: DefaultDiagnosticOptions()}
}

func diagnoseBytes(t *testing.T, raw []byte, in DiagnosticInput) Diagnostics {
	t.Helper()
	result, err := Diagnose(context.Background(), bytes.NewReader(raw), in)
	if err != nil {
		t.Fatalf("Diagnose: %v", err)
	}
	return result
}
