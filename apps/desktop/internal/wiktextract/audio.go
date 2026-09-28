// audio.go builds the Wikimedia Commons address for an audio file name Phase 8's derived index records (WordEntry.Audio),
// for prep-depth Phase 10 to hand to the narrator's own browser or media player (Q12: opened, never fetched by this
// app). It constructs no HTTP client and reads no network response - a pure string build, checked by
// TestPackageNeverImportsNet in audio_test.go the same way pronunciationlookup's own URL builder is.
package wiktextract

import (
	"errors"
	"strings"
)

// CommonsHost is the one Wikimedia Commons host a Phase 10 URL is built for and checked against before it is opened.
const CommonsHost = "commons.wikimedia.org"

// ErrNoAudio is returned for a word with no Commons audio file name: not in the index, or indexed with an empty Audio
// field. Both are the same "nothing to open" outcome for the narrator, refused with a clear reason rather than opening
// a broken or empty link.
var ErrNoAudio = errors.New("no Wikimedia Commons audio file is recorded for this word")

// CommonsAudioURL builds the Special:FilePath address for a Commons file name (Wiktextract's own "audio" field, for
// example "LL-Q1860 (eng)-Nizil Shah-happy.wav"): the redirect Wikimedia's own software serves straight to the media
// file, so opening it in the narrator's default browser or media player plays the file with no wiki page to click
// through first. filename is escaped as one URL path segment; an empty or all-whitespace filename is ErrNoAudio.
func CommonsAudioURL(filename string) (string, error) {
	name := strings.TrimSpace(filename)
	if name == "" {
		return "", ErrNoAudio
	}
	return "https://" + CommonsHost + "/wiki/Special:FilePath/" + pathSegmentEscape(name), nil
}

// pathSegmentEscape percent-encodes s for use as one URL path segment, byte for byte the same as the standard
// library's net/url.PathEscape - reimplemented locally because the Go host's depguard rule denies net's subpackages,
// net/url included, everywhere outside the download flow (ADR 0032 point 4, ADR 0012; .golangci.yml
// no-network-outside-the-download-flow), even though net/url itself never makes a network call. Unreserved: letters,
// digits, and "-_.~$&+:=@"; everything else becomes an uppercase %XX per byte, so a multi-byte UTF-8 character (an
// accent) becomes one %XX triplet per byte. Mirrors apps/desktop/internal/pronunciationlookup's own copy: the two
// packages are kept independent rather than sharing a helper package for one ten-line function.
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

// WordAudioURL looks word up in words (an index Phase 8's LoadIndex returned) and builds its Commons audio URL.
// Lookup is by the same key BuildIndex writes: lower-cased and trimmed. ErrNoAudio covers a word not in the index at
// all, as well as one indexed with no Audio file name - both mean there is nothing for the narrator to open.
func WordAudioURL(words map[string]WordEntry, word string) (string, error) {
	entry, ok := words[strings.ToLower(strings.TrimSpace(word))]
	if !ok {
		return "", ErrNoAudio
	}
	return CommonsAudioURL(entry.Audio)
}
