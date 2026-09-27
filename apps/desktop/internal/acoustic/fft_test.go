package acoustic

import (
	"math"
	"testing"
)

func TestNextPow2(t *testing.T) {
	tests := map[int]int{1: 1, 2: 2, 3: 4, 640: 1024, 1024: 1024, 1025: 2048, 1920: 2048}
	for n, want := range tests {
		if got := nextPow2(n); got != want {
			t.Errorf("nextPow2(%d) = %d, want %d", n, got, want)
		}
	}
}

// TestFFTLocatesASingleBinSinusoid is an analytic-signal test: a sinusoid at
// exactly bin k of an N-point DFT should produce a spectrum with essentially
// all its energy at bin k (and, for a real input, its mirror at N-k), per
// the standard DFT sifting property.
func TestFFTLocatesASingleBinSinusoid(t *testing.T) {
	const n = 64
	const k = 5
	x := make([]complex128, n)
	for i := range x {
		x[i] = complex(math.Cos(2*math.Pi*k*float64(i)/n), 0)
	}
	spectrum := fft(x)

	peakBin, peakMag := -1, 0.0
	for i, c := range spectrum {
		mag := math.Hypot(real(c), imag(c))
		if mag > peakMag {
			peakMag, peakBin = mag, i
		}
	}
	if peakBin != k && peakBin != n-k {
		t.Fatalf("peak bin = %d, want %d or %d (the mirror)", peakBin, k, n-k)
	}
	// Energy should be concentrated: the next-largest bin (other than the
	// two peaks from a real cosine) should be much smaller.
	for i, c := range spectrum {
		if i == k || i == n-k {
			continue
		}
		mag := math.Hypot(real(c), imag(c))
		if mag > peakMag*0.05 {
			t.Fatalf("bin %d has magnitude %.4f, want it small relative to the peak %.4f", i, mag, peakMag)
		}
	}
}

// TestFFTSatisfiesParsevalsTheorem checks total energy is preserved between
// the time and frequency domains (sum|x|^2 * N == sum|X|^2), a
// content-independent correctness property of any correct DFT
// implementation.
func TestFFTSatisfiesParsevalsTheorem(t *testing.T) {
	const n = 32
	x := make([]complex128, n)
	timeEnergy := 0.0
	seed := 1.0
	for i := range x {
		// A simple deterministic pseudo-signal, not actually random -
		// reproducibility matters more than "randomness" here.
		seed = math.Mod(seed*48271, 2147483647)
		v := (seed/2147483647)*2 - 1
		x[i] = complex(v, 0)
		timeEnergy += v * v
	}
	spectrum := fft(x)
	freqEnergy := 0.0
	for _, c := range spectrum {
		freqEnergy += real(c)*real(c) + imag(c)*imag(c)
	}
	within(t, "Parseval's theorem", freqEnergy, timeEnergy*n, timeEnergy*n*1e-9+1e-9)
}

func TestSpectralBandsSumToOne(t *testing.T) {
	frame := sine(testRate, 0.04, 500, -10)
	_, low, mid, high := spectralBands(frame, testRate)
	within(t, "low+mid+high", low+mid+high, 1, 1e-9)
}
