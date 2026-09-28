package editing

import (
	"context"
	"errors"
	"math"
	"math/rand/v2"
	"os"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const renderTestRate = 44100

// roomToneSamples is seeded white noise at the given RMS in dBFS, mirroring
// apps/desktop/internal/measure/diagnostics_fixtures_test.go's own roomTone
// helper (duplicated here for the same reason helpers_test.go's header
// comment already gives for this package's other WAV fixture helpers: a test
// helper is not part of measure's public surface).
func roomToneSamples(rate int, seconds, rmsDB float64, seed uint64) []float64 {
	random := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	amplitude := math.Pow(10, rmsDB/20) * math.Sqrt(3) // a uniform [-a,a] has RMS a/sqrt(3)
	out := make([]float64, int(seconds*float64(rate)))
	for i := range out {
		out[i] = amplitude * (2*random.Float64() - 1)
	}
	return out
}

// TestDecodeRenderFindsAKnownClick is Phase 8's own success signal: "A
// render with a known click reports it." The fixture mirrors
// apps/desktop/internal/measure/cleanup_test.go's own
// TestCleanupFindsAClickInsideSilence exactly (speech either side of a room-
// tone stretch with a short, high spike in the middle), decoded whole-file
// through DecodeRender rather than through one item's played range.
func TestDecodeRenderFindsAKnownClick(t *testing.T) {
	speechHalf := toneSamples(renderTestRate, 1, 180, -14)
	room := roomToneSamples(renderTestRate, 1.5, -65, 11)
	at := int(0.7 * renderTestRate)
	for i := range 88 { // a 2 ms spike, exactly the click_inside_silence fixture's own shape
		room[at+i] = 0.5
	}
	samples := concatSamples(speechHalf, room, speechHalf)
	path := writeWAVFixture(t, "render-with-click.wav", 1, renderTestRate, samples)

	scan, reason, err := DecodeRender(context.Background(), path, ScanOptions{})
	if err != nil {
		t.Fatalf("DecodeRender() error = %v (reason %q)", err, reason)
	}
	var clicks int
	for _, candidate := range scan.Cleanup.Candidates {
		if candidate.Class == measure.CleanupClick {
			clicks++
		}
	}
	if clicks != 1 {
		t.Fatalf("DecodeRender() found %d click candidate(s), want 1: %+v", clicks, scan.Cleanup.Candidates)
	}
	if got, want := scan.DurationSeconds, 3.5; got < want-0.01 || got > want+0.01 {
		t.Fatalf("DecodeRender() duration = %v, want ~%v (the whole file, not any one range)", got, want)
	}
}

// TestDecodeRenderClassifiesRefusals proves the render path reuses Decode's
// own classifyDecodeError, so an unreadable render gives the same stable
// UnknownReason an unreadable item source would.
func TestDecodeRenderClassifiesRefusals(t *testing.T) {
	t.Run("non-WAV format", func(t *testing.T) {
		dir := t.TempDir()
		path := dir + "/not-a-wav.wav"
		if err := os.WriteFile(path, []byte("ID3not a real wav file"), 0o600); err != nil {
			t.Fatalf("writing fixture: %v", err)
		}
		_, reason, err := DecodeRender(context.Background(), path, ScanOptions{})
		if err == nil {
			t.Fatalf("DecodeRender() error = nil, want a refusal")
		}
		if !errors.Is(err, measure.ErrNotWAV) {
			t.Fatalf("DecodeRender() error = %v, want measure.ErrNotWAV", err)
		}
		if reason != ReasonUnsupportedFormat {
			t.Fatalf("DecodeRender() reason = %q, want %q", reason, ReasonUnsupportedFormat)
		}
	})

	t.Run("missing file", func(t *testing.T) {
		_, reason, err := DecodeRender(context.Background(), "/does/not/exist.wav", ScanOptions{})
		if err == nil {
			t.Fatalf("DecodeRender() error = nil, want a refusal")
		}
		if reason != ReasonMissingFile {
			t.Fatalf("DecodeRender() reason = %q, want %q", reason, ReasonMissingFile)
		}
	})
}

// TestDecodeRenderCancellationIsNotARefusal mirrors
// TestDecodeCancellationIsNotARefusal (decode_test.go): a cancelled context
// is reported as ctx's own error with no UnknownReason.
func TestDecodeRenderCancellationIsNotARefusal(t *testing.T) {
	samples := toneSamples(renderTestRate, 2, 440, -6)
	path := writeWAVFixture(t, "render-long.wav", 1, renderTestRate, samples)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, reason, err := DecodeRender(ctx, path, ScanOptions{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("DecodeRender() error = %v, want context.Canceled", err)
	}
	if reason != "" {
		t.Fatalf("DecodeRender() reason = %q on cancellation, want empty (not a refusal)", reason)
	}
}

// TestDecodeRenderIsTheWholeFileNotARange proves DecodeRender never clips:
// silence right at the very start of the file (before any "range" a caller
// might have been tempted to infer) is still reported.
func TestDecodeRenderIsTheWholeFileNotARange(t *testing.T) {
	samples := concatSamples(silenceSamples(renderTestRate, 1), toneSamples(renderTestRate, 1, 440, -6))
	path := writeWAVFixture(t, "render-leading-silence.wav", 1, renderTestRate, samples)

	scan, reason, err := DecodeRender(context.Background(), path, ScanOptions{})
	if err != nil {
		t.Fatalf("DecodeRender() error = %v (reason %q)", err, reason)
	}
	if len(scan.Silences) != 1 {
		t.Fatalf("DecodeRender() found %d silence region(s), want 1 (the leading second): %+v", len(scan.Silences), scan.Silences)
	}
	if scan.Silences[0].StartSeconds > 0.01 {
		t.Fatalf("DecodeRender() silence starts at %v, want ~0 (whole file, no skip-ahead)", scan.Silences[0].StartSeconds)
	}
}
