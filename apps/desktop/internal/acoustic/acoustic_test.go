package acoustic

import (
	"bytes"
	"math"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const testRate = 16000

func extractSamples(t *testing.T, rate int, mono []float64) Features {
	t.Helper()
	wav := encodeWAV(t, 1, rate, mono)
	features, err := Extract(bytes.NewReader(wav), nil)
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	return features
}

func TestExtractOnDigitalSilenceFindsNoPitchAndNoVoicedActivity(t *testing.T) {
	features := extractSamples(t, testRate, silence(testRate, 2))
	if features.F0MedianHz != nil {
		t.Fatalf("F0MedianHz = %v, want nil (silence has no pitch)", *features.F0MedianHz)
	}
	within(t, "VoicedFraction", features.VoicedFraction, 0, 0)
	within(t, "RateVoicedRunsPerSecond", features.RateVoicedRunsPerSecond, 0, 0)
	within(t, "RMSMean", features.RMSMean, 0, 1e-9)
}

func TestExtractRecoversKnownFrequenciesOfAPureTone(t *testing.T) {
	tests := []struct {
		name string
		freq float64
	}{
		{"low of range", 120},
		{"mid of range", 200},
		{"high of range", 300},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			features := extractSamples(t, testRate, sine(testRate, 2, tt.freq, -10))
			if features.F0MedianHz == nil {
				t.Fatalf("F0MedianHz = nil, want ~%.0f Hz", tt.freq)
			}
			// Autocorrelation lag is quantized to whole samples, and a
			// frame this short only spans a handful of periods at the low
			// end of the search range, so the discrete peak can sit a lag
			// or two from the true one (the trial's own documented
			// octave/resolution risk) - allow a tolerance that widens with
			// the underlying per-lag resolution, floored generously.
			tolerance := math.Max(3, tt.freq*tt.freq/testRate)
			within(t, "F0MedianHz", *features.F0MedianHz, tt.freq, tolerance)
			// The voicing gate is a relative (percentile) threshold, not an
			// absolute level check, so even a constant-amplitude tone
			// leaves its own quietest frames (natural RMS variance from
			// partial periods at the frame edges) below the cut: a
			// majority voiced, not necessarily near-total.
			if features.VoicedFraction < 0.5 {
				t.Fatalf("VoicedFraction = %.4f, want at least 0.5 for a sustained tone", features.VoicedFraction)
			}
			within(t, "OctaveAmbiguousFraction", features.OctaveAmbiguousFraction, 0, 1e-9)
		})
	}
}

func TestExtractCountsSpeakingRateFromVoicedRuns(t *testing.T) {
	const runs = 4
	tone := sine(testRate, 0.4, 180, -10)
	gap := silence(testRate, 0.35)
	var parts [][]float64
	for i := 0; i < runs; i++ {
		parts = append(parts, tone, gap)
	}
	clip := concat(parts...)
	duration := float64(len(clip)) / testRate

	features := extractSamples(t, testRate, clip)
	gotRuns := features.RateVoicedRunsPerSecond * duration
	within(t, "voiced runs", gotRuns, runs, 1)
}

func TestExtractSpectralBandsReflectFrequencyContent(t *testing.T) {
	low := extractSamples(t, testRate, sine(testRate, 1, 150, -10))
	high := extractSamples(t, testRate, sine(testRate, 1, 3800, -10))

	if low.BandLowFraction <= low.BandHighFraction {
		t.Fatalf("a 150 Hz tone should read mostly low-band: low=%.3f high=%.3f", low.BandLowFraction, low.BandHighFraction)
	}
	if high.BandHighFraction <= high.BandLowFraction {
		t.Fatalf("a 3800 Hz tone should read mostly high-band: low=%.3f high=%.3f", high.BandLowFraction, high.BandHighFraction)
	}
	if high.SpectralCentroidHz <= low.SpectralCentroidHz {
		t.Fatalf("spectral centroid should rise with frequency: low=%.1f high=%.1f", low.SpectralCentroidHz, high.SpectralCentroidHz)
	}
}

func TestExtractDownmixesStereoBeforeAnalysis(t *testing.T) {
	mono := sine(testRate, 1.5, 220, -10)
	stereoSame := interleave(mono, mono)
	wav := encodeWAV(t, 2, testRate, stereoSame)

	stereoFeatures, err := Extract(bytes.NewReader(wav), nil)
	if err != nil {
		t.Fatalf("Extract stereo: %v", err)
	}
	monoFeatures := extractSamples(t, testRate, mono)

	if stereoFeatures.F0MedianHz == nil || monoFeatures.F0MedianHz == nil {
		t.Fatalf("F0MedianHz: stereo=%v mono=%v, want both measured", stereoFeatures.F0MedianHz, monoFeatures.F0MedianHz)
	}
	within(t, "stereo vs mono F0", *stereoFeatures.F0MedianHz, *monoFeatures.F0MedianHz, 1)
}

