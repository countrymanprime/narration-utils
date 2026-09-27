package acoustic

import (
	"fmt"
	"io"
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const (
	// frameMS and hopMS are the trial's analysis window and hop
	// (features_baseline.py FRAME_MS/HOP_MS): 40 ms frames every 10 ms.
	frameMS = 40.0
	hopMS   = 10.0

	// readChunkFrames bounds one WAVReader.Read call, mirroring measure's
	// own streaming chunk size so a chapter-length file never has to fit
	// in memory at once.
	readChunkFrames = 1 << 16
)

// readMonoRange decodes the WAV audio read from r, downmixing to mono and
// limiting to rng (nil for the whole stream). duration is the number of
// mono samples actually read divided by the sample rate - the real length
// analyzed, which can be shorter than rng asked for when the range runs
// past the end of the audio.
func readMonoRange(r io.Reader, rng *measure.Range) (mono []float64, sampleRate int, duration float64, err error) {
	reader, err := measure.NewWAVReader(r)
	if err != nil {
		return nil, 0, 0, err
	}
	format := reader.Format()
	sampleRate = format.SampleRate

	first, count, ok := rangeToFrames(rng, sampleRate)
	if !ok {
		return nil, 0, 0, fmt.Errorf("invalid analysis range %+v", *rng)
	}
	if first > 0 {
		if _, err := reader.Skip(first); err != nil {
			return nil, 0, 0, err
		}
	}

	remaining := count // -1 means read to EOF
	for remaining != 0 {
		want := readChunkFrames
		if remaining > 0 && int64(want) > remaining {
			want = int(remaining)
		}
		channels, readErr := reader.Read(want)
		if readErr != nil {
			if readErr == io.EOF { //nolint:errorlint // WAVReader.Read returns io.EOF verbatim, never wrapped
				break
			}
			return nil, 0, 0, readErr
		}
		n := len(channels[0])
		for i := 0; i < n; i++ {
			sum := 0.0
			for _, channel := range channels {
				sum += channel[i]
			}
			mono = append(mono, sum/float64(len(channels)))
		}
		if remaining > 0 {
			remaining -= int64(n)
		}
	}

	duration = float64(len(mono)) / float64(sampleRate)
	return mono, sampleRate, duration, nil
}

// rangeToFrames converts rng to a [first, first+count) span of whole frames
// at rate, mirroring measure.Range's own seconds-to-frames rounding
// (StartSeconds/LengthSeconds rounded to the nearest frame). It is
// duplicated here, rather than calling into measure, because that
// conversion is unexported: measure.Range's fields are the shared, public
// part of the contract, and a future shared range API (TR-8) only needs to
// keep using this same type for the two packages to keep agreeing on what a
// given Range means. count is -1 when rng is nil, meaning "read to EOF".
func rangeToFrames(rng *measure.Range, rate int) (first, count int64, ok bool) {
	if rng == nil {
		return 0, -1, true
	}
	finite := !math.IsNaN(rng.StartSeconds) && !math.IsInf(rng.StartSeconds, 0) &&
		!math.IsNaN(rng.LengthSeconds) && !math.IsInf(rng.LengthSeconds, 0)
	if !finite || rng.StartSeconds < 0 || rng.LengthSeconds <= 0 {
		return 0, 0, false
	}
	first = int64(math.Round(rng.StartSeconds * float64(rate)))
	count = max(1, int64(math.Round(rng.LengthSeconds*float64(rate))))
	return first, count, true
}

// frameSignal slices mono into overlapping analysis frames (frameMS long,
// hopMS apart), matching the trial's framing (features_baseline.py
// _frame). It returns no frames, rather than a short final one, when mono
// is shorter than one frame.
func frameSignal(mono []float64, sampleRate int) (frames [][]float64, frameLen, hopLen int) {
	frameLen = int(math.Round(float64(sampleRate) * frameMS / 1000))
	hopLen = int(math.Round(float64(sampleRate) * hopMS / 1000))
	if frameLen <= 0 || hopLen <= 0 || len(mono) < frameLen {
		return nil, frameLen, hopLen
	}
	n := 1 + (len(mono)-frameLen)/hopLen
	frames = make([][]float64, n)
	for i := 0; i < n; i++ {
		start := i * hopLen
		frames[i] = mono[start : start+frameLen]
	}
	return frames, frameLen, hopLen
}

// rms is the root-mean-square level of frame.
func rms(frame []float64) float64 {
	sum := 0.0
	for _, v := range frame {
		sum += v * v
	}
	return math.Sqrt(sum / float64(len(frame)))
}

// mean is the arithmetic mean of v, or 0 for an empty v (never NaN: a
// feature with nothing to average is reported as 0, matching the trial's
// own "if values else 0.0" fallback rather than propagating NaN into a
// finding).
func mean(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	sum := 0.0
	for _, x := range v {
		sum += x
	}
	return sum / float64(len(v))
}

// stddev is the population standard deviation of v (ddof 0, matching
// numpy's default .std()), or 0 for an empty v.
func stddev(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	m := mean(v)
	sum := 0.0
	for _, x := range v {
		sum += (x - m) * (x - m)
	}
	return math.Sqrt(sum / float64(len(v)))
}
