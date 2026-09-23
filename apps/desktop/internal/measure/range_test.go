package measure

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// rangeSignal is a mono, float32-exact signal with distinct sections so a
// range that starts or ends in the wrong place changes every measurement.
func rangeSignal(rate int) []float64 {
	roomPeak := -60 + 20*math.Log10(math.Sqrt2)
	return concat(
		sine(rate, 1, 1000, roomPeak, 0), // 0-1 s room tone
		sine(rate, 2, 997, -12, 0),       // 1-3 s loud read
		sine(rate, 1, 440, -30, 0),       // 3-4 s quiet read
	)
}

var errBoom = errors.New("disk on fire")

// ioChain serves prefix, then whatever next returns.
func ioChain(prefix []byte, next io.Reader) io.Reader {
	return io.MultiReader(bytes.NewReader(prefix), next)
}

func analyzeRangeBytes(t *testing.T, raw []byte, rng Range) Report {
	t.Helper()
	report, err := AnalyzeRange(bytes.NewReader(raw), rng)
	if err != nil {
		t.Fatalf("AnalyzeRange: %v", err)
	}
	return report
}

// withoutRange drops the requested range so a range report compares equal
// to a whole-file report of the same samples.
func withoutRange(r Report) Report {
	r.Range = nil
	return r
}

func TestAnalyzeRangeEqualsAnalyzingTheSliceAlone(t *testing.T) {
	const rate = 8000
	mono := rangeSignal(rate)
	raw := encodeWAV(t, 1, rate, 32, true, mono)

	got := analyzeRangeBytes(t, raw, Range{StartSeconds: 1, LengthSeconds: 2})
	want := analyzeBytes(t, encodeWAV(t, 1, rate, 32, true, mono[rate:3*rate]))

	if !reflect.DeepEqual(withoutRange(got), want) {
		t.Fatalf("range report\n%+v\nwant the slice's report\n%+v", got, want)
	}
	if got.Range == nil || got.Range.StartSeconds != 1 || got.Range.LengthSeconds != 2 {
		t.Fatalf("Range = %+v, want the requested {1 2}", got.Range)
	}
	within(t, "sample peak of the loud read only", got.SamplePeakdBFS, -12, 0.01)
}

func TestAnalyzeRangeOfStereoPCMMeasuresOnlyTheRange(t *testing.T) {
	const rate = 48000
	mono := rangeSignal(rate)
	report := analyzeRangeBytes(t, encodeWAV(t, 2, rate, 24, false, stereo(mono)), Range{StartSeconds: 3, LengthSeconds: 1})

	if math.Abs(report.DurationSeconds-1) > 1e-9 {
		t.Fatalf("duration = %v, want 1", report.DurationSeconds)
	}
	within(t, "sample peak of the quiet read", report.SamplePeakdBFS, -30, 0.01)
}

func TestAnalyzeRangePastTheEndMeasuresOnlyTheAudioThatExists(t *testing.T) {
	const rate = 8000
	raw := encodeWAV(t, 1, rate, 16, false, rangeSignal(rate))

	report := analyzeRangeBytes(t, raw, Range{StartSeconds: 3.5, LengthSeconds: 10})
	if math.Abs(report.DurationSeconds-0.5) > 1e-9 {
		t.Fatalf("duration = %v, want the 0.5 s that exists", report.DurationSeconds)
	}

	outside := analyzeRangeBytes(t, raw, Range{StartSeconds: 20, LengthSeconds: 1})
	if outside.DurationSeconds != 0 || outside.RMSdBFS != nil || outside.SamplePeakdBFS != nil {
		t.Fatalf("a range after the end = %+v, want zero duration and nothing measured", outside)
	}
}

func TestAnalyzeRangeWorksOnAFileStillBeingRecorded(t *testing.T) {
	const rate = 8000
	raw := encodeWAV(t, 1, rate, 16, false, rangeSignal(rate))
	dataAt := bytes.Index(raw, []byte("data"))
	copy(raw[dataAt+4:], []byte{0xFF, 0xFF, 0xFF, 0xFF})

	report := analyzeRangeBytes(t, raw, Range{StartSeconds: 1, LengthSeconds: 2})
	if math.Abs(report.DurationSeconds-2) > 1e-9 {
		t.Fatalf("duration = %v, want 2", report.DurationSeconds)
	}
	within(t, "sample peak", report.SamplePeakdBFS, -12, 0.01)
}

func TestAnalyzeRangeRejectsAnUnusableRange(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, sine(8000, 1, 440, -20, 0))
	for name, rng := range map[string]Range{
		"negative start":  {StartSeconds: -0.1, LengthSeconds: 1},
		"zero length":     {StartSeconds: 0, LengthSeconds: 0},
		"negative length": {StartSeconds: 0, LengthSeconds: -1},
		"NaN start":       {StartSeconds: math.NaN(), LengthSeconds: 1},
		"infinite length": {StartSeconds: 0, LengthSeconds: math.Inf(1)},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := AnalyzeRange(bytes.NewReader(raw), rng); err == nil || !strings.Contains(err.Error(), "range") {
				t.Fatalf("error = %v, want an invalid range error", err)
			}
		})
	}
}

func TestAnalyzeRangePropagatesHeaderAndDecodeErrors(t *testing.T) {
	if _, err := AnalyzeRange(strings.NewReader("not audio"), Range{LengthSeconds: 1}); err == nil {
		t.Fatal("a non-WAV input must fail")
	}
	bad := encodeWAV(t, 1, 8000, 32, true, []float64{0.1, math.NaN(), 0.2})
	if _, err := AnalyzeRange(bytes.NewReader(bad), Range{LengthSeconds: 1}); err == nil {
		t.Fatal("a non-finite sample inside the range must fail")
	}
}

