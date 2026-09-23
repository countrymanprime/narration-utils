package measure

import (
	"context"
	"io"
	"testing"
)

// toneStream serves a canonical WAV header and then a repeating one-second 24-bit stereo tone, so an hour of audio can
// be measured without an hour of audio on disk.
type toneStream struct {
	header []byte
	block  []byte
	left   int64
	pos    int
}

func newToneStream(tb testing.TB, rate int, seconds int64) *toneStream {
	tb.Helper()
	second := encodeWAV(tb, 2, rate, 24, false, stereo(fadeInOut(sine(rate, 1, 997, -18, 0), rate/100)))
	block := second[44:]
	dataBytes := int64(len(block)) * seconds
	header := riff(fmtChunk(1, 2, rate, 24), dataChunk(nil, uint32(dataBytes))) //nolint:gosec // G115: an hour of 48 kHz stereo 24-bit fits in 32 bits
	return &toneStream{header: header, block: block, left: dataBytes}
}

func (s *toneStream) Read(p []byte) (int, error) {
	if len(s.header) > 0 {
		n := copy(p, s.header)
		s.header = s.header[n:]
		return n, nil
	}
	if s.left == 0 {
		return 0, io.EOF
	}
	n := copy(p[:min(int64(len(p)), s.left)], s.block[s.pos:])
	s.pos = (s.pos + n) % len(s.block)
	s.left -= int64(n)
	return n, nil
}

func TestToneStreamIsAWholeWAV(t *testing.T) {
	report, err := Analyze(newToneStream(t, 8000, 3))
	if err != nil {
		t.Fatal(err)
	}
	if report.DurationSeconds != 3 || report.Channels != 2 {
		t.Fatalf("tone stream measured as %.3f s of %d channels, want 3 s of 2", report.DurationSeconds, report.Channels)
	}
}

// BenchmarkAnalyzeOneHourStereo48k is the throughput baseline the delivery PRD asks for (Phase 1): one hour of 24-bit
// stereo at 48 kHz with every measurement at once. Run it with
// go test ./internal/measure -run '^$' -bench OneHour -benchtime 1x
func BenchmarkAnalyzeOneHourStereo48k(b *testing.B) {
	for range b.N {
		stream := newToneStream(b, 48000, 3600)
		b.SetBytes(stream.left)
		if _, err := AnalyzeContext(context.Background(), stream, Options{}); err != nil {
			b.Fatal(err)
		}
	}
}
