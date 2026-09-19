package measure

import (
	"math"
	"testing"
)

// feedLoudness streams channel data into a meter in odd-sized chunks so
// filter state and block boundaries are exercised across calls.
func feedLoudness(m *loudnessMeter, chunk int, channels ...[]float64) {
	for start := 0; start < len(channels[0]); start += chunk {
		end := min(start+chunk, len(channels[0]))
		block := make([][]float64, len(channels))
		for c := range channels {
			block[c] = channels[c][start:end]
		}
		m.Add(block)
	}
}

func integrated(t *testing.T, rate int, chunk int, channels ...[]float64) *float64 {
	t.Helper()
	m := newLoudnessMeter(rate, len(channels))
	feedLoudness(m, chunk, channels...)
	return m.IntegratedLUFS()
}

func TestKWeightCoefficientsMatchBS1770At48kHz(t *testing.T) {
	shelf, highpass := kWeightCoefficients(48000)
	want := map[string][2]float64{
		"shelf b0":    {shelf.B0, 1.53512485958697},
		"shelf b1":    {shelf.B1, -2.69169618940638},
		"shelf b2":    {shelf.B2, 1.19839281085285},
		"shelf a1":    {shelf.A1, -1.69065929318241},
		"shelf a2":    {shelf.A2, 0.73248077421585},
		"highpass b0": {highpass.B0, 1},
		"highpass b1": {highpass.B1, -2},
		"highpass b2": {highpass.B2, 1},
		"highpass a1": {highpass.A1, -1.99004745483398},
		"highpass a2": {highpass.A2, 0.99007225036621},
	}
	for name, pair := range want {
		if math.Abs(pair[0]-pair[1]) > 1e-8 {
			t.Errorf("%s = %.14f, want %.14f", name, pair[0], pair[1])
		}
	}
}

func TestIntegratedLoudnessOfReferenceSines(t *testing.T) {
	tests := []struct {
		name string
		rate int
		want float64
		make func(rate int) [][]float64
	}{
		{"stereo -23 dBFS peak reads -23 LUFS at 48k", 48000, -23, func(r int) [][]float64 {
			tone := sine(r, 10, 997, -23, 0)
			return [][]float64{tone, tone}
		}},
		{"stereo -23 dBFS peak reads -23 LUFS at 44.1k", 44100, -23, func(r int) [][]float64 {
			tone := sine(r, 10, 997, -23, 0)
			return [][]float64{tone, tone}
		}},
		{"mono full-scale reads -3.01 LUFS", 48000, -3.01, func(r int) [][]float64 {
			return [][]float64{sine(r, 10, 997, 0, 0)}
		}},
		{"stereo -20 dBFS peak reads -20 LUFS at 96k", 96000, -20, func(r int) [][]float64 {
			tone := sine(r, 10, 997, -20, 0)
			return [][]float64{tone, tone}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			within(t, "integrated LUFS", integrated(t, tt.rate, 977, tt.make(tt.rate)...), tt.want, 0.05)
		})
	}
}

func TestIntegratedLoudnessDoesNotDependOnChunkSize(t *testing.T) {
	tone := sine(48000, 6, 500, -25, 0.3)
	a := integrated(t, 48000, 977, tone, tone)
	b := integrated(t, 48000, 48000, tone, tone)
	if a == nil || b == nil || math.Abs(*a-*b) > 1e-9 {
		t.Fatalf("chunked = %v, whole = %v; want identical", a, b)
	}
}

func TestIntegratedLoudnessGatesOutSilenceAndQuietPassages(t *testing.T) {
	loud := sine(48000, 5, 997, -20, 0)
	quiet := sine(48000, 5, 997, -50, 0) // more than 10 LU below the loud part
	digital := silence(48000, 5)

	// Both extra passages sit below the gates, so only the loud part counts.
	// Blocks straddling the boundary add a small bias, hence the tolerance.
	within(t, "quiet passage gated", integrated(t, 48000, 977, concat(loud, quiet), concat(loud, quiet)), -20, 0.25)
	within(t, "silence gated", integrated(t, 48000, 977, concat(loud, digital), concat(loud, digital)), -20, 0.25)
}

func TestIntegratedLoudnessIsUnavailableWhenThereIsNothingToGate(t *testing.T) {
	tests := map[string][]float64{
		"shorter than one 400 ms block": sine(48000, 0.3, 997, -20, 0),
		"digital silence":               silence(48000, 3),
		"entirely below the -70 gate":   sine(48000, 3, 997, -90, 0),
	}
	for name, samples := range tests {
		t.Run(name, func(t *testing.T) {
			if got := integrated(t, 48000, 977, samples, samples); got != nil {
				t.Fatalf("integrated = %v, want unavailable", *got)
			}
		})
	}
}

