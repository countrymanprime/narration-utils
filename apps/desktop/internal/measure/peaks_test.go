package measure

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

// minMax reads bucket k of a Peaks back as two signed values.
func minMax(p Peaks, k int) (int8, int8) {
	return int8(p.MinMax[2*k]), int8(p.MinMax[2*k+1]) //nolint:gosec // G115: the bytes are two's complement by definition
}

func peaksOf(t *testing.T, wav []byte, rng *Range, perSecond int) Peaks {
	t.Helper()
	peaks, err := ComputePeaks(context.Background(), bytes.NewReader(wav), rng, perSecond)
	if err != nil {
		t.Fatal(err)
	}
	return peaks
}

func near1(a, b int8) bool { return a-b <= 1 && b-a <= 1 }

// The edit and proof workspace PRD Phase 5 (EP12 A): the host draws the waveform from min and max
// peaks per bucket, computed from the WAV source with the existing reader.
func TestPeaksAreTheMinimumAndMaximumOfEachBucket(t *testing.T) {
	wav := encodeWAV(t, 1, 8000, 16, false, sine(8000, 1, 220, -6, 0))
	peaks := peaksOf(t, wav, nil, 50)
	if peaks.Buckets != 50 || len(peaks.MinMax) != 100 || peaks.BucketsPerSecond != 50 || peaks.StartSeconds != 0 {
		t.Fatalf("peaks = %d buckets, %d bytes at %d/s from %v; want 50 buckets, 100 bytes at 50/s from 0", peaks.Buckets, len(peaks.MinMax), peaks.BucketsPerSecond, peaks.StartSeconds)
	}
	if peaks.SampleRate != 8000 || peaks.Channels != 1 {
		t.Fatalf("format = %d Hz, %d channels", peaks.SampleRate, peaks.Channels)
	}
	// -6 dB is 0.501 of full scale, 63.6 of 127: every 20 ms bucket holds several whole periods of 220 Hz.
	for k := range peaks.Buckets {
		low, high := minMax(peaks, k)
		if !near1(high, 64) || !near1(low, -64) {
			t.Fatalf("bucket %d = [%d, %d], want about [-64, 64]", k, low, high)
		}
	}
}

func TestSilenceIsAFlatLine(t *testing.T) {
	peaks := peaksOf(t, encodeWAV(t, 1, 8000, 16, false, silence(8000, 0.5)), nil, 50)
	for k := range peaks.Buckets {
		if low, high := minMax(peaks, k); low != 0 || high != 0 {
			t.Fatalf("bucket %d = [%d, %d], want [0, 0]", k, low, high)
		}
	}
}

func TestFullScaleIsNeverClippedBeyond127(t *testing.T) {
	wav := encodeWAV(t, 1, 8000, 32, true, []float64{1, -1, 1, -1})
	low, high := minMax(peaksOf(t, wav, nil, 50), 0)
	if low != -127 || high != 127 {
		t.Fatalf("full scale = [%d, %d], want [-127, 127]", low, high)
	}
}

func TestAStereoBucketCoversBothChannels(t *testing.T) {
	left := silence(8000, 1)
	right := sine(8000, 1, 220, -6, 0)
	peaks := peaksOf(t, encodeWAV(t, 2, 8000, 24, false, interleave(left, right)), nil, 10)
	if peaks.Channels != 2 || peaks.Buckets != 10 {
		t.Fatalf("peaks = %d channels, %d buckets", peaks.Channels, peaks.Buckets)
	}
	if low, high := minMax(peaks, 3); !near1(high, 64) || !near1(low, -64) {
		t.Fatalf("bucket 3 = [%d, %d], want the right channel's [-64, 64]", low, high)
	}
}

func TestAPartialLastBucketStillCounts(t *testing.T) {
	// 1.01 s at 50 buckets a second: 50 whole buckets and half of one more.
	peaks := peaksOf(t, encodeWAV(t, 1, 8000, 16, false, sine(8000, 1.01, 220, -6, 0)), nil, 50)
	if peaks.Buckets != 51 {
		t.Fatalf("buckets = %d, want 51", peaks.Buckets)
	}
}

