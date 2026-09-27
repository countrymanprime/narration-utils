// Package acoustic implements Phase 4 of
// docs/prds/character-continuity-review.prd.md: a dependency-free,
// range-limited feature extraction engine (pitch, speaking rate, energy and
// a coarse spectral summary) matching Open Question Q1's adopted decision
// (docs/research/character-continuity-acoustic-trial.md, option A). It
// consumes measure.Range so a candidate audio range means the same whole
// number of frames here as it does in the measure package (and to any
// future TR-8 shared range API), without depending on measure's unexported
// conversion.
//
// This package produces features only. It never reads or writes
// approvals, baselines or findings - those are Phase 5 and later.
package acoustic

import (
	"fmt"
	"io"
	"math"
	"os"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const (
	// minF0Hz and maxF0Hz bound the autocorrelation pitch search, matching
	// the trial's range (features_baseline.py MIN_F0/MAX_F0).
	minF0Hz = 60.0
	maxF0Hz = 400.0

	// voicedEnergyPercentile: frames whose RMS falls at or below this
	// percentile of the clip's own frame RMS distribution are treated as
	// unvoiced/silence (features_baseline.py VOICED_ENERGY_PERCENTILE).
	voicedEnergyPercentile = 40.0

	// minVoicedRMS floors the voiced threshold so a digitally silent clip
	// (RMS 0 throughout) never has some frames read as "voiced" purely
	// because they equal the (also zero) percentile.
	minVoicedRMS = 1e-4

	// pitchConfidenceMin is the minimum normalized autocorrelation peak
	// accepted as a pitch reading; below it, a frame contributes no F0 value
	// rather than a fabricated one.
	pitchConfidenceMin = 0.3
)

// FeatureVersion identifies the algorithm and Features shape this package
// produces. Phase 5's derived-features cache keys on it alongside source
// identity and range, so a future change to this package's math or fields
// invalidates old cache entries instead of silently mixing with them. Bump
// it whenever Extract's output would differ for the same input.
const FeatureVersion = 1

// Features is the explainable, per-clip acoustic summary Extract produces.
// Every field is a plain measurement with no learned model behind it, per
// the PRD's "neutral measurement" requirement; nil pointer fields mean the
// value could not be measured (never a fabricated number - PRD Phase 4
// success signal "failure cases return null").
type Features struct {
	// VoicedFraction is the share of analysis frames classed as voiced
	// (RMS above the clip's own energy percentile). 0 for a clip with no
	// voiced frames at all, including one too short to yield a single
	// frame.
	VoicedFraction float64 `json:"voicedFraction"`

	// F0MedianHz, F0P10Hz and F0P90Hz summarize the pitch distribution
	// across voiced frames with a confident autocorrelation peak. All
	// three are nil together when no frame produced a confident reading.
	F0MedianHz *float64 `json:"f0MedianHz,omitempty"`
	F0P10Hz    *float64 `json:"f0P10Hz,omitempty"`
	F0P90Hz    *float64 `json:"f0P90Hz,omitempty"`

	// OctaveAmbiguousFraction is the share of accepted F0 readings within
	// 3% of exactly double or half the clip's own F0 median: the
	// hand-written tracker's documented octave-error failure mode
	// (docs/research/character-continuity-acoustic-trial.md), quantified
	// as a confidence signal for Phase 5 rather than corrected here. 0
	// when there are no F0 readings to compare.
	OctaveAmbiguousFraction float64 `json:"octaveAmbiguousFraction"`

	// RateVoicedRunsPerSecond is the count of voiced/unvoiced transitions
	// into a voiced run, divided by the clip's duration: the coarse
	// speaking-rate fallback the PRD anticipates for Phase 4 (Phase 5's
	// baseline can prefer TR-3's aligned-word rate once that lands).
	RateVoicedRunsPerSecond float64 `json:"rateVoicedRunsPerSecond"`

	// RMSMean and RMSStd summarize frame RMS energy across every analysis
	// frame (voiced and unvoiced alike, matching the trial).
	RMSMean float64 `json:"rmsMean"`
	RMSStd  float64 `json:"rmsStd"`

	// SpectralCentroidHz and the three band fractions summarize the
	// coarse spectral shape, averaged across voiced frames only. All four
	// are 0 when there are no voiced frames.
	SpectralCentroidHz float64 `json:"spectralCentroidHz"`
	BandLowFraction    float64 `json:"bandLowFraction"`
	BandMidFraction    float64 `json:"bandMidFraction"`
	BandHighFraction   float64 `json:"bandHighFraction"`
}

// Extract computes Features from the WAV audio read from r, limited to rng
// if it is not nil (the whole stream otherwise). Stereo input is downmixed
// to mono (per-frame channel average) before analysis: pitch, rate and
// spectral shape describe one voice, not a channel, and ADR 0025 already
// limits this repository's audio handling to mono and stereo.
//
// A range whose start is past the end of the audio, or a clip shorter than
// one analysis frame (40 ms), yields the zero Features value: honestly
// nothing to measure, not an error.
func Extract(r io.Reader, rng *measure.Range) (Features, error) {
	mono, sampleRate, duration, err := readMonoRange(r, rng)
	if err != nil {
		return Features{}, err
	}
	return extractFromSamples(mono, sampleRate, duration), nil
}

// ExtractFile is Extract reading from the WAV file at path.
func ExtractFile(path string, rng *measure.Range) (Features, error) {
	file, err := os.Open(path)
	if err != nil {
		return Features{}, err
	}
	defer func() { _ = file.Close() }() // read-only

	features, err := Extract(file, rng)
	if err != nil {
		return Features{}, fmt.Errorf("%s: %w", path, err)
	}
	return features, nil
}

// extractFromSamples runs the trial's feature design
// (features_baseline.py) over already-decoded mono samples.
func extractFromSamples(mono []float64, sampleRate int, duration float64) Features {
	frames, _, _ := frameSignal(mono, sampleRate)
	if len(frames) == 0 {
		return Features{}
	}

	frameRMS := make([]float64, len(frames))
	for i, frame := range frames {
		frameRMS[i] = rms(frame)
	}
	threshold := math.Max(percentile(frameRMS, voicedEnergyPercentile), minVoicedRMS)

	voicedMask := make([]bool, len(frames))
	var f0Values, centroids, lows, mids, highs []float64
	voicedCount := 0
	for i, frame := range frames {
		// >= rather than a strict >: a frame exactly at the threshold is
		// still "at or above" the quiet/loud split, and matters for audio
		// whose frame RMS is highly uniform (a sustained tone whose period
		// evenly divides the frame length gives every full-amplitude frame
		// the same RMS, which then equals its own 40th percentile).
		voiced := frameRMS[i] >= threshold
		voicedMask[i] = voiced
		if !voiced {
			continue
		}
		voicedCount++
		if f0, ok := autocorrelationF0(frame, sampleRate); ok {
			f0Values = append(f0Values, f0)
		}
		centroid, low, mid, high := spectralBands(frame, sampleRate)
		centroids = append(centroids, centroid)
		lows = append(lows, low)
		mids = append(mids, mid)
		highs = append(highs, high)
	}

	features := Features{
		VoicedFraction:     float64(voicedCount) / float64(len(frames)),
		RMSMean:            mean(frameRMS),
		RMSStd:             stddev(frameRMS),
		SpectralCentroidHz: mean(centroids),
		BandLowFraction:    mean(lows),
		BandMidFraction:    mean(mids),
		BandHighFraction:   mean(highs),
	}
	if duration > 0 {
		features.RateVoicedRunsPerSecond = float64(countVoicedRuns(voicedMask)) / duration
	}
	if len(f0Values) > 0 {
		median := percentile(f0Values, 50)
		p10 := percentile(f0Values, 10)
		p90 := percentile(f0Values, 90)
		features.F0MedianHz = &median
		features.F0P10Hz = &p10
		features.F0P90Hz = &p90
		features.OctaveAmbiguousFraction = octaveAmbiguousFraction(f0Values, median)
	}
	return features
}

// countVoicedRuns counts rising edges (unvoiced-to-voiced transitions) in
// mask, matching the trial's voiced-run count
// (np.diff(...) == 1, features_baseline.py).
func countVoicedRuns(mask []bool) int {
	runs := 0
	prev := false
	for _, voiced := range mask {
		if voiced && !prev {
			runs++
		}
		prev = voiced
	}
	return runs
}
