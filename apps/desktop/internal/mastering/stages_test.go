package mastering

import (
	"math"
	"testing"
)

const rate = 44100

// Each stage is proven alone on analytic signals whose RMS and peak are known in closed form: a sine of amplitude A has
// peak A and RMS A/sqrt(2).

func TestEQPassesSpeechBandUnchanged(t *testing.T) {
	in := [][]float64{sine(rate, 2, 1000, 0.5)}
	out := run(t, NewEQStage(rate, 1), in, 4096)
	if len(out[0]) != len(in[0]) {
		t.Fatalf("EQ changed the length: %d frames in, %d out", len(in[0]), len(out[0]))
	}
	// Skip the filter's first 100 ms of settling.
	settled := [][]float64{out[0][rate/10:]}
	want := dB(0.5 / math.Sqrt2)
	if got := rmsDB(settled); math.Abs(got-want) > 0.05 {
		t.Fatalf("1 kHz RMS after EQ = %.3f dB, want %.3f ± 0.05", got, want)
	}
}

func TestEQCutsRumbleBelowTheHighPass(t *testing.T) {
	// A second-order high-pass at 80 Hz is 12 dB an octave: 20 Hz, two octaves below, is cut by about 24 dB.
	in := [][]float64{sine(rate, 4, 20, 0.5)}
	out := run(t, NewEQStage(rate, 1), in, 1000)
	settled := [][]float64{out[0][rate:]}
	if cut := dB(0.5/math.Sqrt2) - rmsDB(settled); cut < 20 {
		t.Fatalf("20 Hz is cut by %.1f dB, want at least 20", cut)
	}
}

func TestEQRemovesDCOffset(t *testing.T) {
	in := [][]float64{make([]float64, rate*2)}
	for i := range in[0] {
		in[0][i] = 0.2
	}
	out := run(t, NewEQStage(rate, 1), in, 4096)
	if tail := math.Abs(out[0][len(out[0])-1]); tail > 1e-4 {
		t.Fatalf("DC offset after 2 s of EQ = %g, want about 0", tail)
	}
}

func TestEQKeepsChannelsIndependent(t *testing.T) {
	in := [][]float64{sine(rate, 1, 1000, 0.5), make([]float64, rate)}
	out := run(t, NewEQStage(rate, 2), in, 512)
	if p := peak([][]float64{out[1]}); p != 0 {
		t.Fatalf("silent right channel peaks at %g after EQ, want 0", p)
	}
}

func TestLimiterHoldsPeaksAtTheCeiling(t *testing.T) {
	ceiling := 0.5
	for _, blockFrames := range []int{1, 100, 4096} {
		in := [][]float64{sine(rate, 1, 440, 0.9), sine(rate, 1, 660, 0.3)}
		out := run(t, NewLimiterStage(rate, 2, ceiling), in, blockFrames)
		if len(out[0]) != len(in[0]) || len(out[1]) != len(in[1]) {
			t.Fatalf("blocks of %d: limiter changed the length", blockFrames)
		}
		if p := peak(out); p > ceiling+1e-12 {
			t.Fatalf("blocks of %d: peak after limiting = %.6f, want at most %.6f", blockFrames, p, ceiling)
		}
		if p := peak(out); p < ceiling*0.99 {
			t.Fatalf("blocks of %d: peak after limiting = %.6f, want close to the ceiling %.6f", blockFrames, p, ceiling)
		}
	}
}

func TestLimiterLeavesAudioUnderTheCeilingUntouched(t *testing.T) {
	in := [][]float64{sine(rate, 1, 440, 0.4)}
	out := run(t, NewLimiterStage(rate, 1, 0.5), in, 777)
	for i := range in[0] {
		if out[0][i] != in[0][i] {
			t.Fatalf("sample %d = %g, want %g: a limiter under its ceiling must not change the audio or shift it in time", i, out[0][i], in[0][i])
		}
	}
}

func TestLimiterCatchesAnIsolatedSpikeAndReleases(t *testing.T) {
	// A quiet tone with one full-scale spike: the spike is held to the ceiling, and a second later the tone is back
	// to its own level (the limiter released).
	in := sine(rate, 2, 300, 0.1)
	spikeAt := rate / 2
	in[spikeAt] = 0.99
	out := run(t, NewLimiterStage(rate, 1, 0.25), [][]float64{in}, 4096)
	if p := math.Abs(out[0][spikeAt]); p > 0.25+1e-12 {
		t.Fatalf("spike after limiting = %g, want at most 0.25", p)
	}
	later := [][]float64{out[0][spikeAt+rate:]}
	if got, want := rmsDB(later), dB(0.1/math.Sqrt2); math.Abs(got-want) > 0.01 {
		t.Fatalf("tone one second after the spike = %.3f dB, want %.3f: the limiter did not release", got, want)
	}
}

func TestGainShiftsRMSAndPeakByExactlyItsDecibels(t *testing.T) {
	in := [][]float64{sine(rate, 1, 1000, 0.1), sine(rate, 1, 500, 0.05)}
	before, beforePeak := rmsDB(in), peak(in)
	out := run(t, NewGainStage(6), in, 1024)
	if got := rmsDB(out) - before; math.Abs(got-6) > 1e-9 {
		t.Fatalf("RMS moved by %.9f dB, want 6", got)
	}
	if got := dB(peak(out)) - dB(beforePeak); math.Abs(got-6) > 1e-9 {
		t.Fatalf("peak moved by %.9f dB, want 6", got)
	}
}

func TestLimiterTurnsDownRatherThanClipping(t *testing.T) {
	// A clipper would flatten every crest of a 0.9 sine held to 0.5: over half its samples pinned at the ceiling. The
	// limiter turns the whole wave down instead, so once it has settled the wave keeps its shape: a sine of amplitude
	// 0.5, touching the ceiling only at its crests.
	in := [][]float64{sine(rate, 1, 440, 0.9)}
	out := run(t, NewLimiterStage(rate, 1, 0.5), in, 4096)
	settled := out[0][rate/2:]
	var pinned int
	for _, s := range settled {
		if math.Abs(s) >= 0.5-1e-9 {
			pinned++
		}
	}
	if fraction := float64(pinned) / float64(len(settled)); fraction > 0.01 {
		t.Fatalf("%.0f%% of samples sit at the ceiling: the limiter is clipping", fraction*100)
	}
	if got, want := rmsDB([][]float64{settled}), dB(0.5/math.Sqrt2); math.Abs(got-want) > 0.05 {
		t.Fatalf("settled RMS = %.3f dB, want %.3f: a sine turned down to the ceiling", got, want)
	}
}