func TestPeaksOfAPlayedRangeSkipTheAudioBeforeIt(t *testing.T) {
	// Silence, a tone, silence: the item plays only the middle second.
	samples := concat(silence(8000, 1), sine(8000, 1, 220, -6, 0), silence(8000, 1))
	peaks := peaksOf(t, encodeWAV(t, 1, 8000, 16, false, samples), &Range{StartSeconds: 1, LengthSeconds: 1}, 50)
	if peaks.Buckets != 50 || peaks.StartSeconds != 1 {
		t.Fatalf("peaks = %d buckets from %v s, want 50 from 1 s", peaks.Buckets, peaks.StartSeconds)
	}
	for k := range peaks.Buckets {
		if low, high := minMax(peaks, k); !near1(high, 64) || !near1(low, -64) {
			t.Fatalf("bucket %d = [%d, %d], want the tone", k, low, high)
		}
	}
}

func TestARangePastTheEndHasPeaksForWhatExists(t *testing.T) {
	wav := encodeWAV(t, 1, 8000, 16, false, sine(8000, 1, 220, -6, 0))
	if peaks := peaksOf(t, wav, &Range{StartSeconds: 0.5, LengthSeconds: 10}, 50); peaks.Buckets != 25 {
		t.Fatalf("buckets = %d, want 25 (the half second that exists)", peaks.Buckets)
	}
	if peaks := peaksOf(t, wav, &Range{StartSeconds: 5, LengthSeconds: 1}, 50); peaks.Buckets != 0 || len(peaks.MinMax) != 0 {
		t.Fatalf("peaks after the end = %d buckets, want none", peaks.Buckets)
	}
}

func TestPeaksRefuseABucketRateOutsideTheirLimits(t *testing.T) {
	wav := encodeWAV(t, 1, 8000, 16, false, silence(8000, 0.1))
	for _, perSecond := range []int{0, -5, MaxPeaksPerSecond + 1} {
		if _, err := ComputePeaks(context.Background(), bytes.NewReader(wav), nil, perSecond); err == nil {
			t.Fatalf("%d buckets a second was accepted", perSecond)
		}
	}
	if _, err := ComputePeaks(context.Background(), bytes.NewReader(wav), &Range{StartSeconds: -1, LengthSeconds: 1}, 50); err == nil {
		t.Fatal("a negative range start was accepted")
	}
}

func TestPeaksOfSomethingThatIsNotAWAVFail(t *testing.T) {
	_, err := ComputePeaks(context.Background(), bytes.NewReader([]byte("ID3\x04\x00 an mp3")), nil, 50)
	if !errors.Is(err, ErrNotWAV) {
		t.Fatalf("err = %v, want ErrNotWAV (a non-WAV source shows no waveform)", err)
	}
}

func TestPeaksStopWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := ComputePeaks(ctx, newToneStream(t, 48000, 60), nil, 50)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestAnHourOfPeaksIsSmall(t *testing.T) {
	if testing.Short() {
		t.Skip("reads an hour of generated audio")
	}
	peaks, err := ComputePeaks(context.Background(), newToneStream(t, 48000, 3600), nil, DefaultPeaksPerSecond)
	if err != nil {
		t.Fatal(err)
	}
	if peaks.Buckets != 3600*DefaultPeaksPerSecond || len(peaks.MinMax) != 2*peaks.Buckets {
		t.Fatalf("an hour = %d buckets, %d bytes", peaks.Buckets, len(peaks.MinMax))
	}
	// Two bytes a bucket: 360 KB for an hour at 50 a second, 480 KB as base64 on the wire.
	if len(peaks.MinMax) > 400*1024 {
		t.Fatalf("an hour of peaks is %d bytes", len(peaks.MinMax))
	}
}

// The cost Phase 0 asked for: peaks over 60 minutes of 48 kHz stereo 24-bit WAV (about 1 GB of audio data).
func BenchmarkPeaksOneHourStereo48k(b *testing.B) {
	for range b.N {
		stream := newToneStream(b, 48000, 3600)
		b.SetBytes(stream.left)
		if _, err := ComputePeaks(context.Background(), stream, nil, DefaultPeaksPerSecond); err != nil {
			b.Fatal(err)
		}
	}
}
