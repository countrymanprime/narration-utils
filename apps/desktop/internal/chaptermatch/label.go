package chaptermatch

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// This file is the canonicalising pre-pass of the DAW chapter-track auto-sync
// PRD (docs/prds/daw-chapter-track-auto-sync.prd.md Phase 1, S5, S9): track
// names such as "Ch. 6", "Ch6", "06", "Sixth Chapter", "Chapter VI" or
// "Chapter 6 v2" read as the chapter label they are before MatchTitle compares
// them, both sides alike. sidecars/transcript-compare/core/compare.py's
// label_tokens is the same pass; the labelTokens cases in
// tests/fixtures/chapter-track-match/parity-cases.json pin the two together.

// Marker says a name is a take, pickup or credits track rather than the
// chapter itself.
type Marker string

const (
	MarkerNone    Marker = ""
	MarkerTake    Marker = "take"
	MarkerPickup  Marker = "pickup"
	MarkerCredits Marker = "credits"
)

// labelAliases are abbreviations of "chapter", read as the label only right
// before a number ("a nice chap" stays a chap).
var labelAliases = map[string]bool{"ch": true, "chap": true, "chapt": true, "chpt": true}

// labels are the words a Roman numeral or an ordinal may follow or precede.
var labels = map[string]bool{"chapter": true, "part": true, "book": true}

// ordinalWords maps an ordinal to its cardinal number word, so
// MergeNumberWords reads "twenty first" as 21.
var ordinalWords = map[string]string{
	"first": "one", "second": "two", "third": "three", "fourth": "four", "fifth": "five", "sixth": "six",
	"seventh": "seven", "eighth": "eight", "ninth": "nine", "tenth": "ten", "eleventh": "eleven",
	"twelfth": "twelve", "thirteenth": "thirteen", "fourteenth": "fourteen", "fifteenth": "fifteen",
	"sixteenth": "sixteen", "seventeenth": "seventeen", "eighteenth": "eighteen", "nineteenth": "nineteen",
	"twentieth": "twenty", "thirtieth": "thirty", "fortieth": "forty", "fiftieth": "fifty",
	"sixtieth": "sixty", "seventieth": "seventy", "eightieth": "eighty", "ninetieth": "ninety",
	"hundredth": "hundred",
}

// matterSynonyms folds front- and back-matter spellings to one word when they
// open the name.
var matterSynonyms = map[string]string{"intro": "introduction", "forward": "foreword", "acknowledgements": "acknowledgments"}

// matterWords are headings a take or pickup marker may follow.
var matterWords = map[string]bool{
	"prologue": true, "epilogue": true, "introduction": true, "foreword": true, "preface": true,
	"afterword": true, "acknowledgments": true,
}

// takeWords and pickupWords are trailing markers; "take", "v" and "version"
// may carry a number.
var (
	takeWords   = map[string]bool{"take": true, "v": true, "version": true, "comp": true, "final": true, "edit": true, "alt": true}
	pickupWords = map[string]bool{"pickup": true, "pickups": true, "pu": true, "pus": true}
	creditsLead = map[string]string{"opening": "opening", "intro": "opening", "introduction": "opening", "closing": "closing", "end": "closing", "ending": "closing"}
)

var (
	romanPattern     = regexp.MustCompile(`^[ivxlc]+$`)
	ordinalDigits    = regexp.MustCompile(`^(\d+)(st|nd|rd|th)$`)
	letterThenDigits = regexp.MustCompile(`([A-Za-z])(\d)`)
)

// accentFolder removes accents. It is built per call: a transform.Chain keeps state between calls and is not safe for
// concurrent use, and chapter sync reads labels from several goroutines at once.
func accentFolder() transform.Transformer {
	return transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
}

