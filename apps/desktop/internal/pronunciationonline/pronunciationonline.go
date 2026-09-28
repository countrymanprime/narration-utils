// Package pronunciationonline is the one pronunciation source that fetches: the online role of the PronunciationSource
// port (ADR 0405 point 2, ADR 0356; prep-depth.prd.md Phase 9). Its only adapter is Merriam-Webster's Dictionary API
// (the merriamwebster subpackage, the only code here allowed to import net); tests and the demo build use the fake in
// pronunciationonlinetest. This package holds the port, the privacy rule and the local cache, and imports no network
// code itself.
//
// The privacy rule (D72) is enforced here, not left to the callers:
//   - a lookup sends one word, checked by CheckWord (never a passage, a file name or a project id), and the request
//     is built by the adapter from that word and the key alone;
//   - a lookup is the narrator's own press (Lookup), or a batch they confirmed after being told its word count
//     (LookupBatch refuses a batch whose confirmed count is not the number of words it would send);
//   - every answer is cached locally (Cache), so a word already looked up is never sent again;
//   - the key is the narrator's own, kept by credentialstore, and neither it nor the word ever appears in an error.
//
// Nothing here logs.
package pronunciationonline

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/countrymanprime/narration-utils/shell/internal/credentialstore"
)

// Pronunciation is one pronunciation a dictionary gives for a headword, in that dictionary's own notation (Merriam-Webster
// writes its respelling, not IPA).
type Pronunciation struct {
	Headword string `json:"headword"`
	Spelling string `json:"spelling"`
}

// Answer is a dictionary's answer for one word: its pronunciations when it has the word, or its suggestions when it
// does not.
type Answer struct {
	Found          bool            `json:"found"`
	Pronunciations []Pronunciation `json:"pronunciations"`
	Suggestions    []string        `json:"suggestions"`
}

// Dictionary is the online role of the PronunciationSource port: a source that fetches one word's pronunciation from
// its one host, on the narrator's own key. Lookup is given a word CheckWord accepted, and must build its request from
// that word and key alone. Its errors are the sentinels below (or the context's), never text holding the word or key.
type Dictionary interface {
	// Name is the source's row name, as the UI and the credential store spell it.
	Name() string
	// Label is the source's name for the narrator.
	Label() string
	// Host is the one lower-case host the source's requests go to.
	Host() string
	// SignUpURL is the fixed page where a narrator gets their own free key.
	SignUpURL() string
	// Notation names the notation the source's spellings are in, for the narrator.
	Notation() string
	Lookup(ctx context.Context, word string, key credentialstore.Secret) (Answer, error)
}

// The errors a Dictionary answers with. None carries the word or the key.
var (
	ErrKeyRefused  = errors.New("Merriam-Webster refused the key: check it on your dictionaryapi.com account page and paste it again") // +checklocksignore: an error value, returned under the lock by chance
	ErrRateLimited = errors.New("Merriam-Webster is limiting lookups on this key for now: try again later")                            // +checklocksignore: an error value, returned under the lock by chance
	ErrUnreachable = errors.New("Merriam-Webster could not be reached: check the internet connection and try again")                   // +checklocksignore: an error value, returned under the lock by chance
	ErrUnavailable = errors.New("Merriam-Webster did not answer the lookup: try again later")
)

// The errors the service answers with before any request is made.
var (
	ErrNoKey             = errors.New("add your own free Merriam-Webster key in Settings > Story Bible first") // +checklocksignore: an error value, returned under the lock by chance
	ErrBadKey            = errors.New("that does not look like a Merriam-Webster key: paste the key shown on your dictionaryapi.com account page")
	ErrNotAWord          = errors.New("an online lookup sends one word or name only: letters, digits, spaces, apostrophes, hyphens and periods, at most 3 words and 64 characters")
	ErrBatchNotConfirmed = errors.New("a batch lookup needs your confirmation of how many words it sends")
	ErrBatchTooLarge     = errors.New("a batch lookup sends at most 200 words at a time")
)

// The limits CheckWord holds a word to (Q11): a name or alias, never a sentence.
const (
	MaxWordRunes = 64
	MaxWordParts = 3
)

// CheckWord is the one word (or short name, like "Mock Turtle") an online lookup may send, with its spaces tidied: at
// most MaxWordParts space-separated parts and MaxWordRunes characters, made only of letters, marks, digits, apostrophes,
// hyphens and periods. Anything else (a sentence, a line break, a path separator, a file name's extension with its
// slash, a line break) is refused with ErrNotAWord, which never quotes it.
func CheckWord(raw string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", ErrNotAWord
	}
	// Spaces around and between the parts are tidied; any other white space (a line break, a tab) is refused, since it
	// would join two lines of text into one request.
	trimmed := strings.Trim(raw, " ")
	if strings.ContainsFunc(trimmed, func(r rune) bool { return unicode.IsSpace(r) && r != ' ' }) {
		return "", ErrNotAWord
	}
	parts := strings.Fields(trimmed)
	if len(parts) == 0 || len(parts) > MaxWordParts {
		return "", ErrNotAWord
	}
	word := strings.Join(parts, " ")
	if utf8.RuneCountInString(word) > MaxWordRunes {
		return "", ErrNotAWord
	}
	letters := 0
	for _, r := range word {
		switch {
		case unicode.IsLetter(r):
			letters++
		case unicode.IsMark(r), unicode.IsDigit(r), r == ' ', r == '\'', r == '’', r == '-', r == '.':
		default:
			return "", ErrNotAWord
		}
	}
	if letters == 0 {
		return "", ErrNotAWord
	}
	return word, nil
}

// cacheKey is the word's cache row: the checked word, lower-cased, so "Wren" and "wren" are one lookup.
func cacheKey(word string) string { return strings.ToLower(word) }
