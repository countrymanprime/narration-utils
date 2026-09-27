package acoustic

import (
	"math"
	"testing"
)

func TestAutocorrelationF0OnSilentFrameIsUnavailable(t *testing.T) {
	frame := make([]float64, int(testRate*frameMS/1000))
	if _, ok := autocorrelationF0(frame, testRate); ok {
		t.Fatal("autocorrelationF0 on silence = ok, want unavailable")
	}
}

func TestAutocorrelationF0OnAToneWithAStrongFirstHarmonicCanLockOntoIt(t *testing.T) {
	// The trial's own risk note (breathy voice, octave errors): a tone with
	// a weak fundamental and a dominant first harmonic is a known way to
	// make an autocorrelation tracker lock onto the harmonic instead. This
	// documents the failure mode quantitatively rather than asserting it
	// never happens.
	const fundamental = 150.0
	frameLen := int(testRate * frameMS / 1000)
	frame := make([]float64, frameLen)
	for i := range frame {
		phase := 2 * math.Pi * float64(i) / testRate
		frame[i] = 0.1*math.Sin(phase*fundamental) + 0.9*math.Sin(phase*2*fundamental)
	}
	f0, ok := autocorrelationF0(frame, testRate)
	if !ok {
		t.Fatal("autocorrelationF0 = unavailable, want a (possibly wrong) reading")
	}
	// It should read close to either the fundamental or its double - not
	// some unrelated value - demonstrating the octave-error mode is bounded
	// to that specific ambiguity rather than arbitrary noise.
	if !withinTolerance(f0/fundamental, 1, 0.1) && !withinTolerance(f0/fundamental, 2, 0.1) {
		t.Fatalf("f0 = %.1f Hz, want close to %.0f or %.0f (the fundamental or its octave)", f0, fundamental, 2*fundamental)
	}
}

func TestOctaveAmbiguousFractionFlagsExactDoublesAndHalves(t *testing.T) {
	median := 150.0
	values := []float64{150, 150.1, 300, 300.5, 75, 74.8, 220} // last one is not near double/half
	got := octaveAmbiguousFraction(values, median)
	want := 4.0 / 7.0 // 300, 300.5, 75, 74.8 are within tolerance; 220 is not
	within(t, "OctaveAmbiguousFraction", got, want, 1e-9)
}

func TestOctaveAmbiguousFractionOnEmptyInputIsZero(t *testing.T) {
	if got := octaveAmbiguousFraction(nil, 150); got != 0 {
		t.Fatalf("octaveAmbiguousFraction(nil, ...) = %v, want 0", got)
	}
	if got := octaveAmbiguousFraction([]float64{100}, 0); got != 0 {
		t.Fatalf("octaveAmbiguousFraction(_, 0) = %v, want 0", got)
	}
}
