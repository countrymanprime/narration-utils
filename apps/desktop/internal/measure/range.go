package measure

import (
	"fmt"
	"io"
	"math"
	"os"
)

// Range is a stretch of a source file in seconds of source time: the
// audio from StartSeconds for LengthSeconds. It is converted to whole
// frames at the file's own sample rate (rounded to the nearest frame), so
// measuring a range gives exactly the report of a file holding only those
// frames. Seconds rather than frames because a take's range comes from the
// project in seconds (its SOFFS and length) before the file's rate is known.
type Range struct {
	StartSeconds  float64 `json:"start_seconds"`
	LengthSeconds float64 `json:"length_seconds"`
}

func (r Range) validate() error {
	finite := !math.IsNaN(r.StartSeconds) && !math.IsInf(r.StartSeconds, 0) &&
		!math.IsNaN(r.LengthSeconds) && !math.IsInf(r.LengthSeconds, 0)
	if !finite || r.StartSeconds < 0 || r.LengthSeconds <= 0 {
		return fmt.Errorf("invalid measurement range %+v: start must be >= 0 and length > 0, both finite", r)
	}
	return nil
}

// frames converts the range to [first, first+count) frames at rate.
func (r Range) frames(rate int) (first, count int64) {
	first = secondsToFrames(r.StartSeconds, rate)
	count = max(1, secondsToFrames(r.LengthSeconds, rate))
	return first, count
}

// secondsToFrames rounds to the nearest frame, saturating instead of
// overflowing for a range far longer than any real file.
func secondsToFrames(seconds float64, rate int) int64 {
	frames := math.Round(seconds * float64(rate))
	if frames >= math.MaxInt64/2 {
		return math.MaxInt64 / 2
	}
	return int64(frames)
}

// AnalyzeRange measures only the given range of the WAV audio read from r.
// Audio before the range is skipped without being decoded. A range that
// runs past the end measures what exists (DurationSeconds says how much);
// a range entirely after the end measures nothing, which reads as zero
// duration and every level unavailable.
func AnalyzeRange(r io.Reader, rng Range) (Report, error) {
	if err := rng.validate(); err != nil {
		return Report{}, err
	}
	reader, err := NewWAVReader(r)
	if err != nil {
		return Report{}, err
	}
	first, count := rng.frames(reader.Format().SampleRate)
	if _, err := reader.Skip(first); err != nil {
		return Report{}, fmt.Errorf("skipping to the range start: %w", err)
	}
	report, err := measureFrames(reader, count)
	if err != nil {
		return Report{}, err
	}
	report.Range = &rng
	return report, nil
}

// AnalyzeFileRange measures the given range of the WAV file at path and
// records the path.
func AnalyzeFileRange(path string, rng Range) (Report, error) {
	file, err := os.Open(path)
	if err != nil {
		return Report{}, err
	}
	defer func() { _ = file.Close() }() // read-only

	report, err := AnalyzeRange(file, rng)
	if err != nil {
		return Report{}, fmt.Errorf("%s: %w", path, err)
	}
	report.File = path
	return report, nil
}
