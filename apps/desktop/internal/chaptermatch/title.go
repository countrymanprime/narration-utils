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
	match := MatchTitle(titles, name)
	return match.Index, match.Score
}

// TitleMatch is MatchTitle's answer: FindChapterByTrackName's index and score,
// plus whether the match is one ADR 0110 counts as confident.
type TitleMatch struct {
	Index int
	Score float64
	// Confident is an exact or a single whole-token prefix/contained match.
	// The ambiguous-prefix pick and the fuzzy fallback never are, whatever
	// their score: a difflib ratio can reach ScoreContained or more ("The
	// Rabit Hole" against "The Rabbit Hole" is 0.97), so the score alone does
	// not say how the name matched.
	Confident bool
}

// MatchTitle is FindChapterByTrackName with the kind of match kept.
func MatchTitle(titles []string, name string) TitleMatch {
	target := NormalizedTokens(name)
	chapterTokens := make([][]string, len(titles))
	for i, title := range titles {
		chapterTokens[i] = NormalizedTokens(title)
	}

	for i, tokens := range chapterTokens {
		if equalTokens(tokens, target) {
			return TitleMatch{Index: i, Score: ScoreExact, Confident: true}
		}
	}

	var contained []int
	for i, tokens := range chapterTokens {
		if hasTokenPrefix(tokens, target) || containsTokenRun(tokens, target) {
			contained = append(contained, i)
		}
	}
	if len(contained) == 1 {
		return TitleMatch{Index: contained[0], Score: ScoreContained, Confident: true}
	}
	if len(contained) > 1 {
		return TitleMatch{Index: shortestTitle(titles, contained), Score: ScoreContainedAmbiguous}
	}

	targetText := strings.Join(target, " ")
	best, bestScore := -1, -1.0
	for i, tokens := range chapterTokens {
		if ratio := sequenceRatio(strings.Join(tokens, " "), targetText); ratio > bestScore {
			best, bestScore = i, ratio
		}
	}
	if best < 0 || bestScore < FuzzyThreshold {
		return TitleMatch{Index: -1}
	}
	return TitleMatch{Index: best, Score: bestScore}
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
