package mastering

import (
	"bytes"
	"io"
	"math"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// seekBuffer is an in-memory io.WriteSeeker.
type seekBuffer struct {
	data []byte
	at   int
}

func (b *seekBuffer) Write(p []byte) (int, error) {
	if end := b.at + len(p); end > len(b.data) {
		b.data = append(b.data, make([]byte, end-len(b.data))...)
	}
	copy(b.data[b.at:], p)
	b.at += len(p)
	return len(p), nil
}

func (b *seekBuffer) Seek(offset int64, whence int) (int64, error) {
	if whence != io.SeekStart {
		panic("only SeekStart is used")
	}
	b.at = int(offset)
	return offset, nil
}

// The writer keeps the source's format, and measure's own reader reads back what it wrote, within two steps of
// the format (PCM is written against the largest positive value and read against full scale).
func TestWAVWriterRoundTripsEveryFormatMeasureReads(t *testing.T) {
	formats := []struct {
		bits      int
		float     bool
		tolerance float64
	}{
		{16, false, 2.0 / 32767}, {24, false, 2.0 / 8388607}, {32, false, 2e-9}, {32, true, 1e-7}, {64, true, 0},
	}
	for _, f := range formats {
		for _, channels := range []int{1, 2} {
			format := measure.Format{Channels: channels, SampleRate: 22050, BitsPerSample: f.bits, Float: f.float}
			// An odd frame count, so 24-bit mono ends on an odd byte and needs its pad.
			block := make([][]float64, channels)
			for c := range block {
				block[c] = sine(22050, 0.1, 440+float64(c)*110, 0.7)[:2205]
				block[c][0], block[c][1] = 1, -1
			}
			var out seekBuffer
			w, err := newWAVWriter(&out, format)
			if err != nil {
				t.Fatal(err)
			}
			if err := w.write(block[:]); err != nil {
				t.Fatal(err)
			}
			if err := w.close(); err != nil {
				t.Fatal(err)
			}
			if len(out.data)%2 != 0 {
				t.Fatalf("%d-bit %d-channel: file is %d bytes, want word-aligned", f.bits, channels, len(out.data))
			}
			reader, err := measure.NewWAVReader(bytes.NewReader(out.data))
			if err != nil {
				t.Fatalf("%d-bit float=%v %d-channel: %v", f.bits, f.float, channels, err)
			}
			if reader.Format() != format {
				t.Fatalf("format read back = %+v, want %+v", reader.Format(), format)
			}
			back, err := reader.Read(1 << 16)
			if err != nil {
				t.Fatal(err)
			}
			if len(back[0]) != len(block[0]) {
				t.Fatalf("%d-bit %d-channel: %d frames read back, want %d", f.bits, channels, len(back[0]), len(block[0]))
			}
			for c := range block {
				for i := range block[c] {
					if diff := math.Abs(back[c][i] - block[c][i]); diff > f.tolerance+1e-12 {
						t.Fatalf("%d-bit float=%v: sample %d of channel %d = %g, want %g", f.bits, f.float, i, c, back[c][i], block[c][i])
					}
				}
			}
			if _, err := reader.Read(1); err != io.EOF {
				t.Fatalf("%d-bit %d-channel: data past the written audio (err %v)", f.bits, channels, err)
			}
		}
	}
}
