package measure

import "math"

const (
	// tapsPerPhase sets the interpolation filter length (factor x taps in
	// total). Sixteen taps with a Kaiser window keep the passband flat well
	// past the frequencies narration contains.
	tapsPerPhase = 16
	kaiserBeta   = 8.0

	// BS.1770 Annex 2 asks for 4x oversampling at 48 kHz and below, 2x up
	// to 96 kHz, and none above that.
	fourTimesMaxRate = 50000
	twoTimesMaxRate  = 100000
)

// oversampleFactor picks the interpolation factor for a sample rate.
func oversampleFactor(rate int) int {
	switch {
	case rate <= fourTimesMaxRate:
		return 4
	case rate <= twoTimesMaxRate:
		return 2
	default:
		return 1
	}
}

// truePeakMeter tracks sample peak and inter-sample (true) peak per BS.1770
// by reconstructing the waveform with a polyphase windowed-sinc interpolator.
// True peak is never reported below sample peak.
type truePeakMeter struct {
	factor  int
	phases  [][]float64 // phases[p][k] multiplies the sample k frames back
	gain    float64     // largest absolute tap sum of any phase: bounds an output
	history [][]float64 // last tapsPerPhase-1 samples of each channel

	samplePeak float64
	truePeak   float64
}

func newTruePeakMeter(rate, channels int) *truePeakMeter {
	m := &truePeakMeter{factor: oversampleFactor(rate), history: make([][]float64, channels)}
	for c := range m.history {
		m.history[c] = make([]float64, tapsPerPhase-1)
	}
	if m.factor > 1 {
		m.phases, m.gain = interpolationPhases(m.factor)
	}
	return m
}

// interpolationPhases designs the filter and splits it into polyphase
// branches. Phase 0 lands exactly on the original sample grid; the others
// fall between samples at 1/factor spacing.
func interpolationPhases(factor int) (phases [][]float64, gain float64) {
	length := factor * tapsPerPhase
	center := float64(length) / 2
	taps := make([]float64, length)
	for i := range taps {
		x := (float64(i) - center) / float64(factor)
		taps[i] = float64(factor) * sinc(x) * kaiser(float64(i), center)
	}
	// Normalise so each branch has unity DC gain.
	phases = make([][]float64, factor)
	for p := range phases {
		phases[p] = make([]float64, tapsPerPhase)
		sum, abs := 0.0, 0.0
		for k := 0; k < tapsPerPhase; k++ {
			phases[p][k] = taps[p+k*factor]
			sum += phases[p][k]
		}
		for k := range phases[p] {
			phases[p][k] /= sum
			abs += math.Abs(phases[p][k])
		}
		gain = math.Max(gain, abs)
	}
	return phases, gain
}

func sinc(x float64) float64 {
	if x == 0 {
		return 1
	}
	return math.Sin(math.Pi*x) / (math.Pi * x)
}

// kaiser evaluates a Kaiser window of half-width center at position i.
func kaiser(i, center float64) float64 {
	r := (i - center) / center
	return bessel0(kaiserBeta*math.Sqrt(math.Max(0, 1-r*r))) / bessel0(kaiserBeta)
}

// bessel0 is the zeroth-order modified Bessel function of the first kind.
func bessel0(x float64) float64 {
	sum, term := 1.0, 1.0
	for k := 1; k < 50; k++ {
		term *= (x / (2 * float64(k))) * (x / (2 * float64(k)))
		sum += term
		if term < 1e-12*sum {
			break
		}
	}
	return sum
}

// Add folds one block of per-channel samples into the peaks.
func (m *truePeakMeter) Add(block [][]float64) {
	for c, samples := range block {
		for _, s := range samples {
			m.samplePeak = math.Max(m.samplePeak, math.Abs(s))
		}
		if m.factor > 1 {
			m.addOversampled(c, samples)
		}
	}
	m.truePeak = math.Max(m.truePeak, m.samplePeak)
}

func (m *truePeakMeter) addOversampled(channel int, samples []float64) {
	carried := len(m.history[channel])
	extended := make([]float64, 0, carried+len(samples))
	extended = append(extended, m.history[channel]...)
	extended = append(extended, samples...)

	for i := range samples {
		newest := i + carried
		windowMax := 0.0
		for k := 0; k < tapsPerPhase; k++ {
			windowMax = math.Max(windowMax, math.Abs(extended[newest-k]))
		}
		// No interpolated value can exceed windowMax * gain, so windows that
		// cannot beat the running peak are skipped without filtering.
		if windowMax*m.gain <= m.truePeak {
			continue
		}
		for _, phase := range m.phases {
			y := 0.0
			for k, h := range phase {
				y += h * extended[newest-k]
			}
			m.truePeak = math.Max(m.truePeak, math.Abs(y))
		}
	}
	copy(m.history[channel], extended[len(extended)-carried:])
}

// Flush drains the interpolator by feeding it the silence that follows the
// audio. The filter output is delayed by half its length, so without this the
// last few inter-sample intervals are never evaluated and a clip cut off at a
// peak would read low. Call it once, after the final Add.
func (m *truePeakMeter) Flush() {
	if m.factor == 1 {
		return
	}
	tail := make([]float64, tapsPerPhase/2)
	for c := range m.history {
		m.addOversampled(c, tail)
	}
}

// SamplePeak is the largest absolute sample seen, as linear amplitude.
func (m *truePeakMeter) SamplePeak() float64 { return m.samplePeak }

// TruePeak is the largest reconstructed absolute value, as linear amplitude.
func (m *truePeakMeter) TruePeak() float64 { return m.truePeak }
