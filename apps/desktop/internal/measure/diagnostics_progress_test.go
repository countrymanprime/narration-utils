package measure

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// The Diagnostics view runs Diagnose as a host job (diagnostics PRD Phase 6), so it reports progress the way
// AnalyzeContext does: the audio bytes really read (ADR 0015), monotonic, ending at the total.

func TestDiagnoseReportsMonotonicProgressOverTheDataChunk(t *testing.T) {
	samples, _ := cleanRead()
	raw := encodeFixture(t, samples)
	var log progressLog
	in := rawInput()
	in.Progress = log.record

	if _, err := Diagnose(context.Background(), bytes.NewReader(raw), in); err != nil {
		t.Fatal(err)
	}
	log.check(t, int64(len(samples)*fixtureBits/8))
}

func TestDiagnoseProgressCoversOnlyWhatARangeReads(t *testing.T) {
	samples, _ := cleanRead()
	raw := encodeFixture(t, samples)
	var log progressLog
	in := rawInput()
	in.Progress = log.record
	in.Range = &Range{StartSeconds: 5, LengthSeconds: 5}

	if _, err := Diagnose(context.Background(), bytes.NewReader(raw), in); err != nil {
		t.Fatal(err)
	}
	log.check(t, int64(10*fixtureRate*fixtureBits/8)) // up to the end of the range
}

func TestDiagnoseFileReportsProgressToTheEndOfTheFile(t *testing.T) {
	samples, _ := cleanRead()
	path := filepath.Join(t.TempDir(), "read.wav")
	if err := os.WriteFile(path, encodeFixture(t, samples), 0o600); err != nil {
		t.Fatal(err)
	}
	var log progressLog
	in := rawInput()
	in.Progress = log.record

	if _, err := DiagnoseFile(context.Background(), path, in); err != nil {
		t.Fatal(err)
	}
	log.check(t, int64(len(samples)*fixtureBits/8))
}

func TestDiagnoseStopsWhenCancelledFromItsProgress(t *testing.T) {
	samples, _ := cleanRead()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	in := rawInput()
	in.Progress = func(done, total int64) {
		calls++
		if done > 0 {
			cancel()
		}
	}

	_, err := Diagnose(ctx, bytes.NewReader(encodeFixture(t, samples)), in)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if calls > 2 {
		t.Fatalf("diagnostics went on for %d progress calls after they were cancelled", calls-1)
	}
}

func TestDiagnosticSummaryCountsWhatTheAnalyzersFound(t *testing.T) {
	result := diagnoseBytes(t, encodeFixture(t, roomToneChange()), rawInput())
	summary := result.Summary()

	if summary.DurationSeconds != result.DurationSeconds || summary.SampleRate != fixtureRate || summary.Channels != 1 {
		t.Fatalf("summary format = %+v, want the diagnostics' own", summary)
	}
	if summary.ClipRegions != result.Clipping.RegionCount || summary.LevelShifts != len(result.LevelShifts) {
		t.Fatalf("summary counts = %+v, want the clip regions and level shifts found", summary)
	}
	if summary.Silences != len(result.Silences) || summary.RoomToneSegments != len(result.RoomTone) || summary.RoomToneSegments < 2 {
		t.Fatalf("summary = %+v, want the silences and at least two room-tone segments", summary)
	}
	total := 0.0
	for _, region := range result.Silences {
		total += region.EndSeconds - region.StartSeconds
	}
	within(t, "silence seconds", &summary.SilenceSeconds, total, 1e-9)
	if summary.Pacing.Status != StatusUnavailable || summary.Pacing.Reason == "" {
		t.Fatalf("pacing = %+v, want unavailable with its reason when there is no transcript", summary.Pacing)
	}
	if summary.WordsPerMinute != nil {
		t.Fatalf("words per minute = %v, want none without transcript timing", *summary.WordsPerMinute)
	}
}

func TestDiagnosticSummaryGivesWordsPerMinuteOnlyFromTranscriptTiming(t *testing.T) {
	samples, words := cleanRead()
	in := rawInput()
	in.Words = words
	summary := diagnoseBytes(t, encodeFixture(t, samples), in).Summary()

	if summary.Pacing.Status != StatusMeasured || summary.WordsPerMinute == nil {
		t.Fatalf("pacing = %+v, wpm = %v; want measured with a rate", summary.Pacing, summary.WordsPerMinute)
	}
	want := float64(len(words)) / (summary.DurationSeconds / 60)
	within(t, "words per minute", summary.WordsPerMinute, want, 1e-9)
}