func TestTruePeakSeesIntersamplePeaksThatSamplesMiss(t *testing.T) {
	// A sine at fs/4 offset by 45 degrees only ever lands on +/-0.7071,
	// but the reconstructed waveform reaches 1.0 (0 dBTP).
	tone := fadeInOut(sine(48000, 1, 12000, 0, math.Pi/4), 4800)

	meter := newTruePeakMeter(48000, 1)
	meter.Add([][]float64{tone})

	if got := 20 * math.Log10(meter.SamplePeak()); math.Abs(got-(-3.0103)) > 0.001 {
		t.Fatalf("sample peak = %.4f dBFS, want -3.0103", got)
	}
	if got := 20 * math.Log10(meter.TruePeak()); math.Abs(got) > 0.1 {
		t.Fatalf("true peak = %.4f dBTP, want about 0", got)
	}
}

func TestTruePeakIsNeverBelowSamplePeakAndSurvivesChunking(t *testing.T) {
	tone := sine(44100, 2, 3000, -6, 0.7)

	whole := newTruePeakMeter(44100, 1)
	whole.Add([][]float64{tone})
	chunked := newTruePeakMeter(44100, 1)
	for start := 0; start < len(tone); start += 333 {
		chunked.Add([][]float64{tone[start:min(start+333, len(tone))]})
	}

	if whole.TruePeak() < whole.SamplePeak() {
		t.Fatalf("true peak %v below sample peak %v", whole.TruePeak(), whole.SamplePeak())
	}
	if math.Abs(whole.TruePeak()-chunked.TruePeak()) > 1e-9 {
		t.Fatalf("chunking changed the result: %v vs %v", whole.TruePeak(), chunked.TruePeak())
	}
}

func TestTruePeakOfStereoTakesTheLouderChannel(t *testing.T) {
	quiet := sine(48000, 1, 1000, -30, 0)
	loud := sine(48000, 1, 1000, -6, 0)
	meter := newTruePeakMeter(48000, 2)
	meter.Add([][]float64{quiet, loud})
	if got := 20 * math.Log10(meter.SamplePeak()); math.Abs(got-(-6)) > 0.05 {
		t.Fatalf("sample peak = %.3f, want the -6 dBFS channel", got)
	}
}

func TestTruePeakOfSilenceIsZeroAmplitude(t *testing.T) {
	meter := newTruePeakMeter(48000, 1)
	meter.Add([][]float64{silence(48000, 1)})
	if meter.SamplePeak() != 0 || meter.TruePeak() != 0 {
		t.Fatalf("silence peaks = %v / %v, want 0", meter.SamplePeak(), meter.TruePeak())
	}
}

func TestHighSampleRatesSkipOversampling(t *testing.T) {
	if got := oversampleFactor(44100); got != 4 {
		t.Errorf("factor(44100) = %d, want 4", got)
	}
	if got := oversampleFactor(96000); got != 2 {
		t.Errorf("factor(96000) = %d, want 2", got)
	}
	if got := oversampleFactor(192000); got != 1 {
		t.Errorf("factor(192000) = %d, want 1", got)
	}
}

func TestTruePeakFlushRevealsAPeakAtTheVeryEndOfTheAudio(t *testing.T) {
	// Two adjacent near-full-scale samples at the end of a hard-cut clip: the
	// reconstructed waveform peaks between them, in the last few intervals the
	// delayed filter has not emitted yet.
	samples := append(silence(48000, 0.5), 0.9, 0.9)

	meter := newTruePeakMeter(48000, 1)
	meter.Add([][]float64{samples})
	meter.Flush()

	if got := meter.TruePeak(); got < 1.05 {
		t.Fatalf("true peak = %v, want the inter-sample peak above 1.05 after Flush", got)
	}
}

func TestTruePeakSkipOptimisationMatchesBruteForce(t *testing.T) {
	// A fast-modulated signal with peaks scattered throughout, so the
	// skip bound is exercised on many windows.
	tone := sine(44100, 3, 5000, -3, 0.4)
	for i := range tone {
		tone[i] *= 0.3 + 0.7*math.Abs(math.Sin(2*math.Pi*7*float64(i)/44100))
	}

	fast := newTruePeakMeter(44100, 1)
	fast.Add([][]float64{tone})
	fast.Flush()

	brute := newTruePeakMeter(44100, 1)
	brute.gain = math.Inf(1) // a bound of +Inf never allows a skip
	brute.Add([][]float64{tone})
	brute.Flush()

	if math.Abs(fast.TruePeak()-brute.TruePeak()) > 1e-12 {
		t.Fatalf("optimised = %.12f, brute force = %.12f", fast.TruePeak(), brute.TruePeak())
	}
}
