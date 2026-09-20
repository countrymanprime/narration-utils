package importer

import (
	"strings"
	"unicode"
)

var headingKeywords = map[string]bool{"chapter": true, "part": true, "book": true}

var numberWords = map[string]bool{
	"one": true, "two": true, "three": true, "four": true, "five": true, "six": true, "seven": true, "eight": true, "nine": true, "ten": true,
	"eleven": true, "twelve": true, "thirteen": true, "fourteen": true, "fifteen": true, "sixteen": true, "seventeen": true, "eighteen": true,
	"nineteen": true, "twenty": true, "thirty": true, "forty": true, "fifty": true, "sixty": true, "seventy": true, "eighty": true, "ninety": true,
	"hundred": true,
}

func isRoman(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if !strings.ContainsRune("IVXLCDM", r) {
			return false
		}
	}
	return true
}

func isChapterNumber(value string) bool {
	if value == "" {
		return false
	}
	if isRoman(value) {
		return true
	}
	for _, part := range strings.Split(strings.ToLower(value), "-") {
		if !numberWords[part] {
			return false
		}
	}
	return true
}

// splitGluedHeading repairs headings whose title and subtitle were stored as
// adjacent runs with no whitespace between them, e.g. "CHAPTER ONEBad Ideas".
// Word renders the run boundary as a style change, so the author sees two
// lines while the text itself reads as one word. It only fires on the
// unambiguous shape "<chapter|part|book> <number><Capitalized word>...": the
// number must be a numeral, uppercase roman numeral or number word, and the
// boundary is the first capital that follows a complete number and begins a
// capitalized word.
func splitGluedHeading(title string) (string, string, bool) {
	keyword, rest, found := strings.Cut(title, " ")
	if !found || !headingKeywords[strings.ToLower(keyword)] {
		return title, "", false
	}
	rest = strings.TrimLeft(rest, " ")
	token, tail, _ := strings.Cut(rest, " ")
	runes := []rune(token)
	split := -1
	if len(runes) > 0 && unicode.IsDigit(runes[0]) {
		end := 0
		for end < len(runes) && unicode.IsDigit(runes[end]) {
			end++
		}
		if end < len(runes) && unicode.IsLetter(runes[end]) {
			split = end
		}
	} else {
		for index := 1; index+1 < len(runes); index++ {
			startsWord := unicode.IsUpper(runes[index]) && unicode.IsLower(runes[index+1])
			if startsWord && isChapterNumber(string(runes[:index])) {
				split = index
				break
			}
		}
	}
	if split < 0 {
		return title, "", false
	}
	head := keyword + " " + string(runes[:split])
	subtitle := strings.TrimSpace(string(runes[split:]) + " " + tail)
	return head, subtitle, true
}

// headingParts separates a heading's title from its subtitle. Word authors
// commonly put the subtitle on a soft line break (or a tab) inside the
// heading paragraph, which the importer preserves as "\n"; a glued heading is
// repaired as a last resort and reported so the import log can say so.
func headingParts(text string) (title, subtitle string, glued bool) {
	lines := strings.Split(text, "\n")
	title = collapse(lines[0])
	if len(lines) > 1 {
		return title, collapse(strings.Join(lines[1:], " ")), false
	}
	return splitGluedHeading(title)
}
