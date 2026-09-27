package mastering

import "math"

// Stage is one step of the chain. It takes blocks of per-channel samples in -1..1, in order, and may change them in
// place. Process may return fewer frames than it was given, when the stage holds some back to look ahead; Flush
// returns what it still holds, so over a whole file the frames out equal the frames in, aligned in time.
type Stage interface {
	Process(block [][]float64) [][]float64
	Flush() [][]float64
}

// The EQ is fixed (ADR 0320): a high-pass filter that takes out rumble and DC offset below the voice, and nothing
// else, so it never colours the narrator's own sound. A second-order Butterworth is 12 dB an octave below its corner.
const (
	HighPassHz = 80
	highPassQ  = math.Sqrt2 / 2
)

// EQStage is the chain's first stage: the fixed high-pass, one biquad per channel.
type EQStage struct {
	b0, b1, b2, a1, a2 float64
	state              []biquadState
}

type biquadState struct{ x1, x2, y1, y2 float64 }

// NewEQStage returns the fixed high-pass for audio at rate with the given number of channels (RBJ Audio EQ Cookbook
// coefficients).
func NewEQStage(rate, channels int) *EQStage {
	w0 := 2 * math.Pi * HighPassHz / float64(rate)
	cos, alpha := math.Cos(w0), math.Sin(w0)/(2*highPassQ)
	a0 := 1 + alpha
	return &EQStage{
		b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0,
		a1: -2 * cos / a0, a2: (1 - alpha) / a0,
		state: make([]biquadState, channels),
	}
}

// Process filters the block in place.
func (e *EQStage) Process(block [][]float64) [][]float64 {
	for c, channel := range block {
		s := &e.state[c]
		for i, x := range channel {
			y := e.b0*x + e.b1*s.x1 + e.b2*s.x2 - e.a1*s.y1 - e.a2*s.y2
			s.x2, s.x1, s.y2, s.y1 = s.x1, x, s.y1, y
			channel[i] = y
		}
	}
	return block
}

// Flush holds nothing: the EQ has no look-ahead.
func (e *EQStage) Flush() [][]float64 { return nil }

// The limiter's timing: it looks LookaheadSeconds ahead, so it has turned down fully by the time a peak arrives, and
// comes back up over ReleaseSeconds (the time to recover about 63% of the reduction).
const (
	LookaheadSeconds = 0.005
	ReleaseSeconds   = 0.1
)

// LimiterStage is the chain's second stage: a look-ahead sample-peak limiter. No sample it puts out, in any channel,
// is above its ceiling; the gain it applies is the same on every channel, so the stereo image does not move.
//
// For each frame n it needs the gain r[n] = min(1, ceiling/peak of frame n). It holds the smallest r over the last L
// frames, lets that hold rise back towards 1 no faster than the release, and averages it over L frames; the audio is
// delayed by L-1 frames. At the frame a peak leaves, every one of the L averaged values held that peak's r, so the
// average is at most r: the ceiling holds, and the gain ramps down over L frames rather than stepping.
type LimiterStage struct {
	ceiling  float64
	length   int
	release  float64
	channels int

	// window is a monotonic deque of (frame, r) over the last length frames, smallest r first.
	window []limitPoint
	frame  int
	held   float64
	// ring holds the last length held values, whose sum is the running average's numerator; delay holds the last
	// length-1 frames of audio, one ring per channel.
	ring    []float64
	ringAt  int
	ringSum float64
	delay   [][]float64
	delayAt int
	primed  int
}

type limitPoint struct {
	frame int
	r     float64
}

// NewLimiterStage returns a limiter holding audio at rate to ceiling, a linear amplitude above 0.
func NewLimiterStage(rate, channels int, ceiling float64) *LimiterStage {
	length := max(1, int(math.Round(LookaheadSeconds*float64(rate))))
	l := &LimiterStage{
		ceiling:  ceiling,
		length:   length,
		release:  1 - math.Exp(-1/(ReleaseSeconds*float64(rate))),
		channels: channels,
		held:     1,
		ring:     make([]float64, length),
		ringSum:  float64(length),
		delay:    make([][]float64, channels),
	}
	for i := range l.ring {
		l.ring[i] = 1
	}
	for c := range l.delay {
		l.delay[c] = make([]float64, length-1)
	}
	return l
}

// Process limits the block and returns the frames that have left the look-ahead.
func (l *LimiterStage) Process(block [][]float64) [][]float64 {
	frames := len(block[0])
	out := make([][]float64, l.channels)
	for c := range out {
		out[c] = make([]float64, 0, frames)
	}
	frame := make([]float64, l.channels)
	for i := 0; i < frames; i++ {
		for c := range frame {
			frame[c] = block[c][i]
		}
		l.push(frame, out)
	}
	return out
}

// Flush pushes silence through the look-ahead to let out the frames it still holds.
func (l *LimiterStage) Flush() [][]float64 {
	out := make([][]float64, l.channels)
	silence := make([]float64, l.channels)
	for range l.primed {
		l.push(silence, out)
	}
	l.primed = 0
	return out
}

// push takes in one frame and, once the look-ahead is full, appends the frame that leaves it to out.
func (l *LimiterStage) push(frame []float64, out [][]float64) {
	var p float64
	for _, s := range frame {
		p = math.Max(p, math.Abs(s))
	}
	r := 1.0
	if p > l.ceiling {
		r = l.ceiling / p
	}
	for len(l.window) > 0 && l.window[len(l.window)-1].r >= r {
		l.window = l.window[:len(l.window)-1]
	}
	l.window = append(l.window, limitPoint{frame: l.frame, r: r})
	if l.window[0].frame <= l.frame-l.length {
		l.window = l.window[1:]
	}
	l.frame++

	l.held = math.Min(l.window[0].r, l.held+(1-l.held)*l.release)
	l.ringSum += l.held - l.ring[l.ringAt]
	l.ring[l.ringAt] = l.held
	l.ringAt = (l.ringAt + 1) % l.length
	gain := math.Min(1, l.ringSum/float64(l.length))
	if l.ringSum >= float64(l.length) {
		// Nothing in the last length frames needed limiting: pass the audio through exactly, and stop the running sum
		// drifting.
		gain = 1
		l.ringSum = float64(l.length)
	}

	if l.length == 1 {
		for c, s := range frame {
			out[c] = append(out[c], l.limit(s*gain))
		}
		return
	}
	if l.primed < l.length-1 {
		for c, s := range frame {
			l.delay[c][l.delayAt] = s
		}
		l.delayAt = (l.delayAt + 1) % (l.length - 1)
		l.primed++
		return
	}
	for c, s := range frame {
		leaving := l.delay[c][l.delayAt]
		l.delay[c][l.delayAt] = s
		out[c] = append(out[c], l.limit(leaving*gain))
	}
	l.delayAt = (l.delayAt + 1) % (l.length - 1)
}

// limit clamps what rounding in the running average could leave a hair over the ceiling.
func (l *LimiterStage) limit(s float64) float64 {
	return math.Max(-l.ceiling, math.Min(l.ceiling, s))
}

// GainStage is the chain's last stage: a fixed gain, which brings the limited audio into the RMS window.
type GainStage struct {
	factor float64
}

// NewGainStage returns a gain of db decibels.
func NewGainStage(db float64) *GainStage { return &GainStage{factor: math.Pow(10, db/20)} }

// Process scales the block in place.
func (g *GainStage) Process(block [][]float64) [][]float64 {
	for _, channel := range block {
		for i := range channel {
			channel[i] *= g.factor
		}
	}
	return block
}

// Flush holds nothing.
func (g *GainStage) Flush() [][]float64 { return nil }
