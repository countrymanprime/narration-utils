package chaptermatch

import "strings"

// The scores FindChapterByTrackName returns, as compare.py returns them.
const (
	// ScoreExact is an exact token match ("CHAPTER ONE" and "Chapter 1").
	ScoreExact = 1.0
	// ScoreContained is the one title whose tokens start with, or contain,
	// the name's tokens ("Chapter 1" in "Chapter 1: The Beginning").
	ScoreContained = 0.95
	// ScoreContainedAmbiguous is several such titles, of which the Python
	// matcher picks the shortest.
	ScoreContainedAmbiguous = 0.9
	// FuzzyThreshold is the lowest difflib ratio the fuzzy fallback accepts.
	FuzzyThreshold = 0.75
)

// FindChapterByTrackName is a port of compare.py's find_chapter_by_track_name
// over chapter titles: it returns the index of the title that name matches and
// the matcher's score, or -1 and 0 when nothing matches well enough. The
// order of checks is the Python one: an exact token match (the first one
// wins), then a whole-token prefix or contained run (one title scores
// ScoreContained; several pick the shortest title at ScoreContainedAmbiguous),
// then a difflib ratio of the joined tokens that must reach FuzzyThreshold
// (the first of equal ratios wins).
func FindChapterByTrackName(titles []string, name string) (int, float64) {
	target := NormalizedTokens(name)
	chapterTokens := make([][]string, len(titles))
	for i, title := range titles {
		chapterTokens[i] = NormalizedTokens(title)
	}

	for i, tokens := range chapterTokens {
		if equalTokens(tokens, target) {
			return i, ScoreExact
		}
	}

	var contained []int
	for i, tokens := range chapterTokens {
		if hasTokenPrefix(tokens, target) || containsTokenRun(tokens, target) {
			contained = append(contained, i)
		}
	}
	if len(contained) == 1 {
		return contained[0], ScoreContained
	}
	if len(contained) > 1 {
		return shortestTitle(titles, contained), ScoreContainedAmbiguous
	}

	targetText := strings.Join(target, " ")
	best, bestScore := -1, -1.0
	for i, tokens := range chapterTokens {
		if ratio := sequenceRatio(strings.Join(tokens, " "), targetText); ratio > bestScore {
			best, bestScore = i, ratio
		}
	}
	if best < 0 || bestScore < FuzzyThreshold {
		return -1, 0
	}
	return best, bestScore
}

func equalTokens(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// hasTokenPrefix is Python's toks[:len(target)] == target, which is also true
// for a target longer than toks only when the two are equal (already handled
// by the exact check), so it reduces to a prefix check here.
func hasTokenPrefix(tokens, target []string) bool {
	return len(target) <= len(tokens) && equalTokens(tokens[:len(target)], target)
}

// containsTokenRun is compare.py's _contains_token_run: an empty needle, or
// one longer than the haystack, is never contained.
func containsTokenRun(haystack, needle []string) bool {
	n := len(needle)
	if n == 0 || n > len(haystack) {
		return false
	}
	for i := 0; i+n <= len(haystack); i++ {
		if equalTokens(haystack[i:i+n], needle) {
			return true
		}
	}
	return false
}

// shortestTitle is Python's min(..., key=len(title)): the first of the
// shortest raw titles, measured in code points as Python's len is.
func shortestTitle(titles []string, indexes []int) int {
	best := indexes[0]
	for _, i := range indexes[1:] {
		if len([]rune(titles[i])) < len([]rune(titles[best])) {
			best = i
		}
	}
	return best
}
