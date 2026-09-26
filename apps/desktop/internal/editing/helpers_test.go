package editing

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// The WAV fixture helpers below mirror apps/desktop/internal/measure's own
// helpers_test.go (encodeWAV, silence, sine, ...): a minimal RIFF/WAVE
// encoder, kept duplicated rather than exported from measure, since a test
// helper is not part of that package's public surface.

func writeWAVFixture(t testing.TB, name string, channels, rate int, samples []float64) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, encodeWAV16(t, channels, rate, samples), 0o600); err != nil {
		t.Fatalf("writing fixture: %v", err)
	}
	return path
}

func encodeWAV16(t testing.TB, channels, rate int, interleaved []float64) []byte {
	t.Helper()
	var data bytes.Buffer
	for _, s := range interleaved {
		v := int16(math.Round(clampSample(s) * 32767))
		_ = binary.Write(&data, binary.LittleEndian, v)
	}
	return riffWAV(fmtChunkPCM16(channels, rate), dataChunkWAV(data.Bytes()))
}

func clampSample(v float64) float64 { return math.Max(-1, math.Min(1, v)) }

func chunkWAV(id string, payload []byte) []byte {
	var out bytes.Buffer
	out.WriteString(id)
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(payload)))
	out.Write(payload)
	if len(payload)%2 == 1 {
		out.WriteByte(0)
	}
	return out.Bytes()
}

func fmtChunkPCM16(channels, rate int) []byte {
	var p bytes.Buffer
	const bits = 16
	blockAlign := channels * bits / 8
	_ = binary.Write(&p, binary.LittleEndian, uint16(1)) // PCM
	_ = binary.Write(&p, binary.LittleEndian, uint16(channels))
	_ = binary.Write(&p, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&p, binary.LittleEndian, uint32(rate*blockAlign))
	_ = binary.Write(&p, binary.LittleEndian, uint16(blockAlign))
	_ = binary.Write(&p, binary.LittleEndian, uint16(bits))
	return chunkWAV("fmt ", p.Bytes())
}

func dataChunkWAV(payload []byte) []byte {
	var out bytes.Buffer
	out.WriteString("data")
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(payload)))
	out.Write(payload)
	return out.Bytes()
}

func riffWAV(chunks ...[]byte) []byte {
	body := []byte("WAVE")
	for _, c := range chunks {
		body = append(body, c...)
	}
	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(body)))
	out.Write(body)
	return out.Bytes()
}

func silenceSamples(rate int, seconds float64) []float64 {
	return make([]float64, int(math.Round(seconds*float64(rate))))
}

func toneSamples(rate int, seconds, freq, peakDB float64) []float64 {
	n := int(math.Round(seconds * float64(rate)))
	amp := math.Pow(10, peakDB/20)
	out := make([]float64, n)
	for i := range out {
		out[i] = amp * math.Sin(2*math.Pi*freq*float64(i)/float64(rate))
	}
	return out
}

func concatSamples(parts ...[]float64) []float64 {
	var out []float64
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}
