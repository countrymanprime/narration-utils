package acoustic

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// encodeWAV builds a 16-bit PCM RIFF/WAVE file from interleaved samples in
// -1..1, mirroring measure's own test helper (apps/desktop/internal/measure
// /helpers_test.go) so fixtures built here decode with measure.NewWAVReader
// exactly as production audio would.
func encodeWAV(t testing.TB, channels, rate int, interleaved []float64) []byte {
	t.Helper()
	var data bytes.Buffer
	for _, s := range interleaved {
		v := int16(math.Round(math.Max(-1, math.Min(1, s)) * 32767))
		_ = binary.Write(&data, binary.LittleEndian, v)
	}
	blockAlign := channels * 2
	var fmtBody bytes.Buffer
	_ = binary.Write(&fmtBody, binary.LittleEndian, uint16(1)) // PCM
	_ = binary.Write(&fmtBody, binary.LittleEndian, uint16(channels))
	_ = binary.Write(&fmtBody, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&fmtBody, binary.LittleEndian, uint32(rate*blockAlign))
	_ = binary.Write(&fmtBody, binary.LittleEndian, uint16(blockAlign))
	_ = binary.Write(&fmtBody, binary.LittleEndian, uint16(16))

	var body bytes.Buffer
	body.WriteString("WAVE")
	writeChunk(&body, "fmt ", fmtBody.Bytes())
	writeChunk(&body, "data", data.Bytes())

	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(body.Len()))
	out.Write(body.Bytes())
	return out.Bytes()
}

func writeChunk(out *bytes.Buffer, id string, payload []byte) {
	out.WriteString(id)
	_ = binary.Write(out, binary.LittleEndian, uint32(len(payload)))
	out.Write(payload)
	if len(payload)%2 == 1 {
		out.WriteByte(0)
	}
}

// sine returns a mono sine at freq Hz, peakDB dBFS, with a short
// raised-cosine fade at both ends so an abrupt start or stop never masquerades
// as extra spectral or voiced-run content.
func sine(rate int, seconds, freq, peakDB float64) []float64 {
	n := int(math.Round(seconds * float64(rate)))
	amp := math.Pow(10, peakDB/20)
	out := make([]float64, n)
	for i := range out {
		out[i] = amp * math.Sin(2*math.Pi*freq*float64(i)/float64(rate))
	}
	return fadeInOut(out, min(len(out)/4, int(0.02*float64(rate))))
}

// sweep returns a mono linear-frequency chirp from f0 to f1 Hz over
// seconds, at peakDB dBFS: a synthetic sweep fixture (per the worker's
// "synthetic tones and sweeps" instruction), used to check that per-range
// F0 tracks the instantaneous frequency near wherever a range is centered.
func sweep(rate int, seconds, f0, f1, peakDB float64) []float64 {
	n := int(math.Round(seconds * float64(rate)))
	amp := math.Pow(10, peakDB/20)
	out := make([]float64, n)
	rate2 := (f1 - f0) / (2 * seconds)
	for i := range out {
		t := float64(i) / float64(rate)
		phase := 2 * math.Pi * (f0*t + rate2*t*t)
		out[i] = amp * math.Sin(phase)
	}
	return fadeInOut(out, min(len(out)/4, int(0.02*float64(rate))))
}

func fadeInOut(samples []float64, fadeFrames int) []float64 {
	out := append([]float64(nil), samples...)
	for i := 0; i < fadeFrames && i < len(out)/2; i++ {
		gain := 0.5 - 0.5*math.Cos(math.Pi*float64(i)/float64(fadeFrames))
		out[i] *= gain
		out[len(out)-1-i] *= gain
	}
	return out
}

func silence(rate int, seconds float64) []float64 {
	return make([]float64, int(math.Round(seconds*float64(rate))))
}

func concat(parts ...[]float64) []float64 {
	var out []float64
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// interleave zips one sample slice per channel into an interleaved stream.
func interleave(channels ...[]float64) []float64 {
	out := make([]float64, 0, len(channels[0])*len(channels))
	for i := range channels[0] {
		for _, ch := range channels {
			out = append(out, ch[i])
		}
	}
	return out
}

func within(t *testing.T, name string, got, want, tolerance float64) {
	t.Helper()
	if math.Abs(got-want) > tolerance {
		t.Fatalf("%s = %.4f, want %.4f ± %.4f", name, got, want, tolerance)
	}
}
