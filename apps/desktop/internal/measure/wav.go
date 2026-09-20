package measure

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
)

const (
	wavTagPCM         = 1
	wavTagFloat       = 3
	wavTagExtensible  = 0xFFFE
	wavMaxFmtBytes    = 1 << 16
	wavExtensibleSize = 26 // bytes before the sub-format GUID ends its tag word
	wavReadBufferSize = 1 << 16

	// maxReadFrames caps one Read so maxFrames*frameBytes cannot overflow.
	maxReadFrames = 1 << 20

	// A data chunk size of 0xFFFFFFFF (or 0 when audio follows rather than
	// another chunk) means the writer never finished the header, as with a
	// file REAPER is still recording.
	wavUnfinishedSize = 0xFFFFFFFF
)

var (
	errNotWAV    = errors.New("not a RIFF/WAVE file")
	errNonFinite = errors.New("WAV contains a non-finite (NaN or infinite) sample; the file is corrupt")
)

// isShortRead reports a clean end of input, as opposed to a real I/O failure.
func isShortRead(err error) bool {
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}

// looksLikeChunkID reports whether four bytes read as a RIFF chunk ID
// (letters, digits, or space), as opposed to raw audio.
func looksLikeChunkID(b []byte) bool {
	if len(b) < 4 {
		return false
	}
	for _, c := range b[:4] {
		letter := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
		if !letter && c != ' ' && (c < '0' || c > '9') {
			return false
		}
	}
	return true
}

// Format describes the samples in a WAV file.
type Format struct {
	Channels      int
	SampleRate    int
	BitsPerSample int
	Float         bool
}

// WAVReader streams a PCM or IEEE-float WAV file as per-channel float64
// samples in -1..1, so a chapter-length file never has to fit in memory.
type WAVReader struct {
	format     Format
	src        *bufio.Reader
	remaining  int64 // bytes left in the data chunk, or -1 to read to EOF
	frameBytes int
	buf        []byte
	done       bool
}

// NewWAVReader parses the header and positions the reader at the first
// sample. Only mono and stereo are supported; the loudness weights for
// surround layouts are not implemented and are refused rather than guessed.
func NewWAVReader(r io.Reader) (*WAVReader, error) {
	src := bufio.NewReaderSize(r, wavReadBufferSize)
	var header [12]byte
	if _, err := io.ReadFull(src, header[:]); err != nil {
		if isShortRead(err) {
			return nil, errNotWAV
		}
		return nil, fmt.Errorf("reading WAV header: %w", err)
	}
	if string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return nil, errNotWAV
	}

	var format Format
	haveFormat := false
	for {
		var chunkHeader [8]byte
		if _, err := io.ReadFull(src, chunkHeader[:]); err != nil {
			if !isShortRead(err) {
				return nil, fmt.Errorf("reading WAV chunk header: %w", err)
			}
			if haveFormat {
				return nil, errors.New("WAV file has no data chunk")
			}
			return nil, errors.New("WAV file has no fmt chunk")
		}
		id := string(chunkHeader[0:4])
		size := binary.LittleEndian.Uint32(chunkHeader[4:8])

		switch id {
		case "fmt ":
			parsed, err := readFmtChunk(src, size)
			if err != nil {
				return nil, err
			}
			format, haveFormat = parsed, true
		case "data":
			if !haveFormat {
				return nil, errors.New("WAV data chunk appears before the fmt chunk")
			}
			remaining := int64(size)
			switch size {
			case wavUnfinishedSize:
				remaining = -1
			case 0:
				// Zero means either an unfinished header (audio follows) or a
				// genuinely empty take (another chunk follows). Real audio
				// essentially never begins with four chunk-ID characters.
				if peek, _ := src.Peek(4); !looksLikeChunkID(peek) {
					remaining = -1
				}
			}
			return &WAVReader{
				format:     format,
				src:        src,
				remaining:  remaining,
				frameBytes: format.Channels * format.BitsPerSample / 8,
			}, nil
		default:
			if err := skipChunk(src, size); err != nil {
				if !isShortRead(err) {
					return nil, fmt.Errorf("reading WAV chunk %q: %w", id, err)
				}
				return nil, errors.New("WAV file has no data chunk")
			}
		}
	}
}

// skipChunk discards a chunk body and its pad byte (chunks are word-aligned).
func skipChunk(src *bufio.Reader, size uint32) error {
	_, err := io.CopyN(io.Discard, src, int64(size)+int64(size%2))
	return err
}

