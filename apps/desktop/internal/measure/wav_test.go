package measure

import (
	"bytes"
	"errors"
	"io"
	"math"
	"strings"
	"testing"
)

func readAll(t *testing.T, raw []byte) (Format, [][]float64) {
	t.Helper()
	reader, err := NewWAVReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("NewWAVReader: %v", err)
	}
	channels := make([][]float64, reader.Format().Channels)
	for {
		block, err := reader.Read(1000)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		for c := range channels {
			channels[c] = append(channels[c], block[c]...)
		}
	}
	return reader.Format(), channels
}

func TestWAVReaderDecodesEverySupportedSampleFormat(t *testing.T) {
	samples := []float64{0, 0.5, -0.5, 0.25}
	tests := []struct {
		name  string
		bits  int
		float bool
		tol   float64
	}{
		{"pcm16", 16, false, 1.0 / 32768},
		{"pcm24", 24, false, 1.0 / 8388608},
		{"pcm32", 32, false, 1e-8},
		{"float32", 32, true, 1e-7},
		{"float64", 64, true, 1e-12},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			format, channels := readAll(t, encodeWAV(t, 2, 44100, tt.bits, tt.float, samples))
			if format.Channels != 2 || format.SampleRate != 44100 || format.BitsPerSample != tt.bits || format.Float != tt.float {
				t.Fatalf("format = %+v", format)
			}
			want := [][]float64{{0, -0.5}, {0.5, 0.25}}
			for c := range want {
				if len(channels[c]) != len(want[c]) {
					t.Fatalf("channel %d has %d frames, want %d", c, len(channels[c]), len(want[c]))
				}
				for i, w := range want[c] {
					if math.Abs(channels[c][i]-w) > tt.tol {
						t.Errorf("channel %d frame %d = %v, want %v", c, i, channels[c][i], w)
					}
				}
			}
		})
	}
}

func TestWAVReaderSkipsUnknownChunksIncludingOddPadded(t *testing.T) {
	raw := riff(
		chunk("LIST", []byte("odd")), // 3 bytes, padded to 4
		fmtChunk(1, 1, 8000, 16),
		chunk("bext", make([]byte, 10)),
		dataChunk([]byte{0x00, 0x40}, 2),
		chunk("junk", []byte("after data is ignored")),
	)
	_, channels := readAll(t, raw)
	if len(channels[0]) != 1 || math.Abs(channels[0][0]-0.5) > 1e-4 {
		t.Fatalf("channels = %v, want one sample near 0.5", channels)
	}
}

func TestWAVReaderReadsToEOFWhenDeclaredSizeIsUnreliable(t *testing.T) {
	payload := make([]byte, 8) // four 16-bit mono frames
	for _, declared := range []uint32{0, 0xFFFFFFFF, 9999} {
		raw := riff(fmtChunk(1, 1, 8000, 16), dataChunk(payload, declared))
		_, channels := readAll(t, raw)
		if len(channels[0]) != 4 {
			t.Errorf("declared size %d: got %d frames, want 4", declared, len(channels[0]))
		}
	}
}

func TestWAVReaderDropsATruncatedTrailingFrame(t *testing.T) {
	payload := make([]byte, 7) // one stereo 16-bit frame is 4 bytes
	raw := riff(fmtChunk(1, 2, 8000, 16), dataChunk(payload, 7))
	_, channels := readAll(t, raw)
	if len(channels[0]) != 1 {
		t.Fatalf("got %d frames, want 1 whole frame", len(channels[0]))
	}
}

func TestWAVReaderHonoursDeclaredSizeWhenFileHasTrailingData(t *testing.T) {
	raw := riff(fmtChunk(1, 1, 8000, 16), dataChunk(make([]byte, 6), 4))
	_, channels := readAll(t, raw)
	if len(channels[0]) != 2 {
		t.Fatalf("got %d frames, want 2 (declared size 4 bytes)", len(channels[0]))
	}
}

