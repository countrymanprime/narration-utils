package measure

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func analyzeBytes(t *testing.T, raw []byte) Report {
	t.Helper()
	report, err := Analyze(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	return report
}

func TestAnalyzeReportsEveryMeasurementForNarrationLikeAudio(t *testing.T) {
	const rate = 48000
	// One second of room tone at -62 dBFS RMS, then four seconds of speech-level tone.
	roomPeak := -62 + 20*math.Log10(math.Sqrt2)
	room := sine(rate, 1, 1000, roomPeak, 0)
	voice := sine(rate, 4, 997, -18, 0)
	mono := concat(room, voice)

	report := analyzeBytes(t, encodeWAV(t, 2, rate, 32, true, stereo(mono)))

	if report.Channels != 2 || report.SampleRate != rate {
		t.Fatalf("format = %d ch @ %d Hz", report.Channels, report.SampleRate)
	}
	if math.Abs(report.DurationSeconds-5) > 1e-6 {
		t.Fatalf("duration = %v, want 5", report.DurationSeconds)
	}
	within(t, "noise floor", report.NoiseFloordBFS, -62, 0.1)
	within(t, "integrated LUFS", report.IntegratedLUFS, -18, 0.2)
	within(t, "sample peak", report.SamplePeakdBFS, -18, 0.05)
	within(t, "true peak", report.TruePeakdBTP, -18, 0.1)

	voiceMS := math.Pow(10, (-18-20*math.Log10(math.Sqrt2))/10)
	roomMS := math.Pow(10, -62.0/10)
	wantRMS := 10 * math.Log10((roomMS+4*voiceMS)/5)
	within(t, "RMS", report.RMSdBFS, wantRMS, 0.02)

	if *report.TruePeakdBTP < *report.SamplePeakdBFS {
		t.Fatalf("true peak %v below sample peak %v", *report.TruePeakdBTP, *report.SamplePeakdBFS)
	}
	if report.DigitalSilentWindows != 0 {
		t.Fatalf("digital silent windows = %d, want 0", report.DigitalSilentWindows)
	}
}

func TestAnalyzeDigitalSilenceIsUnavailableNotNegativeInfinity(t *testing.T) {
	report := analyzeBytes(t, encodeWAV(t, 1, 48000, 16, false, silence(48000, 2)))

	for name, value := range map[string]*float64{
		"integrated": report.IntegratedLUFS, "rms": report.RMSdBFS, "sample peak": report.SamplePeakdBFS,
		"true peak": report.TruePeakdBTP, "noise floor": report.NoiseFloordBFS,
	} {
		if value != nil {
			t.Errorf("%s = %v, want unavailable", name, *value)
		}
	}
	if report.DigitalSilentWindows != 4 {
		t.Fatalf("digital silent windows = %d, want 4 (2 s of 500 ms windows)", report.DigitalSilentWindows)
	}

	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("a report of silence must still marshal: %v", err)
	}
	if !strings.Contains(string(raw), `"integrated_lufs":null`) {
		t.Fatalf("unavailable values must serialise as null: %s", raw)
	}
}

func TestAnalyzeShorterThanOneWindowHasRMSButNoFloorOrLoudness(t *testing.T) {
	report := analyzeBytes(t, encodeWAV(t, 1, 48000, 32, true, sine(48000, 0.3, 1000, -20, 0)))

	within(t, "RMS", report.RMSdBFS, -20-20*math.Log10(math.Sqrt2), 0.05)
	if report.NoiseFloordBFS != nil || report.IntegratedLUFS != nil {
		t.Fatalf("floor = %v, integrated = %v; both need at least one full window", report.NoiseFloordBFS, report.IntegratedLUFS)
	}
}

func TestAnalyzeAcceptsAFileStillBeingRecorded(t *testing.T) {
	samples := sine(48000, 3, 997, -20, 0)
	raw := encodeWAV(t, 1, 48000, 16, false, samples)
	// Overwrite the declared data size, as REAPER's header is until it stops.
	dataAt := bytes.Index(raw, []byte("data"))
	copy(raw[dataAt+4:], []byte{0xFF, 0xFF, 0xFF, 0xFF})
	raw = raw[:len(raw)-3] // and cut mid-frame

	report := analyzeBytes(t, raw)
	if math.Abs(report.DurationSeconds-3) > 0.001 {
		t.Fatalf("duration = %v, want about 3", report.DurationSeconds)
	}
	within(t, "integrated LUFS", report.IntegratedLUFS, -23.01, 0.1)
}

func TestAnalyzeFileRecordsPathAndPropagatesErrors(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "chapter-01.wav")
	if err := os.WriteFile(good, encodeWAV(t, 1, 44100, 16, false, sine(44100, 2, 997, -20, 0)), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := AnalyzeFile(good)
	if err != nil {
		t.Fatalf("AnalyzeFile: %v", err)
	}
	if report.File != good || report.SampleRate != 44100 || report.Channels != 1 {
		t.Fatalf("report = %+v", report)
	}

	if _, err := AnalyzeFile(filepath.Join(dir, "missing.wav")); err == nil {
		t.Fatal("a missing file must fail")
	}

	bad := filepath.Join(dir, "notes.wav")
	if err := os.WriteFile(bad, []byte("not audio"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = AnalyzeFile(bad)
	if err == nil || !strings.Contains(err.Error(), "notes.wav") {
		t.Fatalf("error = %v, want one naming the offending file", err)
	}
}

// BenchmarkAnalyzeMinuteOfSpeechLikeAudio gives a feel for throughput: a
// 30-minute chapter costs roughly 30x this.
func BenchmarkAnalyzeMinuteOfSpeechLikeAudio(b *testing.B) {
	const rate = 44100
	tone := sine(rate, 60, 220, -12, 0)
	for i := range tone {
		// Slow amplitude modulation so peaks are not all identical.
		tone[i] *= 0.5 + 0.5*math.Sin(2*math.Pi*0.3*float64(i)/rate)
	}
	raw := encodeWAV(b, 1, rate, 16, false, tone)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := Analyze(bytes.NewReader(raw)); err != nil {
			b.Fatal(err)
		}
	}
}
