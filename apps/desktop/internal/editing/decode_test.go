package editing

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const testRate = 8000

// TestDecodeIgnoresDeadAirBeforePlayedRange is Phase 2's own success signal:
// "A fixture with dead air before SOFFS reports nothing for that dead air."
// The fixture is 2 s of silence, then 1 s of tone, then 2 s of silence: the
// played range starts at 2 s (skipping the leading dead air) and runs 1 s, so
// Decode must report the tone's window as not silent and must never see the
// leading 2 s at all (proven by the whole-file comparison in the next test).
func TestDecodeIgnoresDeadAirBeforePlayedRange(t *testing.T) {
	samples := concatSamples(
		silenceSamples(testRate, 2),
		toneSamples(testRate, 1, 440, -6),
		silenceSamples(testRate, 2),
	)
	path := writeWAVFixture(t, "leading-dead-air.wav", 1, testRate, samples)
	src := Source{ItemGUID: "item-1", File: path, PlayedRange: evidence.PlayedRange{Start: 2, End: 3}}

	scan, reason, err := Decode(context.Background(), src, ScanOptions{}, nil)
	if err != nil {
		t.Fatalf("Decode() error = %v (reason %q)", err, reason)
	}
	if len(scan.Silences) != 0 {
		t.Fatalf("Decode() found %d silence region(s) in a 1 s tone-only range, want 0: %+v", len(scan.Silences), scan.Silences)
	}
	if got, want := scan.DurationSeconds, 1.0; got < want-0.01 || got > want+0.01 {
		t.Fatalf("Decode() duration = %v, want ~%v (the played range's own width, not the whole file)", got, want)
	}
}

// TestDecodeEqualsSliceOfWholeDecode is Phase 2's other success signal: "a
// range decode equals the slice of a whole decode." It builds one fixture
// with a silence run inside the range and compares Decode's silence times
// (relative to the range start) against a whole-file Diagnose's own silence
// times (relative to the file start), offset by the range start.
func TestDecodeEqualsSliceOfWholeDecode(t *testing.T) {
	head := toneSamples(testRate, 1, 440, -6)
	gap := silenceSamples(testRate, 0.5)
	tail := toneSamples(testRate, 1, 440, -6)
	samples := concatSamples(head, gap, tail)
	path := writeWAVFixture(t, "whole-vs-range.wav", 1, testRate, samples)

	whole, err := measure.DiagnoseFile(context.Background(), path, measure.DiagnosticInput{SourceKind: measure.SourceRawRecording, Options: measure.DefaultDiagnosticOptions()})
	if err != nil {
		t.Fatalf("whole-file Diagnose() error = %v", err)
	}
	if len(whole.Silences) != 1 {
		t.Fatalf("whole-file Diagnose() found %d silences, want 1: %+v", len(whole.Silences), whole.Silences)
	}

	rangeStart := 0.5 // starts partway into the head tone
	src := Source{ItemGUID: "item-1", File: path, PlayedRange: evidence.PlayedRange{Start: rangeStart, End: 2.5}}
	scan, reason, err := Decode(context.Background(), src, ScanOptions{}, nil)
	if err != nil {
		t.Fatalf("Decode() error = %v (reason %q)", err, reason)
	}
	if len(scan.Silences) != 1 {
		t.Fatalf("Decode() found %d silences, want 1: %+v", len(scan.Silences), scan.Silences)
	}
	wantStart, wantEnd := whole.Silences[0].StartSeconds-rangeStart, whole.Silences[0].EndSeconds-rangeStart
	if got := scan.Silences[0].StartSeconds; got < wantStart-0.005 || got > wantStart+0.005 {
		t.Fatalf("Decode() silence start = %v, want %v (whole-file start %v minus range start %v)", got, wantStart, whole.Silences[0].StartSeconds, rangeStart)
	}
	if got := scan.Silences[0].EndSeconds; got < wantEnd-0.005 || got > wantEnd+0.005 {
		t.Fatalf("Decode() silence end = %v, want %v", got, wantEnd)
	}
}