func TestWAVReaderAcceptsWaveFormatExtensible(t *testing.T) {
	var p bytes.Buffer
	p.Write([]byte{0xFE, 0xFF, 1, 0})                                           // tag 0xFFFE, 1 channel
	p.Write([]byte{0x40, 0x1F, 0, 0})                                           // 8000 Hz
	p.Write([]byte{0x80, 0x3E, 0, 0})                                           // byte rate 16000
	p.Write([]byte{2, 0, 16, 0})                                                // block align 2, 16 bits
	p.Write([]byte{22, 0, 16, 0})                                               // cbSize 22, valid bits 16
	p.Write([]byte{4, 0, 0, 0})                                                 // channel mask
	p.Write([]byte{1, 0, 0, 0, 0, 0x10, 0x80, 0, 0, 0xAA, 0, 0x38, 0x9B, 0x71}) // PCM sub-format GUID
	raw := riff(chunk("fmt ", p.Bytes()), dataChunk([]byte{0x00, 0x40}, 2))
	format, channels := readAll(t, raw)
	if format.Float || format.BitsPerSample != 16 || math.Abs(channels[0][0]-0.5) > 1e-4 {
		t.Fatalf("format = %+v channels = %v", format, channels)
	}
}

func TestWAVReaderRejectsUnusableFiles(t *testing.T) {
	tests := []struct {
		name string
		raw  []byte
		want string
	}{
		{"not riff", []byte("this is definitely not a wav file"), "RIFF"},
		{"empty", nil, "RIFF"},
		{"no fmt chunk", riff(dataChunk(nil, 0)), "fmt"},
		{"no data chunk", riff(fmtChunk(1, 1, 8000, 16)), "data"},
		{"eight bit", riff(fmtChunk(1, 1, 8000, 8), dataChunk(nil, 0)), "bit"},
		{"three channels", riff(fmtChunk(1, 3, 8000, 16), dataChunk(nil, 0)), "channel"},
		{"zero sample rate", riff(fmtChunk(1, 1, 0, 16), dataChunk(nil, 0)), "sample rate"},
		{"compressed", riff(fmtChunk(2, 1, 8000, 16), dataChunk(nil, 0)), "PCM"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewWAVReader(bytes.NewReader(tt.raw))
			if err == nil {
				t.Fatal("NewWAVReader = nil error, want failure")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %q, want it to mention %q", err, tt.want)
			}
		})
	}
}

func TestWAVReaderTreatsAFinalisedEmptyDataChunkAsEmpty(t *testing.T) {
	// A real, finished, empty take followed by another chunk must not have
	// that chunk's bytes decoded as audio.
	raw := riff(fmtChunk(1, 1, 8000, 16), dataChunk(nil, 0), chunk("LIST", []byte("INFOsome metadata")))
	_, channels := readAll(t, raw)
	if len(channels[0]) != 0 {
		t.Fatalf("got %d frames from an empty data chunk, want 0", len(channels[0]))
	}
}

func TestWAVReaderRejectsNonFiniteFloatSamples(t *testing.T) {
	for name, bad := range map[string]float64{"NaN": math.NaN(), "+Inf": math.Inf(1), "-Inf": math.Inf(-1)} {
		t.Run(name, func(t *testing.T) {
			reader, err := NewWAVReader(bytes.NewReader(encodeWAV(t, 1, 8000, 32, true, []float64{0.1, bad, 0.2})))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := reader.Read(10); err == nil || !strings.Contains(err.Error(), "finite") {
				t.Fatalf("Read error = %v, want a non-finite sample error", err)
			}
		})
	}
}

func TestWAVReaderClampsAHugeReadRequest(t *testing.T) {
	reader, err := NewWAVReader(bytes.NewReader(encodeWAV(t, 1, 8000, 16, false, []float64{0.1, 0.2})))
	if err != nil {
		t.Fatal(err)
	}
	block, err := reader.Read(math.MaxInt / 2)
	if err != nil || len(block[0]) != 2 {
		t.Fatalf("Read(huge) = %v, %v; want the 2 available frames", block, err)
	}
}

type failingReader struct{ err error }

func (f failingReader) Read([]byte) (int, error) { return 0, f.err }

func TestWAVReaderReportsIOFailuresAsIOFailures(t *testing.T) {
	boom := errors.New("disk on fire")
	_, err := NewWAVReader(failingReader{boom})
	if !errors.Is(err, boom) {
		t.Fatalf("error = %v, want it to wrap the underlying I/O error", err)
	}
}
