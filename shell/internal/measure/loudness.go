package measure

import (
	"math"
)

const (
	// BS.1770 K-weighting: a high-shelf modelling head diffraction followed
	// by a high-pass, both defined by analog prototypes so they can be
	// derived for any sample rate.
	shelfFrequencyHz = 1681.974450955533
	shelfGainDB      = 3.999843853973347
	shelfQ           = 0.7071752369554196
	highpassFreqHz   = 38.13547087602444
	highpassQ        = 0.5003270373238773

	// BS.1770 gating: 400 ms blocks every 100 ms, an absolute gate at
	// -70 LUFS and a relative gate 10 LU below the mean of the blocks that
	// passed the absolute gate.
	subBlockSeconds    = 0.1
	subBlocksPerBlock  = 4
	absoluteGateLUFS   = -70.0
	relativeGateLU     = -10.0
	loudnessOffsetLUFS = -0.691
)

// biquadCoeffs are normalised (a0 == 1) second-order section coefficients.
type biquadCoeffs struct{ B0, B1, B2, A1, A2 float64 }

// kWeightCoefficients derives the two K-weighting stages for a sample rate.
func kWeightCoefficients(rate int) (shelf, highpass biquadCoeffs) {
	fs := float64(rate)

	k := math.Tan(math.Pi * shelfFrequencyHz / fs)
	vh := math.Pow(10, shelfGainDB/20)
	vb := math.Pow(vh, 0.4996667741545416)
	a0 := 1 + k/shelfQ + k*k
	shelf = biquadCoeffs{
		B0: (vh + vb*k/shelfQ + k*k) / a0,
		B1: 2 * (k*k - vh) / a0,
		B2: (vh - vb*k/shelfQ + k*k) / a0,
		A1: 2 * (k*k - 1) / a0,
		A2: (1 - k/shelfQ + k*k) / a0,
	}

	k = math.Tan(math.Pi * highpassFreqHz / fs)
	a0 = 1 + k/highpassQ + k*k
	highpass = biquadCoeffs{
		B0: 1,
		B1: -2,
		B2: 1,
		A1: 2 * (k*k - 1) / a0,
		A2: (1 - k/highpassQ + k*k) / a0,
	}
	return shelf, highpass
}

// biquad is a direct-form-II-transposed section with its own state.
type biquad struct {
	c      biquadCoeffs
	z1, z2 float64
}

func (b *biquad) process(x float64) float64 {
	y := b.c.B0*x + b.z1
	b.z1 = b.c.B1*x - b.c.A1*y + b.z2
	b.z2 = b.c.B2*x - b.c.A2*y
	return y
}

// loudnessMeter computes BS.1770-4 gated integrated loudness from streamed
// blocks. Mono and stereo channels both carry weight 1.0, so the channel
// energies are simply summed.
type loudnessMeter struct {
	shelf, highpass []biquad // one pair per channel
	subBlockFrames  int

	filledFrames  int     // frames accumulated in the current 100 ms sub-block
	subBlockSum   float64 // K-weighted energy of the current sub-block, summed over channels
	recentSubSums []float64
	blockEnergies []float64 // mean-square energy of every complete 400 ms block
}

func newLoudnessMeter(rate, channels int) *loudnessMeter {
	shelf, highpass := kWeightCoefficients(rate)
	m := &loudnessMeter{
		shelf:          make([]biquad, channels),
		highpass:       make([]biquad, channels),
		subBlockFrames: max(1, int(math.Round(float64(rate)*subBlockSeconds))),
	}
	for c := 0; c < channels; c++ {
		m.shelf[c] = biquad{c: shelf}
		m.highpass[c] = biquad{c: highpass}
	}
	return m
}

// Add filters and accumulates one block of per-channel samples.
func (m *loudnessMeter) Add(block [][]float64) {
	for i := range block[0] {
		for c := range block {
			y := m.highpass[c].process(m.shelf[c].process(block[c][i]))
			m.subBlockSum += y * y
		}
		m.filledFrames++
		if m.filledFrames == m.subBlockFrames {
			m.closeSubBlock()
		}
	}
}

func (m *loudnessMeter) closeSubBlock() {
	m.recentSubSums = append(m.recentSubSums, m.subBlockSum/float64(m.subBlockFrames))
	m.subBlockSum, m.filledFrames = 0, 0
	if len(m.recentSubSums) < subBlocksPerBlock {
		return
	}
	if len(m.recentSubSums) > subBlocksPerBlock {
		m.recentSubSums = m.recentSubSums[1:]
	}
	total := 0.0
	for _, e := range m.recentSubSums {
		total += e
	}
	m.blockEnergies = append(m.blockEnergies, total/subBlocksPerBlock)
}

func energyToLUFS(energy float64) float64 {
	return loudnessOffsetLUFS + 10*math.Log10(energy)
}

// IntegratedLUFS applies the absolute then relative gate. It returns nil when
// no block survives, rather than inventing a number for silence or a file
// shorter than one block.
func (m *loudnessMeter) IntegratedLUFS() *float64 {
	absolute := meanAbove(m.blockEnergies, absoluteGateLUFS)
	if absolute == nil {
		return nil
	}
	// Blocks are only ever averaged if they also passed the absolute gate,
	// even when the relative gate would otherwise fall below it.
	gated := meanAbove(m.blockEnergies, math.Max(energyToLUFS(*absolute)+relativeGateLU, absoluteGateLUFS))
	if gated == nil {
		return nil
	}
	value := energyToLUFS(*gated)
	return &value
}

// meanAbove averages the block energies louder than gateLUFS. Silent blocks
// have -Inf loudness and never pass a gate.
func meanAbove(energies []float64, gateLUFS float64) *float64 {
	total, count := 0.0, 0
	for _, e := range energies {
		if energyToLUFS(e) > gateLUFS {
			total += e
			count++
		}
	}
	if count == 0 {
		return nil
	}
	mean := total / float64(count)
	return &mean
}