func TestAnalyzeFileRangeRecordsPathAndPropagatesErrors(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "take.wav")
	if err := os.WriteFile(good, encodeWAV(t, 1, 8000, 16, false, rangeSignal(8000)), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := AnalyzeFileRange(good, Range{StartSeconds: 1, LengthSeconds: 1})
	if err != nil {
		t.Fatalf("AnalyzeFileRange: %v", err)
	}
	if report.File != good || math.Abs(report.DurationSeconds-1) > 1e-9 {
		t.Fatalf("report = %+v", report)
	}

	if _, err := AnalyzeFileRange(filepath.Join(dir, "missing.wav"), Range{LengthSeconds: 1}); err == nil {
		t.Fatal("a missing file must fail")
	}
	bad := filepath.Join(dir, "notes.wav")
	if err := os.WriteFile(bad, []byte("not audio"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := AnalyzeFileRange(bad, Range{LengthSeconds: 1}); err == nil || !strings.Contains(err.Error(), "notes.wav") {
		t.Fatalf("error = %v, want one naming the offending file", err)
	}
}

func TestAnalyzeRangeReportSerialisesTheRequestedRange(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, rangeSignal(8000))
	encoded, err := json.Marshal(analyzeRangeBytes(t, raw, Range{StartSeconds: 1, LengthSeconds: 0.5}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"range":{"start_seconds":1,"length_seconds":0.5}`) {
		t.Fatalf("report JSON = %s, want the requested range", encoded)
	}

	whole, err := json.Marshal(analyzeBytes(t, raw))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(whole), `"range"`) {
		t.Fatalf("a whole-file report must not claim a range: %s", whole)
	}
}

func TestWAVReaderSkipDiscardsWholeFramesWithoutDecoding(t *testing.T) {
	// A NaN inside the skipped part is never decoded, so it cannot fail.
	raw := encodeWAV(t, 2, 8000, 32, true, []float64{math.NaN(), 0, 0.1, 0.2, 0.3, 0.4})
	reader, err := NewWAVReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	skipped, err := reader.Skip(1)
	if err != nil || skipped != 1 {
		t.Fatalf("Skip(1) = %d, %v", skipped, err)
	}
	block, err := reader.Read(10)
	if err != nil || len(block[0]) != 2 || math.Abs(block[0][0]-0.1) > 1e-7 {
		t.Fatalf("after Skip, Read = %v, %v", block, err)
	}

	skipped, err = reader.Skip(5)
	if err != nil || skipped != 0 {
		t.Fatalf("Skip at the end = %d, %v; want 0 frames and no error", skipped, err)
	}
}

func TestWAVReaderSkipStopsAtTheEndOfAnUnfinishedFile(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, []float64{0.1, 0.2, 0.3})
	dataAt := bytes.Index(raw, []byte("data"))
	copy(raw[dataAt+4:], []byte{0xFF, 0xFF, 0xFF, 0xFF})
	reader, err := NewWAVReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	skipped, err := reader.Skip(100)
	if err != nil || skipped != 3 {
		t.Fatalf("Skip(100) = %d, %v; want the 3 frames that exist", skipped, err)
	}
	if _, err := reader.Read(1); err == nil {
		t.Fatal("Read after skipping everything must report EOF")
	}
}

func TestWAVReaderSkipReportsIOFailures(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, []float64{0.1, 0.2, 0.3})
	header := raw[:len(raw)-6]
	reader, err := NewWAVReader(ioChain(header, failingReader{errBoom}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reader.Skip(3); err == nil {
		t.Fatal("an I/O failure while skipping must be reported")
	}
}

func TestAnalyzeRangeOfAnAstronomicalLengthMeasuresToTheEnd(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, rangeSignal(8000))
	report := analyzeRangeBytes(t, raw, Range{StartSeconds: 3, LengthSeconds: 1e300})
	if math.Abs(report.DurationSeconds-1) > 1e-9 {
		t.Fatalf("duration = %v, want the last 1 s", report.DurationSeconds)
	}
}

func TestAnalyzeRangeReportsAnIOFailureWhileSkipping(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, rangeSignal(8000))
	dataAt := bytes.Index(raw, []byte("data"))
	_, err := AnalyzeRange(ioChain(raw[:dataAt+8], failingReader{errBoom}), Range{StartSeconds: 1, LengthSeconds: 1})
	if !errors.Is(err, errBoom) {
		t.Fatalf("error = %v, want the I/O failure", err)
	}
}

// FuzzAnalyzeRangeEqualsTheSlice is the range API's defining property: for
// any in-bounds range, measuring the range of the whole file gives exactly
// the report of a file holding only those frames.
func FuzzAnalyzeRangeEqualsTheSlice(f *testing.F) {
	const rate = 8000
	mono := rangeSignal(rate)
	raw := encodeWAV(f, 1, rate, 32, true, mono)
	f.Add(uint16(0), uint16(100))
	f.Add(uint16(8000), uint16(16000))
	f.Add(uint16(31999), uint16(1))
	f.Add(uint16(7777), uint16(4242))
	f.Fuzz(func(t *testing.T, start, length uint16) {
		first := int(start) % len(mono)
		count := 1 + int(length)%(len(mono)-first)
		rng := Range{StartSeconds: float64(first) / rate, LengthSeconds: float64(count) / rate}

		got, err := AnalyzeRange(bytes.NewReader(raw), rng)
		if err != nil {
			t.Fatalf("AnalyzeRange(%+v): %v", rng, err)
		}
		want, err := Analyze(bytes.NewReader(encodeWAV(t, 1, rate, 32, true, mono[first:first+count])))
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(withoutRange(got), want) {
			t.Fatalf("range %d+%d frames:\n got %+v\nwant %+v", first, count, got, want)
		}
	})
}
