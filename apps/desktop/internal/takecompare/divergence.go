package takecompare

import (
	"bufio"
	"encoding/json"
	"fmt"
	"strings"
)

// The sidecar's per-take divergence output (compare.py --take-divergence, ADR 0141): a SUMMARY line, one
// DIVERGENCE_SPAN line naming the span every take was aligned to, and one TAKE_DIVERGENCE line per take, in manifest
// order. Every time is in the take's source seconds. ParseResults reads it; nothing here re-aligns or re-judges.

// ResultSchemaVersion is the only DIVERGENCE_SPAN schema this package reads.
const ResultSchemaVersion = 1

// The word statuses a take's span words can have (take_divergence.WORD_STATUSES).
const (
	WordMatched = "matched"
	WordMisread = "misread"
	WordSkipped = "skipped"
	WordUnread  = "unread"
)

// SpanWord is one spoken manuscript word of the span.
type SpanWord struct {
	Index     int    `json:"index"`
	Text      string `json:"text"`
	Unit      int    `json:"unit"`
	Paragraph int    `json:"paragraph"`
}

// Span is the fixed run of a chapter's sentence units every take was aligned to.
type Span struct {
	FirstUnit      int        `json:"firstUnit"`
	LastUnit       int        `json:"lastUnit"`
	FirstParagraph int        `json:"firstParagraph"`
	LastParagraph  int        `json:"lastParagraph"`
	Words          []SpanWord `json:"words"`
}

// Header is the DIVERGENCE_SPAN line.
type Header struct {
	SchemaVersion int     `json:"schemaVersion"`
	ChapterID     string  `json:"chapterId"`
	ChapterTitle  string  `json:"chapterTitle"`
	Span          Span    `json:"span"`
	Model         string  `json:"model"`
	Language      *string `json:"language"`
}

// WordState is one span word as a take read it; Start and End are nil for a word the take has no time for.
type WordState struct {
	Index  int      `json:"index"`
	Status string   `json:"status"`
	Start  *float64 `json:"start"`
	End    *float64 `json:"end"`
}

// Divergence is one place a take departs from the span: span words FirstWord..LastWord (nil for an extra after the
// last word) and the source seconds it occupies (nil for an unread stretch).
type Divergence struct {
	Kind           string   `json:"kind"`
	Position       string   `json:"position"`
	FirstWord      *int     `json:"firstWord"`
	LastWord       *int     `json:"lastWord"`
	ManuscriptText string   `json:"manuscriptText"`
	AudioText      string   `json:"audioText"`
	Start          *float64 `json:"start"`
	End            *float64 `json:"end"`
}

// Counts are how many span words have each status, plus the words the take said that are not in the span.
type Counts struct {
	Matched    int `json:"matched"`
	Misread    int `json:"misread"`
	Skipped    int `json:"skipped"`
	Unread     int `json:"unread"`
	ExtraWords int `json:"extraWords"`
}

// TakeDivergence is one TAKE_DIVERGENCE line.
type TakeDivergence struct {
	Index       int          `json:"index"`
	ItemGUID    string       `json:"itemGuid"`
	TakeGUID    string       `json:"takeGuid"`
	SourceFile  string       `json:"sourceFile"`
	StartOffset float64      `json:"startOffset"`
	Length      float64      `json:"length"`
	Fidelity    float64      `json:"fidelity"`
	Counts      Counts       `json:"counts"`
	Words       []WordState  `json:"words"`
	Divergences []Divergence `json:"divergences"`
}

// Results is a whole results file.
type Results struct {
	Summary string
	Header  Header
	Takes   []TakeDivergence
}

// ParseResults reads a --take-divergence results file. It refuses a file without exactly one DIVERGENCE_SPAN line of
// the known schema, a take line that is not valid JSON, and a take whose words do not number the span's words in
// order, so a later step never lines up a take against the wrong words. Unknown tags are ignored (additive lines).
func ParseResults(text string) (Results, error) {
	var results Results
	spans := 0
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		tag, payload, found := strings.Cut(scanner.Text(), "|")
		if !found {
			continue
		}
		switch tag {
		case "SUMMARY":
			results.Summary = payload
		case "DIVERGENCE_SPAN":
			spans++
			if err := json.Unmarshal([]byte(payload), &results.Header); err != nil {
				return Results{}, fmt.Errorf("the divergence span line is not valid JSON: %w", err)
			}
		case "TAKE_DIVERGENCE":
			var take TakeDivergence
			if err := json.Unmarshal([]byte(payload), &take); err != nil {
				return Results{}, fmt.Errorf("take divergence line %d is not valid JSON: %w", len(results.Takes)+1, err)
			}
			results.Takes = append(results.Takes, take)
		}
	}
	if err := scanner.Err(); err != nil {
		return Results{}, fmt.Errorf("the divergence results could not be read: %w", err)
	}
	switch {
	case spans != 1:
		return Results{}, fmt.Errorf("the divergence results have %d span lines, not one", spans)
	case results.Header.SchemaVersion != ResultSchemaVersion:
		return Results{}, fmt.Errorf("the divergence results are schema version %d, not %d", results.Header.SchemaVersion, ResultSchemaVersion)
	case len(results.Header.Span.Words) == 0:
		return Results{}, fmt.Errorf("the divergence span has no words")
	}
	for position, take := range results.Takes {
		if err := checkTakeWords(take, len(results.Header.Span.Words)); err != nil {
			return Results{}, fmt.Errorf("take %d: %w", position+1, err)
		}
	}
	return results, nil
}

func checkTakeWords(take TakeDivergence, spanWords int) error {
	if len(take.Words) != spanWords {
		return fmt.Errorf("it has %d word states for a span of %d words", len(take.Words), spanWords)
	}
	for i, word := range take.Words {
		if word.Index != i {
			return fmt.Errorf("word state %d names span word %d", i, word.Index)
		}
		switch word.Status {
		case WordMatched, WordMisread, WordSkipped, WordUnread:
		default:
			return fmt.Errorf("word %d has the unknown status %q", i, word.Status)
		}
	}
	return nil
}
