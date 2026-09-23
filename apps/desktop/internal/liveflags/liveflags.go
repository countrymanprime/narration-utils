// Package liveflags turns the read-aloud session's suspected flags (the teleprompter sidecar's `flag` events, ADR 0115)
// into shared findings (docs/architecture/findings-contract.md) once a session ends (ADR 0117). A flag is only ever
// suspected: live recognition is not proof, so a finding carries no confidence score and says why, and Transcript
// Compare over the recorded take stays authoritative. The UI names each flag's words by paragraph and word; the
// manuscript text is read here, so the expected text, the character span and the id come from the manuscript, never
// from the caller.
package liveflags

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// AnalyzerName is the findings analyzer (and sidecar folder) live flags are stored under.
const AnalyzerName = "teleprompter"

const (
	// maxFlags bounds one save: a chapter read aloud raises tens of flags, never thousands.
	maxFlags = 2000
	// maxHeardLength bounds the heard text of one flag (a restart carries the re-read words, a sentence or two).
	maxHeardLength = 2000
)

const confidenceReason = "Suspected from live speech recognition while reading aloud: the engine can mishear a correct read, so " +
	"this has no score and is not proof. Transcript Compare over the recorded take is authoritative."

// Flag is one flag as the read-aloud dialog sends it. WordStart and WordEnd are the flag's words within the paragraph,
// [WordStart, WordEnd), counted the way the reader splits the text (runs of non-whitespace). An extra covers exactly the one
// word it was heard before. ScriptStart and ScriptEnd are the event's own chapter word indices, kept only as evidence.
type Flag struct {
	Kind        string `json:"kind"`
	ParagraphID string `json:"paragraphId"`
	WordStart   int    `json:"wordStart"`
	WordEnd     int    `json:"wordEnd"`
	ScriptStart int    `json:"scriptStart"`
	ScriptEnd   int    `json:"scriptEnd"`
	Heard       string `json:"heard"`
	// Dismissed is the narrator's call in the dialog's review panel; the host records it as a decision, it never deletes.
	Dismissed bool `json:"dismissed"`
}

// Paragraph is one manuscript paragraph of the chapter read.
type Paragraph struct {
	ID   string
	Text string
}

// Chapter is the manuscript chapter the session read.
type Chapter struct {
	ID         string
	Title      string
	Paragraphs []Paragraph
}

type kindRule struct {
	category findings.Category
	severity findings.Severity
}

// kinds maps a flag kind to its findings category (ADR 0115 decision 5) and severity. The severities follow Transcript
// Compare's adapter (a misread or a skip usually needs a new take; an extra is sometimes a deliberate ad-lib), and a
// restart is the narrator's own recovery, so it is information, like take review's restart pickups.
var kinds = map[string]kindRule{
	"misread": {findings.CategoryTranscriptDiscrepancy, findings.SeverityWarning},
	"skipped": {findings.CategoryTranscriptDiscrepancy, findings.SeverityWarning},
	"extra":   {findings.CategoryTranscriptDiscrepancy, findings.SeverityInfo},
	"restart": {findings.CategoryPickup, findings.SeverityInfo},
}

// scopePattern mirrors findings.Store's own scope name rule.
var scopePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// Scope is the findings scope (file name) for a chapter id: the id itself when it is a safe file name, otherwise a
// short, deterministic name derived from it.
func Scope(chapterID string) string {
	if scopePattern.MatchString(chapterID) && !strings.Contains(chapterID, "..") {
		return chapterID
	}
	hash := sha256.Sum256([]byte(chapterID))
	return "chapter-" + hex.EncodeToString(hash[:8])
}

// ToFindings validates every flag against the chapter and returns one finding per flag, in order. Any invalid flag
// rejects the whole save, so a half-written session never lands in the store.
func ToFindings(chapter Chapter, project findings.Project, flags []Flag) ([]findings.Finding, error) {
	if chapter.ID == "" {
		return nil, fmt.Errorf("the chapter read aloud has no id")
	}
	if len(flags) > maxFlags {
		return nil, fmt.Errorf("%d flags is more than one session can raise (at most %d)", len(flags), maxFlags)
	}
	paragraphs := make(map[string]Paragraph, len(chapter.Paragraphs))
	for _, paragraph := range chapter.Paragraphs {
		paragraphs[paragraph.ID] = paragraph
	}
	project.OutputPath = path.Join(findings.Dir, AnalyzerName, Scope(chapter.ID)+".json")
	result := make([]findings.Finding, 0, len(flags))
	for index, flag := range flags {
		finding, err := toFinding(chapter, paragraphs, project, flag)
		if err != nil {
			return nil, fmt.Errorf("flag %d: %w", index+1, err)
		}
		result = append(result, finding)
	}
	return result, nil
}

