package continuity

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// writeToneWAV writes a 16-bit mono WAV: silence, then a tone at freq Hz,
// then silence - synthetic audio only (D70/D71), no recorded speech.
func writeToneWAV(t *testing.T, freq float64) string {
	t.Helper()
	const rate = 16000
	var samples []float64
	samples = append(samples, make([]float64, rate)...)
	for i := range 2 * rate {
		samples = append(samples, 0.3*math.Sin(2*math.Pi*freq*float64(i)/rate))
	}
	samples = append(samples, make([]float64, rate)...)

	var data bytes.Buffer
	for _, s := range samples {
		_ = binary.Write(&data, binary.LittleEndian, int16(math.Round(s*32767)))
	}
	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(4+8+16+8+data.Len()))
	out.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(rate), uint32(rate * 2), uint16(2), uint16(16)} {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	out.WriteString("data")
	_ = binary.Write(&out, binary.LittleEndian, uint32(data.Len()))
	out.Write(data.Bytes())

	path := filepath.Join(t.TempDir(), "tone.wav")
	if err := os.WriteFile(path, out.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestFileMeasurerMeasuresOnlyTheClipsRange(t *testing.T) {
	path := writeToneWAV(t, 200)
	got, err := FileMeasurer{}.Measure(Clip{File: path, Range: measure.Range{StartSeconds: 1, LengthSeconds: 2}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Features.F0MedianHz == nil || math.Abs(*got.Features.F0MedianHz-200) > 5 {
		t.Fatalf("F0 median = %v, want about 200 Hz", got.Features.F0MedianHz)
	}
	if got.RMSdBFS == nil || math.Abs(*got.RMSdBFS-(20*math.Log10(0.3/math.Sqrt2))) > 1 {
		t.Fatalf("RMS = %v dBFS", got.RMSdBFS)
	}

	silent, err := FileMeasurer{}.Measure(Clip{File: path, Range: measure.Range{StartSeconds: 0, LengthSeconds: 0.9}})
	if err != nil {
		t.Fatal(err)
	}
	if silent.Features.F0MedianHz != nil {
		t.Fatalf("a silent range reported F0 %v", *silent.Features.F0MedianHz)
	}
}

func TestFileMeasurerReportsAMissingFile(t *testing.T) {
	if _, err := (FileMeasurer{}).Measure(Clip{File: filepath.Join(t.TempDir(), "gone.wav"), Range: measure.Range{LengthSeconds: 1}}); err == nil {
		t.Fatal("a missing file was measured")
	}
}
