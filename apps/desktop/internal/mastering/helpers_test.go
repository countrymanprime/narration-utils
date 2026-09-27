package mastering

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// The WAV fixture helpers below mirror apps/desktop/internal/measure's own helpers_test.go: a minimal RIFF/WAVE
// encoder, kept separate from the package's own writer so a fixture never depends on the code it tests.

// sine is amplitude*sin(2*pi*freq*t) for seconds at rate.
func sine(rate int, seconds, freq, amplitude float64) []float64 {
	out := make([]float64, int(math.Round(seconds*float64(rate))))
	for i := range out {
		out[i] = amplitude * math.Sin(2*math.Pi*freq*float64(i)/float64(rate))
	}
	return out
}

func concat(parts ...[]float64) []float64 {
	var out []float64
	for _, part := range parts {
		out = append(out, part...)
	}
	return out
}

func dB(amplitude float64) float64 { return 20 * math.Log10(amplitude) }

// rmsDB is the RMS of every sample of every channel, silences included: measure's own definition (measure.go).
func rmsDB(channels [][]float64) float64 {
	var energy float64
	var count int
	for _, channel := range channels {
		for _, s := range channel {
			energy += s * s
		}
		count += len(channel)
	}
	return 10 * math.Log10(energy/float64(count))
}

// peak is the largest absolute sample over every channel: measure's sample peak.
func peak(channels [][]float64) float64 {
	var p float64
	for _, channel := range channels {
		for _, s := range channel {
			p = math.Max(p, math.Abs(s))
		}
	}
	return p
}

// run feeds signal through a stage in blocks of blockFrames and returns everything it put out, flush included.
func run(t *testing.T, s Stage, signal [][]float64, blockFrames int) [][]float64 {
	t.Helper()
	out := make([][]float64, len(signal))
	add := func(block [][]float64) {
		for c := range block {
			out[c] = append(out[c], block[c]...)
		}
	}
	for first := 0; first < len(signal[0]); first += blockFrames {
		end := min(first+blockFrames, len(signal[0]))
		block := make([][]float64, len(signal))
		for c := range signal {
			block[c] = append([]float64(nil), signal[c][first:end]...)
		}
		add(s.Process(block))
	}
	add(s.Flush())
	return out
}

// writeFixture writes 16-bit PCM WAV audio, one slice per channel, and returns its path.
func writeFixture(t *testing.T, name string, rate int, channels ...[]float64) string {
	t.Helper()
	var data bytes.Buffer
	for i := range channels[0] {
		for _, channel := range channels {
			v := int16(math.Round(math.Max(-1, math.Min(1, channel[i])) * 32767))
			_ = binary.Write(&data, binary.LittleEndian, v)
		}
	}
	var fmtChunk bytes.Buffer
	blockAlign := len(channels) * 2
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(1))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(len(channels)))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint32(rate*blockAlign))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(blockAlign))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(16))

	var body bytes.Buffer
	body.WriteString("WAVE")
	for _, chunk := range []struct {
		id      string
		payload []byte
	}{{"fmt ", fmtChunk.Bytes()}, {"data", data.Bytes()}} {
		body.WriteString(chunk.id)
		_ = binary.Write(&body, binary.LittleEndian, uint32(len(chunk.payload)))
		body.Write(chunk.payload)
	}
	var file bytes.Buffer
	file.WriteString("RIFF")
	_ = binary.Write(&file, binary.LittleEndian, uint32(body.Len()))
	file.Write(body.Bytes())

	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, file.Bytes(), 0o600); err != nil {
		t.Fatalf("writing fixture: %v", err)
	}
	return path
}
