package measure

import (
	"math"
	"reflect"
	"testing"
)

func TestPauseProfileMedianAndOverlappingWords(t *testing.T) {
	words := []Word{
		{StartSeconds: 0, EndSeconds: 1},
		{StartSeconds: 0.9, EndSeconds: 1.5}, // overlaps the previous word: no gap
		{StartSeconds: 2.0, EndSeconds: 2.5}, // 0.5 s pause
		{StartSeconds: 3.5, EndSeconds: 4.0}, // 1.0 s pause
		{StartSeconds: 4.4, EndSeconds: 5.0}, // 0.4 s pause
	}
	profile := pauseProfile(words, 5, PauseOptions{MinPauseSeconds: 0.3, LongPauseSeconds: 0.9})

	if profile.Count != 3 {
		t.Fatalf("count = %d, want 3", profile.Count)
	}
	within(t, "total", &profile.TotalSeconds, 1.9, 1e-9)
	within(t, "longest", &profile.LongestSeconds, 1.0, 1e-9)
	within(t, "median", &profile.MedianSeconds, 0.5, 1e-9)
	within(t, "trailing", profile.TrailingSeconds, 0, 1e-9)
	want := []Pause{{StartSeconds: 2.5, DurationSeconds: 1.0}}
	if len(profile.LongPauses) != 1 || math.Abs(profile.LongPauses[0].DurationSeconds-want[0].DurationSeconds) > 1e-9 {
		t.Fatalf("long pauses = %+v, want %+v", profile.LongPauses, want)
	}
}

func TestPauseProfileEvenCountMedianAveragesTheMiddlePair(t *testing.T) {
	words := []Word{
		{StartSeconds: 0, EndSeconds: 0.1},
		{StartSeconds: 0.5, EndSeconds: 0.6}, // 0.4
		{StartSeconds: 1.2, EndSeconds: 1.3}, // 0.6
	}
	profile := pauseProfile(words, 1.3, PauseOptions{MinPauseSeconds: 0.3, LongPauseSeconds: 2})
	within(t, "median", &profile.MedianSeconds, 0.5, 1e-9)
	if profile.LongPauses == nil || len(profile.LongPauses) != 0 {
		t.Fatalf("long pauses = %#v, want an empty, non-nil list", profile.LongPauses)
	}
}

func TestPauseProfileWithNoGapsAboveTheThresholdIsMeasuredZero(t *testing.T) {
	words := []Word{{StartSeconds: 0, EndSeconds: 0.5}, {StartSeconds: 0.6, EndSeconds: 1}}
	profile := pauseProfile(words, 2, DefaultPauseOptions())
	if profile.Count != 0 || profile.TotalSeconds != 0 || profile.MedianSeconds != 0 || profile.LongestSeconds != 0 {
		t.Fatalf("profile = %+v, want a measured zero", profile)
	}
	within(t, "trailing", profile.TrailingSeconds, 1, 1e-9)
}

func TestPauseProfileWordsPastTheRangeHaveNoTrailingFigure(t *testing.T) {
	words := []Word{{StartSeconds: 0, EndSeconds: 0.5}, {StartSeconds: 1, EndSeconds: 3}}
	profile := pauseProfile(words, 2, DefaultPauseOptions())
	if profile.TrailingSeconds != nil {
		t.Fatalf("trailing = %v, want none when the last word runs past the take's range", *profile.TrailingSeconds)
	}
}

// FuzzPauseProfileInvariants checks what must hold for any valid word list:
// the profile is deterministic, pauses fit inside the speech span, and the
// summary statistics are ordered.
func FuzzPauseProfileInvariants(f *testing.F) {
	f.Add([]byte{10, 3, 40, 5, 2, 7, 90, 1})
	f.Add([]byte{0, 0, 0, 0})
	f.Add([]byte{255, 255, 1, 255})
	f.Fuzz(func(t *testing.T, raw []byte) {
		words := wordsFromBytes(raw)
		if len(words) < 2 {
			return
		}
		opts := PauseOptions{MinPauseSeconds: 0.25, LongPauseSeconds: 1}
		rangeLength := words[len(words)-1].EndSeconds + 0.5
		profile := pauseProfile(words, rangeLength, opts)

		if again := pauseProfile(words, rangeLength, opts); !reflect.DeepEqual(profile, again) {
			t.Fatalf("not deterministic:\n%+v\n%+v", profile, again)
		}
		span := words[len(words)-1].EndSeconds - words[0].StartSeconds
		if profile.Count > len(words)-1 || profile.TotalSeconds > span+1e-9 {
			t.Fatalf("profile %+v does not fit %d words over %.3f s", profile, len(words), span)
		}
		if profile.Count > 0 && (profile.LongestSeconds < profile.MedianSeconds || profile.MedianSeconds < opts.MinPauseSeconds) {
			t.Fatalf("statistics out of order: %+v", profile)
		}
		if len(profile.LongPauses) > profile.Count {
			t.Fatalf("%d long pauses out of %d pauses", len(profile.LongPauses), profile.Count)
		}
	})
}

// wordsFromBytes turns byte pairs into ordered words: each pair is a gap
// then a word length, in hundredths of a second.
func wordsFromBytes(raw []byte) []Word {
	var words []Word
	cursor := 0.0
	for i := 0; i+1 < len(raw); i += 2 {
		start := cursor + float64(raw[i])/100
		end := start + float64(raw[i+1])/100
		words = append(words, Word{StartSeconds: start, EndSeconds: end})
		cursor = end
	}
	return words
}
