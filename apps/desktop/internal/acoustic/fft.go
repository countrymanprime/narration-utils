package acoustic

import (
	"math"
	"math/cmplx"
)

// fft computes the discrete Fourier transform of x by recursive radix-2
// Cooley-Tukey. len(x) must be a power of two; spectralBands zero-pads to
// nextPow2 before calling it. Hand-rolled because the repository has no DSP
// or numerics dependency (ADR 0008 keeps it that way) and Q1
// (docs/research/character-continuity-acoustic-trial.md) adopted
// dependency-free Go features for exactly this reason - the trial's own
// Python used numpy.fft only to decide whether the feature design works,
// not as the shipped implementation.
func fft(x []complex128) []complex128 {
	n := len(x)
	if n == 1 {
		return []complex128{x[0]}
	}
	even := make([]complex128, n/2)
	odd := make([]complex128, n/2)
	for i := 0; i < n/2; i++ {
		even[i] = x[2*i]
		odd[i] = x[2*i+1]
	}
	evenSpectrum := fft(even)
	oddSpectrum := fft(odd)

	out := make([]complex128, n)
	for k := 0; k < n/2; k++ {
		twiddle := cmplx.Exp(complex(0, -2*math.Pi*float64(k)/float64(n))) * oddSpectrum[k]
		out[k] = evenSpectrum[k] + twiddle
		out[k+n/2] = evenSpectrum[k] - twiddle
	}
	return out
}

// nextPow2 returns the smallest power of two that is >= n. n must be >= 1.
func nextPow2(n int) int {
	p := 1
	for p < n {
		p <<= 1
	}
	return p
}