// LabelTokens is NormalizedTokens with the label pre-pass, and the marker
// the pre-pass took off the end. In order: accents are folded ("Épilogue"),
// letters are split from the digits after them ("Ch6", "v2"); then on the
// tokens, "ch"/"chap"/"chapt"/"chpt" before a number read as "chapter", a
// Roman numeral after chapter/part/book reads as its number, an ordinal
// ("sixth", "6th") reads as a number and moves after the label it precedes
// ("Sixth Chapter", "Chapter the Sixth"), leading zeros go ("06"), a track
// number before the label goes ("06 - Chapter 6"), and front-matter
// spellings fold ("Intro"). Trailing take or pickup markers after a number or
// a front/back-matter heading are removed and reported ("Chapter 6 v2",
// "Chapter 6 (pickups)"), and a credits name ("End Credits") is reported as
// credits.
func LabelTokens(text string) ([]string, Marker) {
	folded, _, err := transform.String(accentFolder(), text)
	if err != nil {
		folded = text
	}
	folded = letterThenDigits.ReplaceAllString(folded, "$1 $2")
	raw := tokenPattern.FindAllString(quoteNormalizer.Replace(folded), -1)
	tokens := make([]string, 0, len(raw))
	for _, token := range raw {
		tokens = append(tokens, strings.ToLower(token))
	}
	if marker, ok := creditsName(tokens); ok {
		return marker, MarkerCredits
	}
	tokens = labelRules(tokens)
	canon := make([]string, 0, len(tokens))
	for _, token := range tokens {
		canon = append(canon, canonicalToken(token))
	}
	merged := MergeNumberWords(canon)
	for i, token := range merged {
		merged[i] = trimLeadingZeros(token)
	}
	merged = dropTrackNumber(merged)
	return stripMarkers(merged)
}

// creditsName reads "Opening Credits", "Intro Credits", "Closing Credits" and
// "End Credits" (ADR 0150: credits are not chapters).
func creditsName(tokens []string) ([]string, bool) {
	if len(tokens) != 2 || tokens[1] != "credits" {
		return nil, false
	}
	lead, ok := creditsLead[tokens[0]]
	if !ok {
		return nil, false
	}
	return []string{lead, "credits"}, true
}

// labelRules applies the word-level rules before number words merge.
func labelRules(tokens []string) []string {
	out := make([]string, 0, len(tokens))
	for i := 0; i < len(tokens); i++ {
		token := tokens[i]
		next := ""
		if i+1 < len(tokens) {
			next = tokens[i+1]
		}
		switch {
		case labelAliases[token] && isNumberish(next):
			out = append(out, "chapter")
		case i == 0 && matterSynonyms[token] != "":
			out = append(out, matterSynonyms[token])
		case isOrdinal(token) || (isNumberWord(token) && ordinalAhead(tokens, i)):
			// An ordinal run before a label moves after it: "Sixth Chapter", "Twenty First Chapter".
			j := i
			for j < len(tokens) && (isOrdinal(tokens[j]) || isNumberWord(tokens[j])) {
				j++
			}
			words := ordinalRun(tokens[i:j])
			if j < len(tokens) && labels[tokens[j]] {
				out = append(out, tokens[j])
				out = append(out, words...)
				i = j
				continue
			}
			out = append(out, words...)
			i = j - 1
		case token == "the" && len(out) > 0 && labels[out[len(out)-1]] && isOrdinal(next):
			// "Chapter the Sixth": the article between a label and its ordinal goes.
		case len(out) > 0 && labels[out[len(out)-1]] && romanPattern.MatchString(token):
			if value, ok := romanValue(token); ok {
				out = append(out, strconv.Itoa(value))
			} else {
				out = append(out, token)
			}
		default:
			out = append(out, token)
		}
	}
	return out
}

// ordinalAhead reports whether the run of number words starting at i ends in
// an ordinal ("twenty first").
func ordinalAhead(tokens []string, i int) bool {
	for ; i < len(tokens); i++ {
		if isOrdinal(tokens[i]) {
			return true
		}
		if !isNumberWord(tokens[i]) {
			return false
		}
	}
	return false
}

func isNumberWord(token string) bool {
	_, ok := numberWords[token]
	return ok
}

