package measure

import (
	"errors"
	"fmt"
	"math"
	"slices"
)

// Word is one transcribed word with its timing in seconds from the start of
// the take's source range (the audio the transcript was made from). These
// are source seconds: at a playrate other than 1 they differ from the
// seconds the item plays for, so pauses are measured as recorded.
type Word struct {
	Text         string  `json:"text"`
	StartSeconds float64 `json:"start_seconds"`
	EndSeconds   float64 `json:"end_seconds"`
}

// PauseOptions are the thresholds a pause profile uses. They are reported
// with the evidence so a narrator always sees what a "pause" meant.
type PauseOptions struct {
	// MinPauseSeconds is the shortest silence between words counted as a
	// pause; shorter gaps are the ordinary joins of connected speech and
	// the jitter of ASR word timing.
	MinPauseSeconds float64 `json:"min_pause_seconds"`
	// LongPauseSeconds is the length from which a pause is listed
	// individually.
	LongPauseSeconds float64 `json:"long_pause_seconds"`
}

// DefaultPauseOptions are used when a caller leaves PauseOptions zero.
func DefaultPauseOptions() PauseOptions {
	return PauseOptions{MinPauseSeconds: 0.3, LongPauseSeconds: 2}
}

func (o PauseOptions) resolve() (PauseOptions, error) {
	if o == (PauseOptions{}) {
		return DefaultPauseOptions(), nil
	}
	if !finite(o.MinPauseSeconds) || !finite(o.LongPauseSeconds) || o.MinPauseSeconds <= 0 || o.LongPauseSeconds < o.MinPauseSeconds {
		return PauseOptions{}, fmt.Errorf("invalid pause thresholds %+v: need 0 < min <= long, both finite", o)
	}
	return o, nil
}

// Pause is one silence between words, timed like the words.
type Pause struct {
	StartSeconds    float64 `json:"start_seconds"`
	DurationSeconds float64 `json:"duration_seconds"`
}

// PauseSummary is a pause profile's numbers.
type PauseSummary struct {
	Count          int     `json:"count"`
	TotalSeconds   float64 `json:"total_seconds"`
	LongestSeconds float64 `json:"longest_seconds"`
	MedianSeconds  float64 `json:"median_seconds"`
	LongPauses     []Pause `json:"long_pauses"`
	LeadingSeconds float64 `json:"leading_seconds"`
	// TrailingSeconds is the silence after the last word to the end of the
	// range; nil when the words run past the range (a transcript that does
	// not belong to exactly this range must not produce a figure).
	TrailingSeconds *float64 `json:"trailing_seconds"`
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// validateWords checks that words are finite, non-negative, not reversed
// and ordered by start. Overlapping words are allowed (ASR does that).
func validateWords(words []Word) error {
	for i, w := range words {
		if !finite(w.StartSeconds) || !finite(w.EndSeconds) || w.StartSeconds < 0 || w.EndSeconds < w.StartSeconds {
			return fmt.Errorf("word %d (%q) has invalid timing %v-%v", i, w.Text, w.StartSeconds, w.EndSeconds)
		}
		if i > 0 && w.StartSeconds < words[i-1].StartSeconds {
			return errors.New("words must be ordered by start time")
		}
	}
	return nil
}

// pauseProfile measures the silences between at least two valid words. A
// gap runs from the latest end so far to the next word's start, so an
// overlapping word never produces a negative pause.
func pauseProfile(words []Word, rangeLength float64, opts PauseOptions) PauseSummary {
	summary := PauseSummary{LongPauses: []Pause{}, LeadingSeconds: words[0].StartSeconds}
	var durations []float64
	end := words[0].EndSeconds
	for _, w := range words[1:] {
		if gap := w.StartSeconds - end; gap >= opts.MinPauseSeconds {
			durations = append(durations, gap)
			summary.TotalSeconds += gap
			summary.LongestSeconds = max(summary.LongestSeconds, gap)
			if gap >= opts.LongPauseSeconds {
				summary.LongPauses = append(summary.LongPauses, Pause{StartSeconds: end, DurationSeconds: gap})
			}
		}
		end = max(end, w.EndSeconds)
	}
	summary.Count = len(durations)
	summary.MedianSeconds = median(durations)
	if trailing := rangeLength - end; trailing >= 0 {
		summary.TrailingSeconds = &trailing
	}
	return summary
}

// median of values, 0 for none. It sorts a copy, never the caller's slice.
func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[mid]
	}
	return (sorted[mid-1] + sorted[mid]) / 2
}
