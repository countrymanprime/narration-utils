package measure

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// progressLog records every progress call so a test can check it is honest: monotonic, bounded by its total, and
// ending at the number of audio bytes the measurement needed.
type progressLog struct {
	done, total []int64
}

func (p *progressLog) record(done, total int64) {
	p.done = append(p.done, done)
	p.total = append(p.total, total)
}

func (p *progressLog) check(t *testing.T, wantTotal int64) {
	t.Helper()
	if len(p.done) < 2 {
		t.Fatalf("progress was reported %d times, want several", len(p.done))
	}
	for i := range p.done {
		if p.total[i] != wantTotal {
			t.Fatalf("progress call %d: total = %d, want %d", i, p.total[i], wantTotal)
		}
		if p.done[i] < 0 || p.done[i] > p.total[i] {
			t.Fatalf("progress call %d: done %d outside 0..%d", i, p.done[i], p.total[i])
		}
		if i > 0 && p.done[i] < p.done[i-1] {
			t.Fatalf("progress went backwards: %d then %d", p.done[i-1], p.done[i])
		}
	}
	if last := p.done[len(p.done)-1]; last != wantTotal {
		t.Fatalf("progress ended at %d of %d bytes", last, wantTotal)
	}
}

// longMono is long enough to take many read blocks, so progress and cancellation have somewhere to happen.
func longMono(rate int) []float64 {
	return concat(sine(rate, 2, 997, -12, 0), sine(rate, 1, 440, -30, 0))
}

func TestAnalyzeContextGivesTheSameReportAsAnalyze(t *testing.T) {
	const rate = 8000
	raw := encodeWAV(t, 2, rate, 24, false, stereo(longMono(rate)))

	got, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if want := analyzeBytes(t, raw); !reflect.DeepEqual(got, want) {
		t.Fatalf("AnalyzeContext\n%+v\nwant Analyze's\n%+v", got, want)
	}

	rng := Range{StartSeconds: 0.5, LengthSeconds: 1.25}
	gotRange, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{Range: &rng})
	if err != nil {
		t.Fatal(err)
	}
	if want := analyzeRangeBytes(t, raw, rng); !reflect.DeepEqual(gotRange, want) {
		t.Fatalf("AnalyzeContext with a range\n%+v\nwant AnalyzeRange's\n%+v", gotRange, want)
	}
}

func TestAnalyzeContextReportsMonotonicProgressOverTheDataChunk(t *testing.T) {
	const rate = 8000
	mono := longMono(rate)
	raw := encodeWAV(t, 1, rate, 16, false, mono)
	var log progressLog

	if _, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{Progress: log.record}); err != nil {
		t.Fatal(err)
	}
	log.check(t, int64(len(mono)*2))
}

func TestAnalyzeContextProgressCoversOnlyWhatARangeReads(t *testing.T) {
	const rate = 8000
	mono := longMono(rate)
	raw := encodeWAV(t, 1, rate, 16, false, mono)
	var log progressLog

	rng := Range{StartSeconds: 1, LengthSeconds: 1}
	if _, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{Range: &rng, Progress: log.record}); err != nil {
		t.Fatal(err)
	}
	log.check(t, int64(2*rate*2)) // up to the end of the range, 2 s of 16-bit mono
}

func TestAnalyzeContextProgressOfARangePastTheEndStopsAtTheData(t *testing.T) {
	const rate = 8000
	mono := longMono(rate)
	raw := encodeWAV(t, 1, rate, 16, false, mono)
	var log progressLog

	rng := Range{StartSeconds: 2, LengthSeconds: 60}
	if _, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{Range: &rng, Progress: log.record}); err != nil {
		t.Fatal(err)
	}
	log.check(t, int64(len(mono)*2))
}

func TestAnalyzeContextStopsWhenCancelledMidFile(t *testing.T) {
	const rate = 8000
	raw := encodeWAV(t, 1, rate, 16, false, longMono(rate))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0

	_, err := AnalyzeContext(ctx, bytes.NewReader(raw), Options{Progress: func(done, total int64) {
		calls++
		if done > 0 {
			cancel()
		}
	}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if calls > 2 {
		t.Fatalf("measurement went on for %d progress calls after it was cancelled", calls-1)
	}
}

func TestAnalyzeContextRefusesAnAlreadyCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	raw := encodeWAV(t, 1, 8000, 16, false, longMono(8000))
	if _, err := AnalyzeContext(ctx, bytes.NewReader(raw), Options{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestAnalyzeContextNamesAnUnsupportedFormat(t *testing.T) {
	for name, raw := range map[string][]byte{
		"an MP3 frame": {0xFF, 0xFB, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		"six channels": riff(fmtChunk(1, 6, 48000, 16), dataChunk(make([]byte, 12*100), 12*100)),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{})
			if err == nil {
				t.Fatal("an unsupported file was measured")
			}
			if !strings.Contains(err.Error(), "WAVE") && !strings.Contains(err.Error(), "channel") {
				t.Fatalf("err = %q, want it to name what is unsupported", err)
			}
		})
	}
}

func TestAnalyzeContextRefusesAnInvalidRangeBeforeReading(t *testing.T) {
	rng := Range{StartSeconds: -1, LengthSeconds: 1}
	if _, err := AnalyzeContext(context.Background(), bytes.NewReader(nil), Options{Range: &rng}); err == nil || !strings.Contains(err.Error(), "invalid measurement range") {
		t.Fatalf("err = %v, want the range refused", err)
	}
}

func TestAnalyzeContextProgressOfAnUnfinishedHeaderHasNoTotalOnAStream(t *testing.T) {
	const rate = 8000
	body := encodeWAV(t, 1, rate, 16, false, longMono(rate))[44:]
	raw := riff(fmtChunk(1, 1, rate, 16), dataChunk(body, 0xFFFFFFFF))
	var log progressLog

	if _, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{Progress: log.record}); err != nil {
		t.Fatal(err)
	}
	for i, total := range log.total {
		if total != 0 {
			t.Fatalf("progress call %d: total = %d, want 0 (unknown)", i, total)
		}
		if i > 0 && log.done[i] < log.done[i-1] {
			t.Fatalf("progress went backwards: %d then %d", log.done[i-1], log.done[i])
		}
	}
	if last := log.done[len(log.done)-1]; last != int64(len(body)) {
		t.Fatalf("progress ended at %d, want the %d bytes read", last, len(body))
	}
}

func TestAnalyzeContextReportsSilenceAsNullNeverANumber(t *testing.T) {
	raw := encodeWAV(t, 2, 8000, 16, false, stereo(silence(8000, 2)))
	report, err := AnalyzeContext(context.Background(), bytes.NewReader(raw), Options{})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"integrated_lufs", "rms_dbfs", "sample_peak_dbfs", "true_peak_dbtp", "noise_floor_dbfs"} {
		if !strings.Contains(string(encoded), `"`+field+`":null`) {
			t.Fatalf("%s of digital silence is not null: %s", field, encoded)
		}
	}
}
