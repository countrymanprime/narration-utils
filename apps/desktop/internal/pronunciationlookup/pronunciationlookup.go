// Package pronunciationlookup builds the address of a one-click web lookup for a word, for the narrator's own browser
// to open (prep-depth.prd.md Phase 2; provider-ports.prd.md Open Question Q5's BrowserLookup role). It never fetches,
// scrapes or caches any site's content: URL is a pure function, and this package constructs no HTTP client (checked
// by a static import guard, pronunciationlookup_test.go's TestPackageNeverImportsNetHTTP).
//
// Each site's URL is one fixed template, read by hand against the live site (docs/research/, Phase 0) rather than an
// API this package calls - narration-utils stays local-only. Until that note says the owner confirmed it, treat every
// template here as unverified.
package pronunciationlookup

import (
	"fmt"
	"strings"
)

// Source names one of the four sites this phase ships (PRD Open Question Q4: exactly these four for v1, D71).
type Source string

const (
	Forvo          Source = "forvo"
	YouGlish       Source = "youglish"
	MerriamWebster Source = "merriam_webster"
	Howjsay        Source = "howjsay"
)

// Sources is every source this phase ships, in the order Look up buttons should offer them.
func Sources() []Source { return []Source{Forvo, YouGlish, MerriamWebster, Howjsay} }

// URL builds the address source's own fixed template gives for word: the page PronunciationLookupOpen opens in the
// narrator's default browser. word is escaped as one path segment (pathSegmentEscape), never a query string - none
// of the four templates take one - so a space, an accent or punctuation in a manuscript's name never breaks the URL
// or reaches the site unescaped.
func URL(source Source, word string) (string, error) {
	if strings.TrimSpace(word) == "" {
		return "", fmt.Errorf("pronunciationlookup: empty word")
	}
	switch source {
	case Forvo:
		return "https://forvo.com/word/" + pathSegmentEscape(word) + "/", nil
	case YouGlish:
		return "https://youglish.com/pronounce/" + pathSegmentEscape(word) + "/english", nil
	case MerriamWebster:
		return "https://www.merriam-webster.com/dictionary/" + pathSegmentEscape(word), nil
	case Howjsay:
		// Assumption (Phase 0, unverified - docs/research/): Howjsay's "how-to-pronounce-<word>" slug reads as a
		// hyphenated phrase, not a query-escaped one, so a space becomes a hyphen before the rest is path-escaped.
		hyphenated := strings.Join(strings.Fields(word), "-")
		return "https://howjsay.com/how-to-pronounce-" + pathSegmentEscape(hyphenated), nil
	default:
		return "", fmt.Errorf("pronunciationlookup: unknown source %q", source)
	}
}

// pathSegmentEscape percent-encodes s for use as one URL path segment, byte for byte the same as the standard
// library's net/url.PathEscape - reimplemented locally because the Go host's depguard rule denies net's subpackages,
// net/url included, everywhere outside the download flow (ADR 0032 point 4, ADR 0012; .golangci.yml
// no-network-outside-the-download-flow), even though net/url itself never makes a network call. Unreserved:
// letters, digits, and "-_.~$&+:=@"; everything else becomes an uppercase %XX per byte, so a multi-byte UTF-8
// character (an accent) becomes one %XX triplet per byte.
func pathSegmentEscape(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if isPathSegmentUnreserved(c) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&0xF])
	}
	return b.String()
}

func isPathSegmentUnreserved(c byte) bool {
	switch {
	case 'A' <= c && c <= 'Z', 'a' <= c && c <= 'z', '0' <= c && c <= '9':
		return true
	}
	switch c {
	case '-', '_', '.', '~', '$', '&', '+', ':', '=', '@':
		return true
	}
	return false
}
