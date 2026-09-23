package measure

import "math"

const (
	// minClipRunSamples is how many consecutive full-scale samples in one
	// channel count as clipping. A single full-scale sample happens in
	// legitimate audio; three in a row is the conventional sign that the
	// converter or a gain stage ran out of headroom.
	minClipRunSamples = 3

	// maxReportedClipRuns caps the runs listed in a report. Every run is
	// still counted in ClipRunCount, so a badly clipped file cannot produce
	// an unbounded report and the total is never understated.
	maxReportedClipRuns = 200
)

// ClipRun is one stretch of consecutive full-scale samples in one channel,
// timed from the start of the measured audio (the range start for a range).
type ClipRun struct {
	Channel         int     `json:"channel"`
	StartSeconds    float64 `json:"start_seconds"`
	DurationSeconds float64 `json:"duration_seconds"`
	Samples         int     `json:"samples"`
}

// fullScaleLevel is the magnitude at or above which a sample is pinned to
// the format's limit: the largest positive code of a PCM format (its most
// negative code is one step further out, so both extremes qualify), or 1.0
// for float, where anything beyond is over-range.
func fullScaleLevel(format Format) float64 {
	if format.Float {
		return 1
	}
	steps := math.Ldexp(1, format.BitsPerSample-1)
	return (steps - 1) / steps
}

// clipMeter counts full-scale samples and finds clip runs per channel.
type clipMeter struct {
	rate  int
	level float64

	frame     int64   // frames seen so far
	runStart  []int64 // per channel: first frame of the open run
	runLength []int   // per channel: length of the open run, 0 when none

	fullScale int64
	runCount  int
	runs      []ClipRun
}

func newClipMeter(format Format) *clipMeter {
	return &clipMeter{
		rate:      format.SampleRate,
		level:     fullScaleLevel(format),
		runStart:  make([]int64, format.Channels),
		runLength: make([]int, format.Channels),
		runs:      []ClipRun{},
	}
}

func (m *clipMeter) Add(block [][]float64) {
	for i := range block[0] {
		for c := range block {
			if math.Abs(block[c][i]) >= m.level {
				m.fullScale++
				if m.runLength[c] == 0 {
					m.runStart[c] = m.frame
				}
				m.runLength[c]++
				continue
			}
			m.closeRun(c)
		}
		m.frame++
	}
}

// Flush closes any run still open at the end of the audio.
func (m *clipMeter) Flush() {
	for c := range m.runLength {
		m.closeRun(c)
	}
}

func (m *clipMeter) closeRun(channel int) {
	length := m.runLength[channel]
	m.runLength[channel] = 0
	if length < minClipRunSamples {
		return
	}
	m.runCount++
	if len(m.runs) < maxReportedClipRuns {
		m.runs = append(m.runs, ClipRun{
			Channel:         channel,
			StartSeconds:    float64(m.runStart[channel]) / float64(m.rate),
			DurationSeconds: float64(length) / float64(m.rate),
			Samples:         length,
		})
	}
}
