package measure

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// encodeWAV builds a RIFF/WAVE file from interleaved samples in -1..1.
func encodeWAV(t testing.TB, channels, rate, bits int, float bool, interleaved []float64) []byte {
	t.Helper()
	var data bytes.Buffer
	for _, s := range interleaved {
		switch {
		case float && bits == 32:
			_ = binary.Write(&data, binary.LittleEndian, float32(s))
		case float && bits == 64:
			_ = binary.Write(&data, binary.LittleEndian, s)
		case bits == 16:
			_ = binary.Write(&data, binary.LittleEndian, int16(math.Round(clamp(s)*32767)))
		case bits == 24:
			v := int32(math.Round(clamp(s) * 8388607))
			data.Write([]byte{byte(v), byte(v >> 8), byte(v >> 16)})
		case bits == 32:
			_ = binary.Write(&data, binary.LittleEndian, int32(math.Round(clamp(s)*2147483647)))
		default:
			t.Fatalf("encodeWAV: unsupported bits %d", bits)
		}
	}
	tag := uint16(1)
	if float {
		tag = 3
	}
	return riff(fmtChunk(tag, channels, rate, bits), dataChunk(data.Bytes(), uint32(data.Len())))
}

func clamp(v float64) float64 { return math.Max(-1, math.Min(1, v)) }

func chunk(id string, payload []byte) []byte {
	var out bytes.Buffer
	out.WriteString(id)
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(payload)))
	out.Write(payload)
	if len(payload)%2 == 1 {
		out.WriteByte(0)
	}
	return out.Bytes()
}

func fmtChunk(tag uint16, channels, rate, bits int) []byte {
	var p bytes.Buffer
	blockAlign := channels * bits / 8
	_ = binary.Write(&p, binary.LittleEndian, tag)
	_ = binary.Write(&p, binary.LittleEndian, uint16(channels))
	_ = binary.Write(&p, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&p, binary.LittleEndian, uint32(rate*blockAlign))
	_ = binary.Write(&p, binary.LittleEndian, uint16(blockAlign))
	_ = binary.Write(&p, binary.LittleEndian, uint16(bits))
	return chunk("fmt ", p.Bytes())
}

// dataChunk lets a test declare a size that differs from the real payload,
// as REAPER does for a file still being recorded.
func dataChunk(payload []byte, declared uint32) []byte {
	var out bytes.Buffer
	out.WriteString("data")
	_ = binary.Write(&out, binary.LittleEndian, declared)
	out.Write(payload)
	return out.Bytes()
}

func riff(chunks ...[]byte) []byte {
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

func dbToAmp(db float64) float64 { return math.Pow(10, db/20) }

// sine returns a mono sine with the given peak amplitude in dBFS.
func sine(rate int, seconds, freq, peakDB, phase float64) []float64 {
	n := int(math.Round(seconds * float64(rate)))
	amp := dbToAmp(peakDB)
	out := make([]float64, n)
	for i := range out {
		out[i] = amp * math.Sin(2*math.Pi*freq*float64(i)/float64(rate)+phase)
	}
	return out
}

// fadeInOut applies a raised-cosine fade to both ends. A tone that starts
// abruptly is a step, and band-limited reconstruction of a step overshoots,
// which would mask the steady-state behaviour a test is after.
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

// interleave duplicates or interleaves channels sample by sample.
func interleave(channels ...[]float64) []float64 {
	out := make([]float64, 0, len(channels[0])*len(channels))
	for i := range channels[0] {
		for _, ch := range channels {
			out = append(out, ch[i])
		}
	}
	return out
}

func stereo(mono []float64) []float64 { return interleave(mono, mono) }

func within(t *testing.T, name string, got *float64, want, tol float64) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = unavailable, want %.3f", name, want)
	}
	if math.Abs(*got-want) > tol {
		t.Fatalf("%s = %.4f, want %.4f ± %.3f", name, *got, want, tol)
	}
}
