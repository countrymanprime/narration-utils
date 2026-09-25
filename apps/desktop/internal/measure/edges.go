package measure

import "math"

// edgeFloordBFS is the level a 50 ms window must reach to count as the start (or end) of the reading when the edges
// of a file are timed: the diagnostics silence floor (ADR 0158), so room tone is what the silence map calls silence.
const edgeFloordBFS = -50

// edgeMeter times the room tone at a file's edges (delivery profiles PRD, Phase 5): from the start of the audio to the
// first window at or above the edge floor (the head), and from the end of the last such window to the end of the
// audio (the tail). It also counts, within each, the windows that are exactly zero: digital silence, which a platform
// that asks for room tone does not accept as room tone. Windows are those of the silence map.
type edgeMeter struct {
	rate, channels int
	windowFrames   int
	floorEnergy    float64

	filled       int
	windowEnergy float64
	frame        int64 // frames closed so far

	loud           bool  // a window at or above the floor has been seen
	headFrames     int64 // frames before the first loud window
	headZeroFrames int64 // exact-zero frames among them
	lastLoudEnd    int64 // frame after the last loud window
	tailZeroFrames int64 // exact-zero frames after the last loud window
}

func newEdgeMeter(format Format) *edgeMeter {
	return &edgeMeter{
		rate:         format.SampleRate,
		channels:     format.Channels,
		windowFrames: max(1, int(math.Round(silenceWindowSeconds*float64(format.SampleRate)))),
		floorEnergy:  math.Pow(10, edgeFloordBFS/10.0),
	}
}

func (m *edgeMeter) Add(block [][]float64) {
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

// Flush judges a trailing partial window on its own length.
func (m *edgeMeter) Flush() {
	if m.filled > 0 {
		m.closeWindow()
	}
}

func (m *edgeMeter) closeWindow() {
	frames := int64(m.filled)
	energy := m.windowEnergy
	m.frame += frames
	m.filled, m.windowEnergy = 0, 0

	if energy/float64(frames*int64(m.channels)) >= m.floorEnergy {
		m.loud, m.lastLoudEnd, m.tailZeroFrames = true, m.frame, 0
		return
	}
	zero := energy == 0
	if !m.loud {
		m.headFrames += frames
		if zero {
			m.headZeroFrames += frames
		}
	}
	if zero {
		m.tailZeroFrames += frames
	}
}

// edges answers the head and tail room tone and the digital silence within each, in seconds, or nils when no window
// reached the floor: with no reading in the audio there is no edge to time from.
func (m *edgeMeter) edges() (head, tail, headZeros, tailZeros *float64) {
	if !m.loud {
		return nil, nil, nil, nil
	}
	seconds := func(frames int64) *float64 {
		value := float64(frames) / float64(m.rate)
		return &value
	}
	return seconds(m.headFrames), seconds(m.frame - m.lastLoudEnd), seconds(m.headZeroFrames), seconds(m.tailZeroFrames)
}
