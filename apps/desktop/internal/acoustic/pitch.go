package acoustic

import "math"

// autocorrelationF0 is the minimal autocorrelation pitch tracker the trial
// used and recommended (Q1 option A, features_baseline.py
// _autocorrelation_f0): a classic, explainable baseline with a documented
// octave-error failure mode (locking onto a harmonic or sub-harmonic of the
// true pitch) that this package quantifies via OctaveAmbiguousFraction
// rather than eliminating. frame is one already frame-length slice of
// mono audio; ok is false when the frame is effectively silent or no lag
// in [minF0Hz, maxF0Hz) reaches the confidence floor.
func autocorrelationF0(frame []float64, sampleRate int) (hz float64, ok bool) {
	n := len(frame)
	window := hannWindow(n)
	windowed := make([]float64, n)
	for i, s := range frame {
		windowed[i] = s * window[i]
	}

	energy0 := 0.0
	for _, v := range windowed {
		energy0 += v * v
	}
	if energy0 <= 1e-9 {
		return 0, false
	}

	lagMin := int(float64(sampleRate) / maxF0Hz)
	lagMax := min(int(float64(sampleRate)/minF0Hz), n-1)
	if lagMax <= lagMin {
		return 0, false
	}

	bestLag, bestCorr := -1, -1.0
	for lag := lagMin; lag < lagMax; lag++ {
		sum := 0.0
		for i := 0; i < n-lag; i++ {
			sum += windowed[i] * windowed[i+lag]
		}
		corr := sum / energy0
		if corr > bestCorr {
			bestCorr, bestLag = corr, lag
		}
	}
	if bestLag < 0 || bestCorr < pitchConfidenceMin {
		return 0, false
	}
	return float64(sampleRate) / float64(bestLag), true
}

// octaveTolerance is how close a reading must be to exactly double or half
// the clip's median F0 to count as octave-ambiguous: a narrow band around
// the classic error ratios, not a general "far from the median" flag.
const octaveTolerance = 0.03

// octaveAmbiguousFraction reports the fraction of f0Values within
// octaveTolerance of being exactly double or half median: the
// hand-written tracker's known failure mode
// (docs/research/character-continuity-acoustic-trial.md "Hand-written pitch
// tracker is unreliable"), surfaced as a confidence signal for Phase 5 - the
// readings themselves are left unchanged, never corrected here.
func octaveAmbiguousFraction(f0Values []float64, median float64) float64 {
	if len(f0Values) == 0 || median <= 0 {
		return 0
	}
	ambiguous := 0
	for _, f := range f0Values {
		ratio := f / median
		if withinTolerance(ratio, 2, octaveTolerance) || withinTolerance(ratio, 0.5, octaveTolerance) {
			ambiguous++
		}
	}
	return float64(ambiguous) / float64(len(f0Values))
}

func withinTolerance(v, target, tolerance float64) bool {
	return math.Abs(v-target) <= target*tolerance
}