func TestDecodeClassifiesRefusals(t *testing.T) {
	t.Run("non-WAV format", func(t *testing.T) {
		dir := t.TempDir()
		path := dir + "/not-a-wav.wav"
		if err := os.WriteFile(path, []byte("ID3not a real wav file"), 0o600); err != nil {
			t.Fatalf("writing fixture: %v", err)
		}
		src := Source{File: path, PlayedRange: evidence.PlayedRange{Start: 0, End: 1}}
		_, reason, err := Decode(context.Background(), src, ScanOptions{}, nil)
		if err == nil {
			t.Fatalf("Decode() error = nil, want a refusal")
		}
		if !errors.Is(err, measure.ErrNotWAV) {
			t.Fatalf("Decode() error = %v, want measure.ErrNotWAV", err)
		}
		if reason != ReasonUnsupportedFormat {
			t.Fatalf("Decode() reason = %q, want %q", reason, ReasonUnsupportedFormat)
		}
	})

	t.Run("missing file", func(t *testing.T) {
		src := Source{File: "/does/not/exist.wav", PlayedRange: evidence.PlayedRange{Start: 0, End: 1}}
		_, reason, err := Decode(context.Background(), src, ScanOptions{}, nil)
		if err == nil {
			t.Fatalf("Decode() error = nil, want a refusal")
		}
		if reason != ReasonMissingFile {
			t.Fatalf("Decode() reason = %q, want %q", reason, ReasonMissingFile)
		}
	})

	t.Run("multi-channel", func(t *testing.T) {
		mono := toneSamples(testRate, 0.2, 440, -6)
		samples := make([]float64, 0, len(mono)*3)
		for i := range mono {
			samples = append(samples, mono[i], mono[i], mono[i])
		}
		path := writeWAVFixture(t, "three-channel.wav", 3, testRate, samples)
		src := Source{File: path, PlayedRange: evidence.PlayedRange{Start: 0, End: 0.1}}
		_, reason, err := Decode(context.Background(), src, ScanOptions{}, nil)
		if err == nil {
			t.Fatalf("Decode() error = nil, want a refusal")
		}
		if reason != ReasonMultiChannel {
			t.Fatalf("Decode() reason = %q, want %q", reason, ReasonMultiChannel)
		}
	})

	t.Run("empty played range", func(t *testing.T) {
		src := Source{File: "/irrelevant.wav", PlayedRange: evidence.PlayedRange{Start: 5, End: 5}}
		_, reason, err := Decode(context.Background(), src, ScanOptions{}, nil)
		if err == nil {
			t.Fatalf("Decode() error = nil, want a refusal")
		}
		if reason != ReasonNoPlayedRange {
			t.Fatalf("Decode() reason = %q, want %q", reason, ReasonNoPlayedRange)
		}
	})
}

// TestDecodeCancellationIsNotARefusal proves ctx cancellation is reported
// with ctx's own error and no UnknownReason, so a caller can tell "the
// narrator cancelled" apart from "this item cannot be analyzed" (Phase 5's
// cancel-produces-partial rule depends on this distinction).
func TestDecodeCancellationIsNotARefusal(t *testing.T) {
	samples := toneSamples(testRate, 5, 440, -6)
	path := writeWAVFixture(t, "long.wav", 1, testRate, samples)
	src := Source{File: path, PlayedRange: evidence.PlayedRange{Start: 0, End: 5}}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, reason, err := Decode(ctx, src, ScanOptions{}, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Decode() error = %v, want context.Canceled", err)
	}
	if reason != "" {
		t.Fatalf("Decode() reason = %q on cancellation, want empty (not a refusal)", reason)
	}
}

// TestDecodeNeverModifiesInput is a Success Metrics gate ("Input never
// modified: 0 files change"): decoding the same fixture twice must leave its
// bytes untouched.
func TestDecodeNeverModifiesInput(t *testing.T) {
	samples := concatSamples(silenceSamples(testRate, 0.5), toneSamples(testRate, 0.5, 440, -6))
	path := writeWAVFixture(t, "untouched.wav", 1, testRate, samples)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}
	src := Source{File: path, PlayedRange: evidence.PlayedRange{Start: 0, End: 1}}
	if _, _, err := Decode(context.Background(), src, ScanOptions{}, nil); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("re-reading fixture: %v", err)
	}
	if !bytesEqual(before, after) {
		t.Fatalf("Decode() modified its input file")
	}
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
