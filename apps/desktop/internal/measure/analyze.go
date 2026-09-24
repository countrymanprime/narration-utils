package measure

import (
	"context"
	"fmt"
	"io"
	"math"
)

// skipBlockFrames is how many frames a range start is skipped by at a time, so a range late in a long file still
// reports progress and can be cancelled on the way there.
const skipBlockFrames = 1 << 20

// Progress is told how many bytes of audio the measurement has read so far, of how many it will read in all (total
// is 0 when that is not known, as for a stream whose header was never finished). It is called from the measuring
// goroutine after every block, so it must be quick. done never goes backwards and never passes a known total, and a
// measurement that runs to its end reports done == total: the progress is the bytes really read (ADR 0015).
type Progress func(done, total int64)

// Options are what a measurement can be asked for beyond the whole file: only a range of it, and progress.
type Options struct {
	Range    *Range
	Progress Progress
}

// AnalyzeContext measures WAV audio read from r, or only opts.Range of it, reporting progress as it reads and
// stopping with ctx's error as soon as ctx is done. It gives exactly the report Analyze or AnalyzeRange gives.
func AnalyzeContext(ctx context.Context, r io.Reader, opts Options) (Report, error) {
	return analyze(ctx, r, opts, -1)
}

// analyze is the one measurement loop. streamBytes is the length of r when it is known (a file), or -1; it bounds the
// progress total of a data chunk whose size the header never recorded.
func analyze(ctx context.Context, r io.Reader, opts Options, streamBytes int64) (Report, error) {
	if opts.Range != nil {
		if err := opts.Range.validate(); err != nil {
			return Report{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return Report{}, err
	}
	reader, err := NewWAVReader(r)
	if err != nil {
		return Report{}, err
	}
	first, count := int64(0), int64(math.MaxInt64)
	if opts.Range != nil {
		first, count = opts.Range.frames(reader.Format().SampleRate)
	}
	meter := progressMeter{reader: reader, report: opts.Progress, total: reader.bytesToRead(first, count, streamBytes)}

	if err := skipFrames(ctx, reader, first, &meter); err != nil {
		return Report{}, err
	}
	report, err := measureFrames(ctx, reader, count, &meter)
	if err != nil {
		return Report{}, err
	}
	if opts.Range != nil {
		rng := *opts.Range
		report.Range = &rng
	}
	return report, nil
}

// skipFrames discards the audio before a range in blocks, checking ctx between them.
func skipFrames(ctx context.Context, reader *WAVReader, frames int64, meter *progressMeter) error {
	for frames > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		skipped, err := reader.Skip(min(frames, skipBlockFrames))
		if err != nil {
			return fmt.Errorf("skipping to the range start: %w", err)
		}
		meter.tick()
		if skipped == 0 {
			return nil // the audio ended before the range starts
		}
		frames -= skipped
	}
	return nil
}

// bytesToRead is how many data bytes measuring frames [first, first+count) will read: up to the end of the range, or
// of the data when that comes first. 0 means unknown (an unfinished header on a stream of unknown length).
func (w *WAVReader) bytesToRead(first, count, streamBytes int64) int64 {
	available := w.dataSize
	if available < 0 && streamBytes >= 0 {
		available = max(0, streamBytes-w.dataStart)
	}
	end := int64(-1)
	if count != math.MaxInt64 {
		frameBytes := int64(w.frameBytes)
		if frames := first + count; frames <= math.MaxInt64/frameBytes {
			end = frames * frameBytes
		}
	}
	switch {
	case end < 0 && available < 0:
		return 0
	case end < 0:
		return available
	case available < 0:
		return end
	}
	return min(end, available)
}

// progressMeter turns the reader's consumed bytes into Progress calls that are monotonic and bounded by the total.
type progressMeter struct {
	reader *WAVReader
	report Progress
	total  int64
	last   int64
}

func (m *progressMeter) tick() {
	if m.report == nil {
		return
	}
	done := max(m.last, m.reader.consumed)
	if m.total > 0 {
		done = min(done, m.total)
	}
	m.last = done
	m.report(done, m.total)
}

// finish reports a measurement that ran to its end as complete: the reader may stop a few bytes short of a known
// total (a trailing partial frame is dropped), and the narrator should see the file reach 100%.
func (m *progressMeter) finish() {
	if m.report == nil {
		return
	}
	if m.total > 0 {
		m.last = m.total
	}
	m.report(m.last, m.total)
}
