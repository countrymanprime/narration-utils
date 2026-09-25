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
		// A number of two words ("Twenty One") is complete after its first word, so the glue sits in the second.
		number := ""
		if isChapterNumber(token) && !isRoman(token) && tail != "" {
			number = token + " "
			token, tail, _ = strings.Cut(strings.TrimLeft(tail, " "), " ")
			runes = []rune(token)
		}
		split = gluedWordSplit(runes, tail != "")
		if split >= 0 {
			head := keyword + " " + number + string(runes[:split])
			subtitle := strings.TrimSpace(string(runes[split:]) + " " + tail)
			return head, subtitle, true
		}
		return title, "", false
	}
	if split < 0 {
		return title, "", false
	}
	head := keyword + " " + string(runes[:split])
	subtitle := strings.TrimSpace(string(runes[split:]) + " " + tail)
	return head, subtitle, true
}

// gluedWordSplit finds where a number written in words or roman numerals ends inside a token: at the first capital that begins a
// capitalized word after a complete number ("OneBad"), or, after a number written in words and before more words, at a closing
// one-letter "A" or "I" ("TwoA Night"). A roman numeral is never split before a final "I", since "XI" is a number. -1 when there
// is no such boundary.
func gluedWordSplit(runes []rune, moreWords bool) int {
	for index := 1; index+1 < len(runes); index++ {
		startsWord := unicode.IsUpper(runes[index]) && unicode.IsLower(runes[index+1])
		if startsWord && isChapterNumber(string(runes[:index])) {
			return index
		}
	}
	if last := len(runes) - 1; moreWords && last > 0 && (runes[last] == 'A' || runes[last] == 'I') {
		if prefix := string(runes[:last]); isChapterNumber(prefix) && !isRoman(prefix) {
			return last
		}
	}
	return -1
}

// subtitleHeading reports whether a heading met right under a chapter's own heading, before any of its text, is that chapter's
// subtitle set as a heading of its own (import heading misreads F5, #387, #388): it is deeper than the chapter heading, the chapter
// heading is a real heading (level 1 or deeper, so never a book title), not a reference section (a Characters section's
// subheadings are its entries) and not a part or book heading (whose next heading is its first chapter), and the heading does not
// itself name a chapter, part, prologue or the like.
func subtitleHeading(chapterTitle string, chapterLevel int, heading string, level int) bool {
	if chapterLevel < 1 || level <= chapterLevel || isNarrativeMarker(heading) || isNonChapterHeading(heading) || isReferenceHeading(chapterTitle) {
		return false
	}
	v := normalizedHeading(chapterTitle)
	return !strings.HasPrefix(v, "part ") && !strings.HasPrefix(v, "book ")
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

// aloneAtItsLevel reports whether the heading at index at is the only heading of its level under the chapter it follows: levels holds
// each block's heading level (0 for text), and the chapter ends at the next heading of chapterLevel or shallower. A chapter whose
// scenes are headings of that level has more than one, and its first scene is then a scene, never the chapter's subtitle.
func aloneAtItsLevel(levels []int, at, chapterLevel int) bool {
	for index := at + 1; index < len(levels); index++ {
		switch level := levels[index]; {
		case level == 0:
		case level <= chapterLevel:
			return true
		case level == levels[at]:
			return false
		}
	}
	return true
}
