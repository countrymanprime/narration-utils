// Package measure computes generic audiobook delivery measurements from a
// WAV file: integrated loudness (BS.1770-4), RMS, sample and true peak, and
// the noise floor of the quietest room-tone window. It reads the file
// directly, so it works in a standalone launch with no REAPER running, and
// it never modifies audio.
//
// The measurements are deliberately distributor-neutral. Compliance with a
// particular delivery specification is expressed as a Profile (see
// profile.go) that a caller supplies once that specification has been
// independently verified.
package measure

import (
	"errors"
	"fmt"
	"io"
	"math"
	"os"
)

const (
	// readBlockFrames is how many frames are decoded per read.
	readBlockFrames = 4096

	// noiseWindowSeconds is the window over which room-tone RMS is judged.
	noiseWindowSeconds = 0.5
)

// Report holds the measurements for one file. A nil value means the
// measurement could not be made (silence, or audio shorter than the
// measurement needs) and is serialised as null: nothing is fabricated.
type Report struct {
	File            string  `json:"file,omitempty"`
	SampleRate      int     `json:"sample_rate"`
	Channels        int     `json:"channels"`
	DurationSeconds float64 `json:"duration_seconds"`

	IntegratedLUFS *float64 `json:"integrated_lufs"`
	RMSdBFS        *float64 `json:"rms_dbfs"`
	SamplePeakdBFS *float64 `json:"sample_peak_dbfs"`
	TruePeakdBTP   *float64 `json:"true_peak_dbtp"`
	NoiseFloordBFS *float64 `json:"noise_floor_dbfs"`

	// DigitalSilentWindows counts noise-floor windows that were exactly
	// zero. They are excluded from the noise floor: a silence-gated
	// recording has no measurable room tone there, and reporting -infinity
	// would look like a perfect floor.
	DigitalSilentWindows int `json:"digital_silent_windows"`
}

// Analyze measures WAV audio read from r.
func Analyze(r io.Reader) (Report, error) {
	reader, err := NewWAVReader(r)
	if err != nil {
		return Report{}, err
	}
	format := reader.Format()

	loudness := newLoudnessMeter(format.SampleRate, format.Channels)
	peaks := newTruePeakMeter(format.SampleRate, format.Channels)
	floor := newNoiseFloorMeter(format.SampleRate, format.Channels)
	var energy float64
	var frames int64

	for {
		block, err := reader.Read(readBlockFrames)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Report{}, err
		}
		loudness.Add(block)
		peaks.Add(block)
		floor.Add(block)
		for _, channel := range block {
			for _, s := range channel {
				energy += s * s
			}
		}
		frames += int64(len(block[0]))
	}

	peaks.Flush()

	report := Report{
		SampleRate:           format.SampleRate,
		Channels:             format.Channels,
		DurationSeconds:      float64(frames) / float64(format.SampleRate),
		IntegratedLUFS:       loudness.IntegratedLUFS(),
		SamplePeakdBFS:       ampToDB(peaks.SamplePeak()),
		TruePeakdBTP:         ampToDB(peaks.TruePeak()),
		NoiseFloordBFS:       floor.FloordBFS(),
		DigitalSilentWindows: floor.silentWindows,
	}
	if frames > 0 {
		report.RMSdBFS = energyToDB(energy / float64(frames*int64(format.Channels)))
	}
	return report, nil
}

// AnalyzeFile measures the WAV file at path and records the path.
func AnalyzeFile(path string) (Report, error) {
	file, err := os.Open(path)
	if err != nil {
		return Report{}, err
	}
	defer file.Close()

	report, err := Analyze(file)
	if err != nil {
		return Report{}, fmt.Errorf("%s: %w", path, err)
	}
	report.File = path
	return report, nil
}

// ampToDB converts a linear amplitude to dB, or nil for silence.
func ampToDB(amplitude float64) *float64 {
	if !(amplitude > 0) || math.IsInf(amplitude, 0) {
		return nil
	}
	value := 20 * math.Log10(amplitude)
	return &value
}

// energyToDB converts mean-square energy to dB, or nil for silence.
func energyToDB(meanSquare float64) *float64 {
	if !(meanSquare > 0) || math.IsInf(meanSquare, 0) {
		return nil
	}
	value := 10 * math.Log10(meanSquare)
	return &value
}

// noiseFloorMeter finds the quietest non-silent window of unweighted RMS.
type noiseFloorMeter struct {
	windowFrames int
	channels     int

	filled        int
	windowEnergy  float64
	quietest      float64 // smallest mean-square seen, valid when found
	found         bool
	silentWindows int
}

func newNoiseFloorMeter(rate, channels int) *noiseFloorMeter {
	return &noiseFloorMeter{
		windowFrames: max(1, int(math.Round(float64(rate)*noiseWindowSeconds))),
		channels:     channels,
	}
}

func (m *noiseFloorMeter) Add(block [][]float64) {
	for i := range block[0] {
		for c := range block {
			m.windowEnergy += block[c][i] * block[c][i]
		}
		m.filled++
		if m.filled == m.windowFrames {
			m.closeWindow()
		}
	}
}

func (m *noiseFloorMeter) closeWindow() {
	if m.windowEnergy == 0 {
		m.silentWindows++
	} else {
		meanSquare := m.windowEnergy / float64(m.windowFrames*m.channels)
		if !m.found || meanSquare < m.quietest {
			m.quietest, m.found = meanSquare, true
		}
	}
	m.filled, m.windowEnergy = 0, 0
}

// FloordBFS is the RMS of the quietest non-silent window, or nil when no
// full window contained any signal. A trailing partial window is ignored.
func (m *noiseFloorMeter) FloordBFS() *float64 {
	if !m.found {
		return nil
	}
	return energyToDB(m.quietest)
}