func readFmtChunk(src *bufio.Reader, size uint32) (Format, error) {
	if size < 16 || size > wavMaxFmtBytes {
		return Format{}, fmt.Errorf("WAV fmt chunk has an unusable size of %d bytes", size)
	}
	body := make([]byte, size+size%2)
	if _, err := io.ReadFull(src, body); err != nil {
		return Format{}, errors.New("WAV fmt chunk is truncated")
	}
	tag := binary.LittleEndian.Uint16(body[0:2])
	if tag == wavTagExtensible && size >= wavExtensibleSize {
		tag = binary.LittleEndian.Uint16(body[24:26])
	}
	format := Format{
		Channels:      int(binary.LittleEndian.Uint16(body[2:4])),
		SampleRate:    int(binary.LittleEndian.Uint32(body[4:8])),
		BitsPerSample: int(binary.LittleEndian.Uint16(body[14:16])),
		Float:         tag == wavTagFloat,
	}

	switch {
	case tag != wavTagPCM && tag != wavTagFloat:
		return Format{}, errors.New("unsupported WAV encoding: only PCM and IEEE float are supported")
	case format.Channels < 1 || format.Channels > 2:
		return Format{}, fmt.Errorf("unsupported channel count %d: only mono and stereo are supported", format.Channels)
	case format.SampleRate <= 0:
		return Format{}, fmt.Errorf("WAV has an invalid sample rate of %d", format.SampleRate)
	case !format.Float && format.BitsPerSample != 16 && format.BitsPerSample != 24 && format.BitsPerSample != 32:
		return Format{}, fmt.Errorf("unsupported %d-bit PCM: only 16, 24, and 32-bit are supported", format.BitsPerSample)
	case format.Float && format.BitsPerSample != 32 && format.BitsPerSample != 64:
		return Format{}, fmt.Errorf("unsupported %d-bit float: only 32 and 64-bit are supported", format.BitsPerSample)
	}
	return format, nil
}

// Format reports the file's sample format.
func (w *WAVReader) Format() Format { return w.format }

// Read decodes up to maxFrames frames and returns one slice per channel. It
// returns io.EOF once no whole frame remains; a truncated trailing frame is
// dropped, which is what a recording still being written looks like.
func (w *WAVReader) Read(maxFrames int) ([][]float64, error) {
	if w.done || maxFrames <= 0 {
		return nil, io.EOF
	}
	maxFrames = min(maxFrames, maxReadFrames)
	want := maxFrames * w.frameBytes
	if w.remaining >= 0 && int64(want) > w.remaining {
		want = int(w.remaining)
	}
	if want == 0 {
		return nil, io.EOF
	}
	if cap(w.buf) < want {
		w.buf = make([]byte, want)
	}
	buf := w.buf[:want]

	n, err := io.ReadFull(w.src, buf)
	if err != nil && !isShortRead(err) {
		return nil, err
	}
	if err != nil {
		w.done = true
	}
	if w.remaining >= 0 {
		w.remaining -= int64(n)
	}

	frames := n / w.frameBytes
	if frames == 0 {
		return nil, io.EOF
	}
	return w.decode(buf[:frames*w.frameBytes], frames)
}

func (w *WAVReader) decode(buf []byte, frames int) ([][]float64, error) {
	out := make([][]float64, w.format.Channels)
	for c := range out {
		out[c] = make([]float64, frames)
	}
	bytesPerSample := w.format.BitsPerSample / 8
	offset := 0
	for i := 0; i < frames; i++ {
		for c := range out {
			v := w.sample(buf[offset : offset+bytesPerSample])
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return nil, errNonFinite
			}
			out[c][i] = v
			offset += bytesPerSample
		}
	}
	return out, nil
}

func (w *WAVReader) sample(b []byte) float64 {
	switch {
	case w.format.Float && w.format.BitsPerSample == 32:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(b)))
	case w.format.Float:
		return math.Float64frombits(binary.LittleEndian.Uint64(b))
	case w.format.BitsPerSample == 16:
		return float64(int16(binary.LittleEndian.Uint16(b))) / 32768 //nolint:gosec // G115: reinterprets the PCM bits as two's complement on purpose
	case w.format.BitsPerSample == 24:
		return float64(int32(uint32(b[0])<<8|uint32(b[1])<<16|uint32(b[2])<<24)>>8) / 8388608 //nolint:gosec // G115: 24-bit PCM sign extension
	default:
		return float64(int32(binary.LittleEndian.Uint32(b))) / 2147483648 //nolint:gosec // G115: reinterprets the PCM bits as two's complement on purpose
	}
}
