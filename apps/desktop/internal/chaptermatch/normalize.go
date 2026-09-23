// Package chaptermatch matches manuscript chapters to REAPER tracks. It is
// the one chapter-to-track matcher every consumer shares (the teleprompter's
// resume, Home's measured duration, line identity, the review dashboard's
// chapter grouping, the diagnostics DAW scan): teleprompter-manuscript-
// integration PRD Phase 8, ADR 0110.
//
// Two layers. FindChapterByTrackName (title.go) is a faithful port of
// Transcript Compare's find_chapter_by_track_name
// (sidecars/transcript-compare/core/compare.py), number-word merge, homophone
// canon and difflib ratio included; tests/fixtures/chapter-track-match/
// parity-cases.json holds the cases both implementations must agree on.
// ForChapter (resolve.go) builds on it to answer the question the app asks,
// "which track holds this chapter?", with a narrator-confirmed link taking
// precedence, project region names as a second source, and an explicit
// ambiguous state instead of a silent pick.
package chaptermatch

import (
	_ "embed"
	"regexp"
	"strconv"
	"strings"
)

// tokenPattern is compare.py's TOKEN_RE: ASCII letters, digits and the
// apostrophe. Anything else (hyphens, colons, non-ASCII letters) separates
// tokens.
var tokenPattern = regexp.MustCompile(`[A-Za-z0-9']+`)

// quoteNormalizer is compare.py's _QUOTE_NORMALIZE_TABLE: typographic single
// quotes become the ASCII apostrophe (so "Sentinel’s" stays one token) and
// typographic double quotes become ASCII ones (which tokenPattern drops).
var quoteNormalizer = strings.NewReplacer(
	"‘", "'", "’", "'", "‛", "'", "ʼ", "'", "`", "'", "´", "'",
	"“", `"`, "”", `"`, "„", `"`, "‟", `"`,
)

// numberWords is compare.py's NUMBER_WORDS.
var numberWords = map[string]int64{
	"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
	"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
	"seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
	"sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000,
	"million": 1000000, "billion": 1000000000,
}

// homophonesCSV is a copy of sidecars/transcript-compare/core/homophones.csv
// (a Go embed cannot reach outside this module); a test fails when the two
// drift apart.
//
//go:embed homophones.csv
var homophonesCSV string

var homophoneCanon = buildCanon(loadEquivalenceGroups(homophonesCSV))

// loadEquivalenceGroups is compare.py's load_equivalence_groups over text
// already read: one comma-separated group per line, '#' starts a comment,
// groups of fewer than two words are skipped.
func loadEquivalenceGroups(text string) [][]string {
	var groups [][]string
	for _, line := range strings.Split(text, "\n") {
		line, _, _ = strings.Cut(line, "#")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var words []string
		for _, word := range strings.Split(line, ",") {
			if word = strings.TrimSpace(word); word != "" {
				words = append(words, strings.ToLower(word))
			}
		}
		if len(words) >= 2 {
			groups = append(groups, words)
		}
	}
	return groups
}

// buildCanon maps every word of every group to the group's first member; a
// word in several groups takes the last group's canon, as the Python dict
// comprehension does.
func buildCanon(groups [][]string) map[string]string {
	canon := map[string]string{}
	for _, group := range groups {
		for _, word := range group {
			canon[word] = group[0]
		}
	}
	return canon
}

// tokenize is compare.py's tokenize without the per-manuscript custom
// equivalence list (_CUSTOM_CANON), which Transcript Compare loads for one run
// and the matcher has no manuscript folder to read it from.
func tokenize(text string) []string {
	raw := tokenPattern.FindAllString(quoteNormalizer.Replace(text), -1)
	tokens := make([]string, 0, len(raw))
	for _, token := range raw {
		token = strings.ToLower(token)
		if canon, ok := homophoneCanon[token]; ok {
			token = canon
		}
		if strings.HasSuffix(token, "'s") && len(token) > 2 {
			token = token[:len(token)-2] + "s"
		}
		tokens = append(tokens, token)
	}
	return tokens
}

// MergeNumberWords is compare.py's merge_number_words (without the index
// map): each run of spelled-out cardinal numbers collapses into one digit
// token ("twenty three" -> "23", "one hundred and five" -> "105"); an "and"
// continues a run only when another number word follows it.
func MergeNumberWords(tokens []string) []string {
	out := make([]string, 0, len(tokens))
	for i := 0; i < len(tokens); {
		if _, isNumber := numberWords[tokens[i]]; !isNumber {
			out = append(out, tokens[i])
			i++
			continue
		}
		var total, chunk int64
		j := i
		for j < len(tokens) {
			value, isNumber := numberWords[tokens[j]]
			if isNumber {
				total, chunk = accumulateNumber(total, chunk, value)
				j++
				continue
			}
			if tokens[j] == "and" && j+1 < len(tokens) {
				if _, next := numberWords[tokens[j+1]]; next {
					j++
					continue
				}
			}
			break
		}
		out = append(out, strconv.FormatInt(total+chunk, 10))
		i = j
	}
	return out
}

func accumulateNumber(total, chunk, value int64) (int64, int64) {
	orOne := func(v int64) int64 {
		if v == 0 {
			return 1
		}
		return v
	}
	switch {
	case value == 100:
		return total, orOne(chunk) * 100
	case value >= 1000:
		return total + orOne(chunk)*value, 0
	default:
		return total, chunk + value
	}
}

// NormalizedTokens is compare.py's normalized_tokens: tokenize, then merge
// number words, so "CHAPTER ONE" and "Chapter 1" both read [chapter 1]. It is
// a token list, not a joined string, so prefix checks compare whole tokens and
// "chapter 1" never prefixes "chapter 11".
func NormalizedTokens(text string) []string {
	return MergeNumberWords(tokenize(text))
}
