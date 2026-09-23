package measure

import "math"

// silenceWindowSeconds is the resolution of the silence map: the window
// over which unweighted RMS is compared with the silence floor.
const silenceWindowSeconds = 0.05

// SilenceRegion is a run of silent windows at least the minimum silence
// long, timed from the start of the measured audio. LeveldBFS is the RMS
// of its windows that hold any signal; a region of nothing but exact zeros
// is DigitalSilence and has no level (a gate or an edit, not a room).
type SilenceRegion struct {
	StartSeconds   float64  `json:"start_seconds"`
	EndSeconds     float64  `json:"end_seconds"`
	LeveldBFS      *float64 `json:"level_dbfs"`
	DigitalSilence bool     `json:"digital_silence"`
}

// RoomToneSegment is a stretch of the audio whose silences share one room
// tone: each silence in it is within the room-tone step of the segment's
// level (the RMS over all of them). It runs from its first silence's start
// to its last silence's end.
type RoomToneSegment struct {
	StartSeconds float64 `json:"start_seconds"`
	EndSeconds   float64 `json:"end_seconds"`
	LeveldBFS    float64 `json:"level_dbfs"`
	Regions      int     `json:"regions"`
}

// silenceSpan is a region in frames with the energy of its signal windows.
type silenceSpan struct {
	start, end   int64
	energy       float64 // summed squares over the signal windows, all channels
	signalFrames int64   // frames in windows that were not exactly zero
}

// silenceMapper finds silence regions in fixed windows.
type silenceMapper struct {
	rate, channels int
	windowFrames   int
	floorEnergy    float64 // mean square of the silence floor
	minFrames      int64

	filled       int
	windowEnergy float64
	frame        int64 // first frame of the current window

	open  bool
	span  silenceSpan
	spans []silenceSpan
}

func newSilenceMapper(format Format, floordBFS, minSeconds float64) *silenceMapper {
	return &silenceMapper{
		rate:         format.SampleRate,
		channels:     format.Channels,
		windowFrames: max(1, int(math.Round(silenceWindowSeconds*float64(format.SampleRate)))),
		floorEnergy:  math.Pow(10, floordBFS/10),
		minFrames:    max(1, int64(math.Round(minSeconds*float64(format.SampleRate)))),
		spans:        []silenceSpan{},
	}
}

func (m *silenceMapper) Add(block [][]float64) {
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

// Flush judges a trailing partial window on its own length and closes any
// open region at the end of the audio.
func (m *silenceMapper) Flush() {
	if m.filled > 0 {
		m.closeWindow()
	}
	m.closeRegion(m.frame)
}

func (m *silenceMapper) closeWindow() {
	start, frames := m.frame, int64(m.filled)
	energy := m.windowEnergy
	m.frame += frames
	m.filled, m.windowEnergy = 0, 0

	if energy/float64(frames*int64(m.channels)) >= m.floorEnergy {
		m.closeRegion(start)
		return
	}
	if !m.open {
		m.open, m.span = true, silenceSpan{start: start}
	}
	m.span.end = start + frames
	if energy > 0 {
		m.span.energy += energy
		m.span.signalFrames += frames
	}
}

func (m *silenceMapper) closeRegion(end int64) {
	if m.open && end-m.span.start >= m.minFrames {
		m.spans = append(m.spans, m.span)
	}
	m.open = false
}

func (m *silenceMapper) seconds(frame int64) float64 {
	return float64(frame) / float64(m.rate)
}

func (m *silenceMapper) regions() []SilenceRegion {
	regions := make([]SilenceRegion, len(m.spans))
	for i, span := range m.spans {
		regions[i] = SilenceRegion{
			StartSeconds:   m.seconds(span.start),
			EndSeconds:     m.seconds(span.end),
			LeveldBFS:      m.levelOf(span.energy, span.signalFrames),
			DigitalSilence: span.signalFrames == 0,
		}
	}
	return regions
}

func (m *silenceMapper) levelOf(energy float64, frames int64) *float64 {
	if frames == 0 {
		return nil
	}
	return energyToDB(energy / float64(frames*int64(m.channels)))
}

// roomToneSegments groups the silences that have a level into segments of
// one room tone. A silence whose level is at least stepDB from the current
// segment's starts a new one. Digitally silent regions say nothing about
// the room and are skipped.
func (m *silenceMapper) roomToneSegments(stepDB float64) []RoomToneSegment {
	segments := []RoomToneSegment{}
	var current *silenceSpan // the running segment, as one merged span
	count := 0
	flush := func() {
		if current != nil {
			segments = append(segments, RoomToneSegment{
				StartSeconds: m.seconds(current.start),
				EndSeconds:   m.seconds(current.end),
				LeveldBFS:    *m.levelOf(current.energy, current.signalFrames),
				Regions:      count,
			})
		}
	}
	for _, span := range m.spans {
		level := m.levelOf(span.energy, span.signalFrames)
		if level == nil {
			continue
		}
		if current != nil && math.Abs(*level-*m.levelOf(current.energy, current.signalFrames)) < stepDB {
			current.end = span.end
			current.energy += span.energy
			current.signalFrames += span.signalFrames
			count++
			continue
		}
		flush()
		next := span
		current, count = &next, 1
	}
	flush()
	return segments
}
