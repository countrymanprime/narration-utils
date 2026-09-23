package measure

import "math"

const (
	// Short-term loudness is EBU R128's: BS.1770 K-weighted, ungated,
	// over a 3 s window. The series takes one every second.
	shortTermSubBlocks = 30 // 3 s of 100 ms sub-blocks
	shortTermHopBlocks = 10 // 1 s

	// levelShiftContextPoints is how many short-term points either side of
	// a point are compared (10 s of read at a 1 s hop), and
	// levelShiftMinSpeechPoints how many of them must be read, not pause,
	// for the comparison to be made at all.
	levelShiftContextPoints   = 10
	levelShiftMinSpeechPoints = 5
)

// LoudnessPoint is the short-term loudness of one window, timed from the
// start of the measured audio. LUFS is nil for a digitally silent window.
type LoudnessPoint struct {
	StartSeconds float64  `json:"start_seconds"`
	EndSeconds   float64  `json:"end_seconds"`
	LUFS         *float64 `json:"lufs"`
}

// LevelShift is a point where the read's loudness steps by at least the
// narrator's threshold: the mean short-term loudness of the read in the
// levelShiftContextPoints windows ending by the shift differs from that of
// the ones starting at it. The shift lies within StartSeconds-EndSeconds
// (one hop either side), timed from the start of the measured audio.
type LevelShift struct {
	StartSeconds float64 `json:"start_seconds"`
	EndSeconds   float64 `json:"end_seconds"`
	BeforeLUFS   float64 `json:"before_lufs"`
	AfterLUFS    float64 `json:"after_lufs"`
	DeltaLU      float64 `json:"delta_lu"`
}

// shortTermMeter builds the short-term loudness series.
type shortTermMeter struct {
	rate            int
	shelf, highpass []biquad
	subBlockFrames  int

	filled    int
	sum       float64
	subBlocks int                         // completed sub-blocks
	recent    [shortTermSubBlocks]float64 // ring of sub-block mean squares

	points   []LoudnessPoint
	energies []float64 // mean square of each point, for the speech gate
}

func newShortTermMeter(rate, channels int) *shortTermMeter {
	shelf, highpass := kWeightCoefficients(rate)
	m := &shortTermMeter{
		rate:           rate,
		shelf:          make([]biquad, channels),
		highpass:       make([]biquad, channels),
		subBlockFrames: max(1, int(math.Round(float64(rate)*subBlockSeconds))),
		points:         []LoudnessPoint{},
	}
	for c := range channels {
		m.shelf[c] = biquad{c: shelf}
		m.highpass[c] = biquad{c: highpass}
	}
	return m
}

func (m *shortTermMeter) Add(block [][]float64) {
	for i := range block[0] {
		for c := range block {
			y := m.highpass[c].process(m.shelf[c].process(block[c][i]))
			m.sum += y * y
		}
		m.filled++
		if m.filled == m.subBlockFrames {
			m.closeSubBlock()
		}
	}
}

func (m *shortTermMeter) closeSubBlock() {
	m.recent[m.subBlocks%shortTermSubBlocks] = m.sum / float64(m.subBlockFrames)
	m.sum, m.filled = 0, 0
	m.subBlocks++
	if m.subBlocks < shortTermSubBlocks || (m.subBlocks-shortTermSubBlocks)%shortTermHopBlocks != 0 {
		return
	}
	energy := 0.0
	for _, e := range m.recent {
		energy += e
	}
	energy /= shortTermSubBlocks
	point := LoudnessPoint{
		StartSeconds: m.seconds(m.subBlocks - shortTermSubBlocks),
		EndSeconds:   m.seconds(m.subBlocks),
	}
	if energy > 0 {
		value := energyToLUFS(energy)
		point.LUFS = &value
	}
	m.points = append(m.points, point)
	m.energies = append(m.energies, energy)
}

func (m *shortTermMeter) seconds(subBlocks int) float64 {
	return float64(subBlocks*m.subBlockFrames) / float64(m.rate)
}

// levelShifts compares, at every point, the read before it with the read
// after it, and keeps the largest step of each run of consecutive points
// that pass the threshold with the same sign: one shift, one place.
func (m *shortTermMeter) levelShifts(stepLU float64) []LevelShift {
	speech := m.speechPoints()
	overlap := shortTermSubBlocks / shortTermHopBlocks // windows ending by a point's start lie this many points back
	hop := m.seconds(shortTermHopBlocks)

	shifts := []LevelShift{}
	var best *LevelShift
	for i := range m.points {
		before, okBefore := meanOf(speech, i-overlap-levelShiftContextPoints+1, i-overlap+1)
		after, okAfter := meanOf(speech, i, i+levelShiftContextPoints)
		delta := after - before
		if !okBefore || !okAfter || math.Abs(delta) < stepLU {
			best = flushShift(&shifts, best)
			continue
		}
		at := m.points[i].StartSeconds
		candidate := LevelShift{StartSeconds: at - hop, EndSeconds: at + hop, BeforeLUFS: before, AfterLUFS: after, DeltaLU: delta}
		switch {
		case best == nil:
			best = &candidate
		case (best.DeltaLU > 0) != (delta > 0):
			flushShift(&shifts, best)
			best = &candidate
		case math.Abs(delta) > math.Abs(best.DeltaLU):
			best = &candidate
		}
	}
	flushShift(&shifts, best)
	return shifts
}

func flushShift(shifts *[]LevelShift, best *LevelShift) *LevelShift {
	if best != nil {
		*shifts = append(*shifts, *best)
	}
	return nil
}

// speechPoints is each point's loudness when it is read rather than
// pause, by BS.1770's gates applied to the series: louder than -70 LUFS
// and than 10 LU below the mean of those. NaN marks a pause.
func (m *shortTermMeter) speechPoints() []float64 {
	speech := make([]float64, len(m.points))
	for i := range speech {
		speech[i] = math.NaN()
	}
	absolute := meanAbove(m.energies, absoluteGateLUFS)
	if absolute == nil {
		return speech
	}
	gate := math.Max(energyToLUFS(*absolute)+relativeGateLU, absoluteGateLUFS)
	for i, point := range m.points {
		if point.LUFS != nil && *point.LUFS > gate {
			speech[i] = *point.LUFS
		}
	}
	return speech
}

// meanOf averages the speech points in [from, to), clipped to the series,
// and reports whether enough of them were speech to mean anything.
func meanOf(speech []float64, from, to int) (float64, bool) {
	total, count := 0.0, 0
	for i := max(from, 0); i < min(to, len(speech)); i++ {
		if !math.IsNaN(speech[i]) {
			total += speech[i]
			count++
		}
	}
	if count < levelShiftMinSpeechPoints {
		return 0, false
	}
	return total / float64(count), true
}
