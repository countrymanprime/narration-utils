package dictionary

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// MaxWordLength is the longest selection a lookup accepts, in characters: the longest English words are well under it, and anything
// longer is a selection of more than a word.
const MaxWordLength = 64

// ErrNotAWord is a selection that is not one word: empty, only punctuation, several words, or too long. Phrase lookups are out of scope
// (ADR 0097), so a multi-word lemma is never in the index either.
var ErrNotAWord = errors.New("select a single word to look it up")

// Normalize turns a selection from the manuscript into the key the index is written with: surrounding punctuation and quotes removed
// (the reader's selection often carries a comma or a closing quote), a curly apostrophe made straight, and lower case.
func Normalize(selection string) (string, error) {
	word := strings.TrimFunc(selection, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) })
	word = strings.NewReplacer("’", "'", "‘", "'", "ʼ", "'").Replace(word)
	if word == "" {
		return "", ErrNotAWord
	}
	if utf8.RuneCountInString(word) > MaxWordLength {
		return "", fmt.Errorf("%w: it is longer than %d characters", ErrNotAWord, MaxWordLength)
	}
	if strings.IndexFunc(word, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return "", ErrNotAWord
	}
	return strings.ToLower(word), nil
}

// A detachment rule is WordNet's own way of finding the base form of a regularly inflected word ("morphy"): for a part of speech, an
// ending that is replaced by another. Irregular forms ("ran") are not rules: the dataset lists them, and the index keeps them as keys.
type detachment struct {
	pos            string
	suffix, ending string
}

var detachments = []detachment{
	{"n", "s", ""}, {"n", "ses", "s"}, {"n", "xes", "x"}, {"n", "zes", "z"}, {"n", "ches", "ch"}, {"n", "shes", "sh"}, {"n", "men", "man"}, {"n", "ies", "y"},
	{"v", "s", ""}, {"v", "ies", "y"}, {"v", "es", "e"}, {"v", "es", ""}, {"v", "ed", "e"}, {"v", "ed", ""}, {"v", "ing", "e"}, {"v", "ing", ""},
	{"a", "er", ""}, {"a", "est", ""}, {"a", "er", "e"}, {"a", "est", "e"},
}

// candidate is a base form a regular ending could have come from, and the part of speech the rule that found it applies to.
type candidate struct{ pos, base string }

// baseForms is every base form a regular ending could have come from, with the part of speech it applies to, in rule order and without
// repeats. A candidate is only a guess: the lookup keeps the ones the index has, for that part of speech.
func baseForms(word string) []candidate {
	var out []candidate
	seen := map[string]bool{}
	for _, rule := range detachments {
		if !strings.HasSuffix(word, rule.suffix) || len(word) <= len(rule.suffix) {
			continue
		}
		base := strings.TrimSuffix(word, rule.suffix) + rule.ending
		key := rule.pos + "/" + base
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, candidate{pos: rule.pos, base: base})
	}
	return out
}
