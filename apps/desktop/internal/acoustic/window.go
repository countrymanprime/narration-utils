package acoustic

import "math"

// hannWindow returns the n-point Hann window (0.5 - 0.5*cos(2*pi*i/(n-1))),
// matching numpy.hanning, which the trial windowed every frame with before
// autocorrelation and the FFT.
func hannWindow(n int) []float64 {
	w := make([]float64, n)
	if n == 1 {
		w[0] = 1
		return w
	}
	for i := range w {
		w[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(n-1))
	}
	return w
}
