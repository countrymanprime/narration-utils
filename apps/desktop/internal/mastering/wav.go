package mastering

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const (
	wavHeaderBytes = 44
	wavTagPCM      = 1
	wavTagFloat    = 3
)

var errTooLong = errors.New("the mastered audio is too long for a WAV file (4 GiB)")

// wavWriter writes audio in the source's own format (PCM 16, 24 or 32-bit, or 32 or 64-bit float) to a seekable
// file, and fills in the header's sizes when it is closed.
type wavWriter struct {
	file   io.WriteSeeker
	out    *bufio.Writer
	format measure.Format
	data   int64
	buf    []byte
}

func newWAVWriter(file io.WriteSeeker, format measure.Format) (*wavWriter, error) {
	w := &wavWriter{file: file, out: bufio.NewWriterSize(file, 1<<16), format: format}
	if err := w.header(); err != nil {
		return nil, err
	}
	return w, nil
}

// header writes a canonical 44-byte header; the RIFF and data sizes are right once close has run.
func (w *wavWriter) header() error {
	tag := uint16(wavTagPCM)
	if w.format.Float {
		tag = wavTagFloat
	}
	bytesPerSample := w.format.BitsPerSample / 8
	blockAlign := w.format.Channels * bytesPerSample
	var h [wavHeaderBytes]byte
	copy(h[0:], "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(wavHeaderBytes-8+w.data+w.data%2)) //nolint:gosec // G115: write checks data fits
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], tag)
	binary.LittleEndian.PutUint16(h[22:], uint16(w.format.Channels))              //nolint:gosec // G115: 1 or 2, checked by measure's reader
	binary.LittleEndian.PutUint32(h[24:], uint32(w.format.SampleRate))            //nolint:gosec // G115: a positive sample rate from a WAV header
	binary.LittleEndian.PutUint32(h[28:], uint32(w.format.SampleRate*blockAlign)) //nolint:gosec // G115: as above
	binary.LittleEndian.PutUint16(h[32:], uint16(blockAlign))                     //nolint:gosec // G115: at most 16
	binary.LittleEndian.PutUint16(h[34:], uint16(w.format.BitsPerSample))         //nolint:gosec // G115: at most 64
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(w.data)) //nolint:gosec // G115: write checks data fits
	_, err := w.out.Write(h[:])
	return err
}

// write appends one block of per-channel samples, interleaved.
func (w *wavWriter) write(block [][]float64) error {
	if len(block) == 0 || len(block[0]) == 0 {
		return nil
	}
	bytesPerSample := w.format.BitsPerSample / 8
	size := len(block[0]) * len(block) * bytesPerSample
	if w.data+int64(size) > math.MaxUint32-wavHeaderBytes {
		return errTooLong
	}
	if cap(w.buf) < size {
		w.buf = make([]byte, size)
	}
	buf := w.buf[:size]
	offset := 0
	for i := range block[0] {
		for _, channel := range block {
			w.put(buf[offset:offset+bytesPerSample], channel[i])
			offset += bytesPerSample
		}
	}
	w.data += int64(size)
	_, err := w.out.Write(buf)
	return err
}

// put encodes one sample. PCM is scaled by the largest positive value, so full scale never wraps to the negative end.
func (w *wavWriter) put(b []byte, v float64) {
	v = math.Max(-1, math.Min(1, v))
	switch {
	case w.format.Float && w.format.BitsPerSample == 32:
		binary.LittleEndian.PutUint32(b, math.Float32bits(float32(v)))
	case w.format.Float:
		binary.LittleEndian.PutUint64(b, math.Float64bits(v))
	case w.format.BitsPerSample == 16:
		binary.LittleEndian.PutUint16(b, uint16(int16(math.Round(v*math.MaxInt16)))) //nolint:gosec // G115: two's complement on purpose
	case w.format.BitsPerSample == 24:
		s := uint32(int32(math.Round(v * (1<<23 - 1)))) //nolint:gosec // G115: two's complement on purpose
		b[0], b[1], b[2] = byte(s), byte(s>>8), byte(s>>16)
	default:
		binary.LittleEndian.PutUint32(b, uint32(int32(math.Round(v*math.MaxInt32)))) //nolint:gosec // G115: two's complement on purpose
	}
}

// close flushes the audio and rewrites the header with the final sizes. An odd-sized data chunk is padded to a word.
func (w *wavWriter) close() error {
	if w.data%2 == 1 {
		if err := w.out.WriteByte(0); err != nil {
			return err
		}
	}
	if err := w.out.Flush(); err != nil {
		return err
	}
	if _, err := w.file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewriting the WAV header: %w", err)
	}
	w.out.Reset(w.file)
	if err := w.header(); err != nil {
		return err
	}
	return w.out.Flush()
}
