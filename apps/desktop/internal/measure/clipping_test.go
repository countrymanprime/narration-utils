package measure

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestClippingCountsFullScaleSamplesAndRunsOfThreeOrMore(t *testing.T) {
	const rate = 8000
	// A run of 4, a pair (full scale but not a clip run), a negative run of 3.
	samples := []float64{0, 1, 1, 1, 1, 0, 1, 1, 0, -1, -1, -1, 0}

	for _, format := range []struct {
		name  string
		bits  int
		float bool
	}{{"16-bit PCM", 16, false}, {"24-bit PCM", 24, false}, {"32-bit PCM", 32, false}, {"32-bit float", 32, true}} {
		t.Run(format.name, func(t *testing.T) {
			report := analyzeBytes(t, encodeWAV(t, 1, rate, format.bits, format.float, samples))

			if report.FullScaleSamples != 9 {
				t.Fatalf("full-scale samples = %d, want 9", report.FullScaleSamples)
			}
			want := []ClipRun{
				{Channel: 0, StartSeconds: 1.0 / rate, DurationSeconds: 4.0 / rate, Samples: 4},
				{Channel: 0, StartSeconds: 9.0 / rate, DurationSeconds: 3.0 / rate, Samples: 3},
			}
			if report.ClipRunCount != 2 || !reflect.DeepEqual(report.ClipRuns, want) {
				t.Fatalf("clip runs = %d %+v, want 2 %+v", report.ClipRunCount, report.ClipRuns, want)
			}
		})
	}
}

func TestClippingJustBelowFullScaleIsNotClipping(t *testing.T) {
	report := analyzeBytes(t, encodeWAV(t, 1, 48000, 24, false, sine(48000, 1, 997, -0.1, 0)))
	if report.FullScaleSamples != 0 || report.ClipRunCount != 0 || len(report.ClipRuns) != 0 {
		t.Fatalf("clipping = %d samples, %d runs; want none at -0.1 dBFS", report.FullScaleSamples, report.ClipRunCount)
	}
}

func TestClippingOfAnOverdrivenSineIsFoundAtEveryCrest(t *testing.T) {
	const rate = 8000
	// A 100 Hz sine at +6 dBFS (peak 2), hard-clipped by the 16-bit
	// encoder: |2 sin x| >= 1 while |sin x| >= 0.5, which is x in
	// [pi/6, 5pi/6], two thirds of every half cycle.
	report := analyzeBytes(t, encodeWAV(t, 1, rate, 16, false, sine(rate, 1, 100, 20*math.Log10(2), 0)))

	if report.ClipRunCount != 200 {
		t.Fatalf("clip runs = %d, want one per crest (200 in 1 s of 100 Hz)", report.ClipRunCount)
	}
	halfPeriod := rate / 200
	wantPerRun := float64(halfPeriod) * 2 / 3
	for _, run := range report.ClipRuns {
		if math.Abs(float64(run.Samples)-wantPerRun) > 2 {
			t.Fatalf("run %+v, want about %.1f samples pinned per crest", run, wantPerRun)
		}
	}
}

func TestClippingRunSpanningReadBlocksAndChannelsIsOneRunPerChannel(t *testing.T) {
	const rate = 8000
	left := make([]float64, 3*readBlockFrames)
	right := make([]float64, 3*readBlockFrames)
	for i := readBlockFrames - 5; i < readBlockFrames+5; i++ {
		right[i] = 1
	}
	report := analyzeBytes(t, encodeWAV(t, 2, rate, 16, false, interleave(left, right)))

	want := []ClipRun{{Channel: 1, StartSeconds: float64(readBlockFrames-5) / rate, DurationSeconds: 10.0 / rate, Samples: 10}}
	if !reflect.DeepEqual(report.ClipRuns, want) {
		t.Fatalf("clip runs = %+v, want %+v", report.ClipRuns, want)
	}
}

func TestClippingRunStillOpenAtTheEndIsReported(t *testing.T) {
	report := analyzeBytes(t, encodeWAV(t, 1, 8000, 32, true, []float64{0, 0, 1.5, -2, 1}))
	want := []ClipRun{{Channel: 0, StartSeconds: 2.0 / 8000, DurationSeconds: 3.0 / 8000, Samples: 3}}
	if report.FullScaleSamples != 3 || !reflect.DeepEqual(report.ClipRuns, want) {
		t.Fatalf("clipping = %d %+v, want 3 %+v (float over-range counts)", report.FullScaleSamples, report.ClipRuns, want)
	}
}

func TestClippingListsAtMostTheCapButCountsEveryRun(t *testing.T) {
	var samples []float64
	for i := 0; i < maxReportedClipRuns+25; i++ {
		samples = append(samples, 1, 1, 1, 0)
	}
	report := analyzeBytes(t, encodeWAV(t, 1, 8000, 16, false, samples))

	if report.ClipRunCount != maxReportedClipRuns+25 {
		t.Fatalf("clip run count = %d, want every run counted", report.ClipRunCount)
	}
	if len(report.ClipRuns) != maxReportedClipRuns || report.ClipRuns[0].StartSeconds != 0 {
		t.Fatalf("listed %d runs starting %+v, want the first %d", len(report.ClipRuns), report.ClipRuns[0], maxReportedClipRuns)
	}
}

func TestClippingOfARangeIsTimedFromTheRangeStart(t *testing.T) {
	const rate = 8000
	mono := silence(rate, 2)
	for i := rate + 100; i < rate+110; i++ {
		mono[i] = -1
	}
	report := analyzeRangeBytes(t, encodeWAV(t, 1, rate, 16, false, mono), Range{StartSeconds: 1, LengthSeconds: 1})
	want := []ClipRun{{Channel: 0, StartSeconds: 100.0 / rate, DurationSeconds: 10.0 / rate, Samples: 10}}
	if !reflect.DeepEqual(report.ClipRuns, want) {
		t.Fatalf("clip runs = %+v, want %+v (range-relative)", report.ClipRuns, want)
	}
}

func TestCleanAudioSerialisesAnEmptyClipRunList(t *testing.T) {
	encoded, err := json.Marshal(analyzeBytes(t, encodeWAV(t, 1, 8000, 16, false, sine(8000, 1, 440, -20, 0))))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"full_scale_samples":0`, `"clip_run_count":0`, `"clip_runs":[]`} {
		if !strings.Contains(string(encoded), want) {
			t.Fatalf("report JSON = %s, want %s: zero clipping is a measurement, not a gap", encoded, want)
		}
	}
}

func TestFullScaleLevelMatchesEachFormatsLargestPositiveCode(t *testing.T) {
	for _, tt := range []struct {
		format Format
		want   float64
	}{
		{Format{BitsPerSample: 16}, 32767.0 / 32768},
		{Format{BitsPerSample: 24}, 8388607.0 / 8388608},
		{Format{BitsPerSample: 32}, 2147483647.0 / 2147483648},
		{Format{BitsPerSample: 32, Float: true}, 1},
		{Format{BitsPerSample: 64, Float: true}, 1},
	} {
		if got := fullScaleLevel(tt.format); got != tt.want {
			t.Errorf("fullScaleLevel(%+v) = %v, want %v", tt.format, got, tt.want)
		}
	}
}
