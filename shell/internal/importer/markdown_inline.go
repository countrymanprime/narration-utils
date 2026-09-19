package importer

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const markdownEscapable = "\\`*_{}[]()#+-.!<>~|"

var markdownTag = regexp.MustCompile(`(?i)^<(/?)(br|u)\s*/?>`)

func isWordRune(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }

// appendInline parses one line of Markdown inline syntax into b: *italic*,
// **bold**, ***both***, <u>underline</u>, <br> line breaks and backslash
// escapes. It is intentionally not a full CommonMark implementation - only the
// "normal storytelling formatting" the reader can display (ADR-0013). An
// unmatched marker is kept as literal text rather than swallowed.
func appendInline(b *richBuilder, line string, style Style) {
	runes := []rune(line)
	for i := 0; i < len(runes); {
		r := runes[i]
		switch {
		case r == '\\' && i+1 < len(runes) && strings.ContainsRune(markdownEscapable, runes[i+1]):
			b.text(string(runes[i+1]), style)
			i += 2
		case r == '<':
			i = appendTag(b, runes, i, style)
		case r == '*' || r == '_':
			i = appendEmphasis(b, runes, i, style)
		default:
			b.text(string(r), style)
			i++
		}
	}
}

func appendTag(b *richBuilder, runes []rune, index int, style Style) int {
	rest := string(runes[index:])
	match := markdownTag.FindStringSubmatch(rest)
	if match == nil {
		b.text("<", style)
		return index + 1
	}
	consumed := utf8.RuneCountInString(match[0])
	switch strings.ToLower(match[2]) {
	case "br":
		if match[1] == "" {
			b.lineBreak()
		}
	case "u":
		if match[1] != "" {
			break
		}
		close := strings.Index(strings.ToLower(rest), "</u>")
		if close < 0 {
			break
		}
		appendInline(b, rest[len(match[0]):close], style|styleUnderline)
		return index + utf8.RuneCountInString(rest[:close+len("</u>")])
	}
	return index + consumed
}

func appendEmphasis(b *richBuilder, runes []rune, index int, style Style) int {
	marker := runes[index]
	count := 1
	for index+count < len(runes) && runes[index+count] == marker && count < 3 {
		count++
	}
	literal := func() int {
		for range count {
			b.text(string(marker), style)
		}
		return index + count
	}
	opens := index+count < len(runes) && !unicode.IsSpace(runes[index+count]) && (marker == '*' || index == 0 || !isWordRune(runes[index-1]))
	if !opens {
		return literal()
	}
	end := findCloser(runes, index+count, marker, count)
	if end < 0 {
		return literal()
	}
	flag := map[int]Style{1: styleItalic, 2: styleBold, 3: styleBold | styleItalic}[count]
	appendInline(b, string(runes[index+count:end]), style|flag)
	return end + count
}

func findCloser(runes []rune, from int, marker rune, count int) int {
	for j := from; j < len(runes); j++ {
		if runes[j] == '\\' {
			j++
			continue
		}
		if runes[j] != marker {
			continue
		}
		run := 0
		for j+run < len(runes) && runes[j+run] == marker {
			run++
		}
		closes := run == count && j > from && !unicode.IsSpace(runes[j-1]) && (marker == '*' || j+count >= len(runes) || !isWordRune(runes[j+count]))
		if closes {
			return j
		}
		j += run - 1
	}
	return -1
}
