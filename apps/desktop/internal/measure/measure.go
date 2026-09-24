// Package measure computes generic audiobook delivery measurements from a
// WAV file, or a time range of one (range.go): integrated loudness
// (BS.1770-4), RMS, sample and true peak, the noise floor of the quietest
// room-tone window, and clipping (clipping.go). It reads the file directly,
// so it works in a standalone launch with no REAPER running, and it never
// modifies audio. takemetrics.go builds per-take evidence on top of a
// range measurement.
//
// The measurements are deliberately distributor-neutral. Compliance with a
// particular delivery specification is expressed as a Profile (see
// profile.go) that a caller supplies once that specification has been
// independently verified.
package measure

import (
	"context"
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

	// FullScaleSamples counts samples pinned at the format's limit, in any
	// channel. ClipRunCount counts runs of minClipRunSamples or more of
	// them in one channel (clipping); ClipRuns lists the first
	// maxReportedClipRuns of those runs, in the order they end. Zero is a
	// measurement: clean audio reports 0 and an empty list, never null.
	FullScaleSamples int64     `json:"full_scale_samples"`
	ClipRunCount     int       `json:"clip_run_count"`
	ClipRuns         []ClipRun `json:"clip_runs"`

	// Range is the requested range when the report measures part of a
	// file (AnalyzeRange); DurationSeconds is then how much of that range
	// the file actually held. Nil for a whole-file report.
	Range *Range `json:"range,omitempty"`
}

// Analyze measures WAV audio read from r.
func Analyze(r io.Reader) (Report, error) {
	return analyze(context.Background(), r, Options{}, -1)
}

// measureFrames measures up to limit frames from the reader's position, checking ctx before every block and
// telling meter after it (analyze.go).
func measureFrames(ctx context.Context, reader *WAVReader, limit int64, meter *progressMeter) (Report, error) {
	meters := newMeterSet(reader.Format())
	for meters.frames < limit {
		if err := ctx.Err(); err != nil {
			return Report{}, err
		}
		block, err := reader.Read(int(min(readBlockFrames, limit-meters.frames)))
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Report{}, err
		}
		meters.Add(block)
		meter.tick()
	}
	meter.finish()
	return meters.Report(), nil
}

// meterSet runs every measurement over the same stream of blocks.
type meterSet struct {
	format   Format
	loudness *loudnessMeter
	peaks    *truePeakMeter
	floor    *noiseFloorMeter
	clips    *clipMeter
	energy   float64
	frames   int64
}

func newMeterSet(format Format) *meterSet {
	return &meterSet{
		format:   format,
		loudness: newLoudnessMeter(format.SampleRate, format.Channels),
		peaks:    newTruePeakMeter(format.SampleRate, format.Channels),
		floor:    newNoiseFloorMeter(format.SampleRate, format.Channels),
		clips:    newClipMeter(format),
	}
}

func (m *meterSet) Add(block [][]float64) {
	m.loudness.Add(block)
	m.peaks.Add(block)
	m.floor.Add(block)
	m.clips.Add(block)
	for _, channel := range block {
		for _, s := range channel {
			m.energy += s * s
		}
	}
	m.frames += int64(len(block[0]))
}

func (m *meterSet) Report() Report {
	m.peaks.Flush()
	m.clips.Flush()
	report := Report{
		SampleRate:           m.format.SampleRate,
		Channels:             m.format.Channels,
		DurationSeconds:      float64(m.frames) / float64(m.format.SampleRate),
		IntegratedLUFS:       m.loudness.IntegratedLUFS(),
		SamplePeakdBFS:       ampToDB(m.peaks.SamplePeak()),
		TruePeakdBTP:         ampToDB(m.peaks.TruePeak()),
		NoiseFloordBFS:       m.floor.FloordBFS(),
		DigitalSilentWindows: m.floor.silentWindows,
		FullScaleSamples:     m.clips.fullScale,
		ClipRunCount:         m.clips.runCount,
		ClipRuns:             m.clips.runs,
	}
	if m.frames > 0 {
		report.RMSdBFS = energyToDB(m.energy / float64(m.frames*int64(m.format.Channels)))
	}
	return report
}

// AnalyzeFile measures the WAV file at path and records the path.
func AnalyzeFile(path string) (Report, error) {
	file, err := os.Open(path)
	if err != nil {
		return Report{}, err
	}
	defer func() { _ = file.Close() }() // read-only

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
