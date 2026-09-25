package measure

import (
	"context"
	"fmt"
	"io"
	"math"
	"os"
)

const (
	// DefaultPeaksPerSecond is the waveform's resolution: 50 buckets a second, 20 ms each, which is
	// finer than a word (edit-and-proof-workspace PRD Phase 5).
	DefaultPeaksPerSecond = 50
	// MaxPeaksPerSecond bounds a zoomed-in request, so one call can never ask for more buckets than frames.
	MaxPeaksPerSecond = 1000
)

// Peaks is a waveform overview of a stretch of a WAV source: for each bucket of 1/BucketsPerSecond
// seconds, the lowest and highest sample over every channel. MinMax holds two signed bytes per
// bucket, the minimum then the maximum, scaled so full scale is ±127; a caller that sends it as JSON
// gets base64. The minimum is rounded down and the maximum up, so a peak is never drawn smaller than
// it is. The last bucket may be partial. Buckets is 0 when the range starts after the audio ends.
type Peaks struct {
	StartSeconds     float64 `json:"startSeconds"`
	BucketsPerSecond int     `json:"bucketsPerSecond"`
	Buckets          int     `json:"buckets"`
	MinMax           []byte  `json:"minMax"`
	SampleRate       int     `json:"sampleRate"`
	Channels         int     `json:"channels"`
}

// ComputePeaks reads the WAV audio from r and returns its peaks at perSecond buckets a second, over
// rng when it is not nil (an item's played range in source seconds, whose earlier audio is skipped
// without being decoded) or over the whole file. A source that is not a WAV answers ErrNotWAV. It
// stops with ctx's error when ctx is cancelled.
func ComputePeaks(ctx context.Context, r io.Reader, rng *Range, perSecond int) (Peaks, error) {
	if perSecond <= 0 || perSecond > MaxPeaksPerSecond {
		return Peaks{}, fmt.Errorf("peaks need 1 to %d buckets a second, not %d", MaxPeaksPerSecond, perSecond)
	}
	if rng != nil {
		if err := rng.validate(); err != nil {
			return Peaks{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return Peaks{}, err
	}
	reader, err := NewWAVReader(r)
	if err != nil {
		return Peaks{}, err
	}
	format := reader.Format()
	first, count := int64(0), int64(math.MaxInt64)
	peaks := Peaks{BucketsPerSecond: perSecond, SampleRate: format.SampleRate, Channels: format.Channels}
	if rng != nil {
		first, count = rng.frames(format.SampleRate)
		peaks.StartSeconds = rng.StartSeconds
	}
	if err := skipFrames(ctx, reader, first, &progressMeter{reader: reader}); err != nil {
		return Peaks{}, err
	}

	// Bucket k holds the frames n with k*rate <= n*perSecond < (k+1)*rate, so it ends before frame
	// ceil((k+1)*rate/perSecond).
	rate, per := int64(format.SampleRate), int64(perSecond)
	bucket, end := int64(0), (rate+per-1)/per
	low, high, filled := math.Inf(1), math.Inf(-1), false
	flush := func() {
		if filled {
			peaks.MinMax = append(peaks.MinMax, peakByte(math.Floor(low*127)), peakByte(math.Ceil(high*127)))
		}
		bucket++
		end = ((bucket+1)*rate + per - 1) / per
		low, high, filled = math.Inf(1), math.Inf(-1), false
	}
	for read := int64(0); read < count; {
		if err := ctx.Err(); err != nil {
			return Peaks{}, err
		}
		block, err := reader.Read(int(min(readBlockFrames*16, count-read)))
		if err == io.EOF {
			break
		}
		if err != nil {
			return Peaks{}, err
		}
		frames := int64(len(block[0]))
		for i := int64(0); i < frames; {
			stop := min(frames, i+end-read)
			for _, channel := range block {
				for _, v := range channel[i:stop] {
					if v < low {
						low = v
					}
					if v > high {
						high = v
					}
				}
			}
			filled = filled || stop > i
			read += stop - i
			i = stop
			if read == end {
				flush()
			}
		}
	}
	flush()
	peaks.Buckets = len(peaks.MinMax) / 2
	return peaks, nil
}

// PeaksFile computes the peaks of the WAV file at path (see ComputePeaks).
func PeaksFile(ctx context.Context, path string, rng *Range, perSecond int) (Peaks, error) {
	file, err := os.Open(path)
	if err != nil {
		return Peaks{}, err
	}
	defer func() { _ = file.Close() }()
	return ComputePeaks(ctx, file, rng, perSecond)
}

// peakByte stores a scaled sample, clamped to ±127, as a two's complement byte.
func peakByte(scaled float64) byte {
	return byte(int8(math.Max(-127, math.Min(127, scaled)))) //nolint:gosec // G115: clamped to the int8 range just above
}
