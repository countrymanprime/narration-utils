package acoustic

// bandLowHz and bandMidHz are the coarse spectral summary's band edges,
// matching the trial (features_baseline.py _spectral_bands): low is
// [0, bandLowHz), mid is [bandLowHz, bandMidHz), high is everything at or
// above bandMidHz up to Nyquist.
const (
	bandLowHz = 1000.0
	bandMidHz = 3000.0
)

// spectralBands returns frame's spectral centroid (Hz) and the fraction of
// its power in three bands: low (<1 kHz), mid (1-3 kHz) and high (>=3 kHz).
// The frame is Hann-windowed then zero-padded to the next power of two for
// this package's hand-rolled FFT (fft.go) - a coarser frequency-bin spacing
// than the trial's exact-length numpy.fft.rfft, but the same feature shape,
// exactly as Q1's decision anticipates ("a shipped Go build would hand-roll
// the FFT itself... the trial only needs the same shape of feature, not the
// same code").
func spectralBands(frame []float64, sampleRate int) (centroidHz, low, mid, high float64) {
	n := len(frame)
	window := hannWindow(n)
	padded := nextPow2(n)
	spectrumInput := make([]complex128, padded)
	for i, s := range frame {
		spectrumInput[i] = complex(s*window[i], 0)
	}
	spectrum := fft(spectrumInput)

	bins := padded/2 + 1
	totalPower := 1e-12
	weightedFreq := 0.0
	var lowPower, midPower, highPower float64
	for k := 0; k < bins; k++ {
		freq := float64(k) * float64(sampleRate) / float64(padded)
		re, im := real(spectrum[k]), imag(spectrum[k])
		power := re*re + im*im
		totalPower += power
		weightedFreq += freq * power
		switch {
		case freq < bandLowHz:
			lowPower += power
		case freq < bandMidHz:
			midPower += power
		default:
			highPower += power
		}
	}
	return weightedFreq / totalPower, lowPower / totalPower, midPower / totalPower, highPower / totalPower
}
