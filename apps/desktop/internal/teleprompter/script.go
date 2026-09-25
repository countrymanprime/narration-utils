package teleprompter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

// ChapterScript is a chapter as the sidecar tokenises it (chapter_script.load_chapter_script): the title's words,
// then each paragraph's, split on whitespace as Python's str.split() does. A position event's `read` and locate's
// `word` index Tokens, so the host can quote the sentence at any of them without running the sidecar
// (read-aloud-resume-from-daw PRD Phase 3). Breaks holds the index of the title's and each paragraph's first token.
type ChapterScript struct {
	Tokens []string
	Breaks []int
}

// LoadChapterScript reads chapterID's script from the imported manuscript, reporting false when there is no
// manuscript or no such chapter.
func LoadChapterScript(project, chapterID string) (ChapterScript, bool) {
	raw, err := os.ReadFile(filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"))
	if err != nil {
		return ChapterScript{}, false
	}
	var data struct {
		Chapters []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"chapters"`
		Paragraphs []struct {
			ChapterID string `json:"chapterId"`
			Text      string `json:"text"`
		} `json:"paragraphs"`
	}
	if json.Unmarshal(raw, &data) != nil {
		return ChapterScript{}, false
	}
	for _, chapter := range data.Chapters {
		if chapter.ID != chapterID {
			continue
		}
		script := ChapterScript{Tokens: splitWords(chapter.Title), Breaks: []int{0}}
		for _, paragraph := range data.Paragraphs {
			if paragraph.ChapterID == chapterID {
				script.Breaks = append(script.Breaks, len(script.Tokens))
				script.Tokens = append(script.Tokens, splitWords(paragraph.Text)...)
			}
		}
		return script, true
	}
	return ChapterScript{}, false
}

// splitWords is Python's str.split(): Go's unicode.IsSpace plus the four information separators Python also counts
// as whitespace.
func splitWords(text string) []string {
	return strings.FieldsFunc(text, func(r rune) bool { return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f) })
}

// sentenceEnd is locate.py's _SENTENCE_END_RE: a token ending a sentence, before any closing quotes or brackets.
var sentenceEnd = regexp.MustCompile(`[.!?…]["'”’)\]]*$`)

// SentenceAt is the [Start, End) sentence holding token index, as locate.sentence_bounds finds it: from just after
// the previous sentence-ending token to the next one, never across a paragraph break.
func (script ChapterScript) SentenceAt(index int) Sentence {
	breaks := make(map[int]bool, len(script.Breaks))
	for _, at := range script.Breaks {
		breaks[at] = true
	}
	start := index
	for start > 0 && !breaks[start] && !sentenceEnd.MatchString(script.Tokens[start-1]) {
		start--
	}
	end := index + 1
	for end < len(script.Tokens) && !breaks[end] && !sentenceEnd.MatchString(script.Tokens[end-1]) {
		end++
	}
	return Sentence{Start: start, End: end, Text: strings.Join(script.Tokens[start:end], " ")}
}

// WordsLeft reports whether any token from index on is a word the tracker reads: one that script_tracker's
// normalize_word does not reduce to nothing (it keeps letters, digits, underscores and apostrophes).
func (script ChapterScript) WordsLeft(index int) bool {
	for i := max(index, 0); i < len(script.Tokens); i++ {
		if strings.IndexFunc(script.Tokens[i], isWordRune) >= 0 {
			return true
		}
	}
	return false
}

func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.Is(unicode.Mn, r) || r == '_' || r == '\''
}