func TestExtractOnAClipShorterThanOneFrameIsTheZeroValue(t *testing.T) {
	// 40 ms frame at 16 kHz is 640 samples; 10 is nowhere close.
	features := extractSamples(t, testRate, make([]float64, 10))
	if features != (Features{}) {
		t.Fatalf("Features = %+v, want the zero value", features)
	}
}

func TestExtractOnAnEmptyRangePastEndOfAudioIsTheZeroValue(t *testing.T) {
	wav := encodeWAV(t, 1, testRate, sine(testRate, 1, 200, -10))
	features, err := Extract(bytes.NewReader(wav), &measure.Range{StartSeconds: 5, LengthSeconds: 1})
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	if features != (Features{}) {
		t.Fatalf("Features = %+v, want the zero value for a range entirely past the end", features)
	}
}

func TestExtractRangeLimitsAnalysisToTheGivenSpan(t *testing.T) {
	firstHalf := sine(testRate, 2, 150, -10)
	secondHalf := sine(testRate, 2, 320, -10)
	wav := encodeWAV(t, 1, testRate, concat(firstHalf, secondHalf))

	whole, err := Extract(bytes.NewReader(wav), nil)
	if err != nil {
		t.Fatalf("Extract whole: %v", err)
	}
	second, err := Extract(bytes.NewReader(wav), &measure.Range{StartSeconds: 2, LengthSeconds: 2})
	if err != nil {
		t.Fatalf("Extract second half: %v", err)
	}
	first, err := Extract(bytes.NewReader(wav), &measure.Range{StartSeconds: 0, LengthSeconds: 2})
	if err != nil {
		t.Fatalf("Extract first half: %v", err)
	}

	if first.F0MedianHz == nil || second.F0MedianHz == nil || whole.F0MedianHz == nil {
		t.Fatalf("expected pitch in all three reads: whole=%v first=%v second=%v", whole.F0MedianHz, first.F0MedianHz, second.F0MedianHz)
	}
	within(t, "first-half F0", *first.F0MedianHz, 150, 3)
	within(t, "second-half F0", *second.F0MedianHz, 320, 4)
	if *first.F0MedianHz == *second.F0MedianHz {
		t.Fatalf("first and second half read the same F0 (%.1f); range limiting is not taking effect", *first.F0MedianHz)
	}
}

func TestExtractRejectsAnInvalidRange(t *testing.T) {
	wav := encodeWAV(t, 1, testRate, sine(testRate, 1, 200, -10))
	tests := []measure.Range{
		{StartSeconds: -1, LengthSeconds: 1},
		{StartSeconds: 0, LengthSeconds: 0},
		{StartSeconds: 0, LengthSeconds: -1},
	}
	for _, rng := range tests {
		if _, err := Extract(bytes.NewReader(wav), &rng); err == nil {
			t.Errorf("Extract(%+v) = nil error, want an error", rng)
		}
	}
}

func TestExtractOnNonWAVDataIsAnError(t *testing.T) {
	if _, err := Extract(bytes.NewReader([]byte("not a wav file")), nil); err == nil {
		t.Fatal("Extract on non-WAV data = nil error, want an error")
	}
}

func TestExtractTracksAFrequencySweepNearEachRange(t *testing.T) {
	// A slow sweep from 100 Hz to 350 Hz over 6 seconds: within any one
	// 1-second range the instantaneous frequency moves by well under
	// 50 Hz, so the per-range median should land near the sweep's value at
	// the range's midpoint.
	clip := sweep(testRate, 6, 100, 350, -10)
	wav := encodeWAV(t, 1, testRate, clip)

	tests := []struct {
		name      string
		start     float64
		wantAtMid float64
	}{
		{"near the start", 0, 100 + (350-100)*0.5/6},
		{"in the middle", 2.5, 100 + (350-100)*3.0/6},
		{"near the end", 5, 100 + (350-100)*5.5/6},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			features, err := Extract(bytes.NewReader(wav), &measure.Range{StartSeconds: tt.start, LengthSeconds: 1})
			if err != nil {
				t.Fatalf("Extract: %v", err)
			}
			if features.F0MedianHz == nil {
				t.Fatal("F0MedianHz = nil, want a tracked sweep frequency")
			}
			within(t, "swept F0", *features.F0MedianHz, tt.wantAtMid, 15)
		})
	}
}

func TestFeatureVersionIsStable(t *testing.T) {
	// Documents the current value so a change is a deliberate edit (and a
	// reminder to bump it) rather than a silent renumbering.
	if FeatureVersion != 1 {
		t.Fatalf("FeatureVersion = %d; if this is an intentional algorithm change, this assertion should be updated alongside it", FeatureVersion)
	}
}