func toFinding(chapter Chapter, paragraphs map[string]Paragraph, project findings.Project, flag Flag) (findings.Finding, error) {
	rule, known := kinds[flag.Kind]
	if !known {
		return findings.Finding{}, fmt.Errorf("kind %q is not misread, extra, skipped or restart", flag.Kind)
	}
	if len(flag.Heard) > maxHeardLength {
		return findings.Finding{}, fmt.Errorf("the heard text is longer than %d characters", maxHeardLength)
	}
	paragraph, found := paragraphs[flag.ParagraphID]
	if !found {
		return findings.Finding{}, fmt.Errorf("paragraph %q is not in chapter %q", flag.ParagraphID, chapter.ID)
	}
	offsets := wordOffsets(paragraph.Text)
	if flag.WordStart < 0 || flag.WordEnd <= flag.WordStart || flag.WordEnd > len(offsets) {
		return findings.Finding{}, fmt.Errorf("words [%d, %d) are not within the paragraph's %d words", flag.WordStart, flag.WordEnd, len(offsets))
	}
	if flag.Kind == "extra" && flag.WordEnd != flag.WordStart+1 {
		return findings.Finding{}, fmt.Errorf("an extra sits before exactly one word")
	}

	words := make([]string, len(offsets))
	for index, offset := range offsets {
		words[index] = paragraph.Text[offset[0]:offset[1]]
	}
	flagged := strings.Join(words[flag.WordStart:flag.WordEnd], " ")
	startByte, endByte := offsets[flag.WordStart][0], offsets[flag.WordEnd-1][1]
	expected := flagged
	evidence := map[string]any{
		"kind": flag.Kind, "heard": flag.Heard, "suspected": true,
		"script_words": []int{flag.ScriptStart, flag.ScriptEnd},
	}
	if flag.Kind == "extra" {
		// Nothing was expected where the extra words were heard: the span is zero-width before the word they preceded.
		expected, endByte = "", startByte
		evidence["before"] = flagged
	}
	ordinal := repeatsBefore(words, flag.WordStart, flag.WordEnd)
	span := &findings.Span{
		ParagraphID: paragraph.ID,
		Start:       utf16Length(paragraph.Text[:startByte]),
		End:         utf16Length(paragraph.Text[:endByte]),
		Ordinal:     ordinal,
	}
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion,
		ID:            findings.StableID(AnalyzerName, chapter.ID, paragraph.ID, flag.Kind, flagged, strconv.Itoa(ordinal)),
		Analyzer:      AnalyzerName,
		Project:       project,
		Manuscript: &findings.Manuscript{
			ChapterID: chapter.ID, ChapterTitle: chapter.Title,
			Expected: expected, Recorded: flag.Heard, Span: span,
		},
		Category:         rule.category,
		Severity:         rule.severity,
		ConfidenceReason: confidenceReason,
		EvidenceVersion:  EvidenceVersion(flag.Heard),
		Evidence:         evidence,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}, nil
}

// EvidenceVersion hashes what was heard, the one thing a later session can say differently about the same words. Case and
// spacing are the engine's, not the narrator's, so they do not reopen a decision.
func EvidenceVersion(heard string) string {
	normalized := strings.ToLower(strings.Join(strings.Fields(heard), " "))
	hash := sha256.Sum256([]byte(normalized))
	return "sha256:" + hex.EncodeToString(hash[:])
}

// repeatsBefore counts the earlier places in the paragraph where the same words (ignoring case) start, the contract's
// ordinal for a repeated span.
func repeatsBefore(words []string, start, end int) int {
	length := end - start
	count := 0
	for at := 0; at+length <= start; at++ {
		same := true
		for offset := range length {
			if !strings.EqualFold(words[at+offset], words[start+offset]) {
				same = false
				break
			}
		}
		if same {
			count++
		}
	}
	return count
}

// wordOffsets returns the byte range of every word of text: a run of characters JavaScript's `\S` matches, the way the
// reader splits a paragraph (readerModel.ts `wordOffsets`), so a word index means the same word on both sides.
func wordOffsets(text string) [][2]int {
	var result [][2]int
	start := -1
	for at, character := range text {
		switch {
		case isJSSpace(character) && start >= 0:
			result = append(result, [2]int{start, at})
			start = -1
		case !isJSSpace(character) && start < 0:
			start = at
		}
	}
	if start >= 0 {
		result = append(result, [2]int{start, len(text)})
	}
	return result
}

// isJSSpace is JavaScript's `\s`: the Unicode space separators, the line terminators, tab, vertical tab, form feed and the
// byte order mark. Go's unicode.IsSpace differs by U+0085 and U+FEFF, and RE2's `\s` is ASCII only.
func isJSSpace(character rune) bool {
	switch character {
	case 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return character >= 0x2000 && character <= 0x200a
}

// utf16Length is the length of text in UTF-16 code units, the unit the reader's (JavaScript) character offsets use.
func utf16Length(text string) int { return len(utf16.Encode([]rune(text))) }