func isDigits(token string) bool {
	if token == "" {
		return false
	}
	for _, r := range token {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// isNumberish is what may follow a chapter abbreviation: digits, a number or
// ordinal word, or a Roman numeral.
func isNumberish(token string) bool {
	return isDigits(token) || isNumberWord(token) || isOrdinal(token) || romanPattern.MatchString(token)
}

func isOrdinal(token string) bool {
	return ordinalWords[token] != "" || ordinalDigits.MatchString(token)
}

// ordinalRun turns a run of number and ordinal words into cardinal words
// ("twenty first" -> "twenty one") or digits ("6th" -> "6").
func ordinalRun(run []string) []string {
	out := make([]string, 0, len(run))
	for _, token := range run {
		switch {
		case ordinalWords[token] != "":
			out = append(out, ordinalWords[token])
		case ordinalDigits.MatchString(token):
			out = append(out, ordinalDigits.FindStringSubmatch(token)[1])
		default:
			out = append(out, token)
		}
	}
	return out
}

// romanValue reads a well-formed Roman numeral from I to C.
func romanValue(token string) (int, bool) {
	values := map[byte]int{'i': 1, 'v': 5, 'x': 10, 'l': 50, 'c': 100}
	total := 0
	for i := 0; i < len(token); i++ {
		value := values[token[i]]
		if i+1 < len(token) && value < values[token[i+1]] {
			total -= value
		} else {
			total += value
		}
	}
	if total < 1 || total > 100 || toRoman(total) != token {
		return 0, false
	}
	return total, true
}

func toRoman(value int) string {
	numerals := []struct {
		value int
		text  string
	}{{100, "c"}, {90, "xc"}, {50, "l"}, {40, "xl"}, {10, "x"}, {9, "ix"}, {5, "v"}, {4, "iv"}, {1, "i"}}
	var out strings.Builder
	for _, numeral := range numerals {
		for value >= numeral.value {
			out.WriteString(numeral.text)
			value -= numeral.value
		}
	}
	return out.String()
}

// canonicalToken is tokenize's per-token folding: the homophone canon and the
// possessive.
func canonicalToken(token string) string {
	if canon, ok := homophoneCanon[token]; ok {
		token = canon
	}
	if strings.HasSuffix(token, "'s") && len(token) > 2 {
		token = token[:len(token)-2] + "s"
	}
	return token
}

func trimLeadingZeros(token string) string {
	if !isDigits(token) {
		return token
	}
	trimmed := strings.TrimLeft(token, "0")
	if trimmed == "" {
		return "0"
	}
	return trimmed
}

// dropTrackNumber removes a leading number right before a label ("06 -
// Chapter 6").
func dropTrackNumber(tokens []string) []string {
	if len(tokens) > 2 && isDigits(tokens[0]) && labels[tokens[1]] {
		return tokens[1:]
	}
	return tokens
}

// stripMarkers removes a trailing run of take and pickup markers when it
// follows a number or a front/back-matter heading ("Chapter 6 v2", "Prologue
// pickups"), reporting which kind it removed (pickup wins over take). A run
// after anything else is a title's own words and stays.
func stripMarkers(tokens []string) ([]string, Marker) {
	marker := MarkerNone
	end := len(tokens)
	for end > 1 {
		last := tokens[end-1]
		cut, kind := 0, MarkerNone
		switch {
		case pickupWords[last]:
			cut, kind = 1, MarkerPickup
		case takeWords[last]:
			cut, kind = 1, MarkerTake
		case isDigits(last) && end > 2 && takeWords[tokens[end-2]]:
			cut, kind = 2, MarkerTake
		}
		if cut == 0 || end-cut < 1 {
			break
		}
		end -= cut
		if marker != MarkerPickup {
			marker = kind
		}
	}
	if end == len(tokens) || !markerAnchor(tokens[end-1]) {
		return tokens, MarkerNone
	}
	return tokens[:end], marker
}

// markerAnchor is a token a marker may follow: a number, or a front/back
// matter heading.
func markerAnchor(token string) bool {
	return isDigits(token) || matterWords[token]
}
