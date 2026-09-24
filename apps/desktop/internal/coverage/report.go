package coverage

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

// resultSchemaVersion is the sidecar results file version this reader knows
// (coverage_mode.RESULT_SCHEMA_VERSION).
const resultSchemaVersion = 1

// maxResultsBytes bounds how much of a results file is read: a chapter's report
// is a few kilobytes per hundred paragraphs, so this is far above any real one.
const maxResultsBytes = 16 << 20

// regionKinds are the sidecar's region kinds (recording_coverage.REGION_KINDS).
var regionKinds = map[string]bool{"head": true, "tail": true, "skip": true, "short_read": true, "different_text": true}

// Summary is the sidecar's COVERAGE line: counts only, never a verdict.
type Summary struct {
	SchemaVersion     int             `json:"schemaVersion"`
	ChapterID         string          `json:"chapterId"`
	BodyTokens        int             `json:"bodyTokens"`
	PresentTokens     int             `json:"presentTokens"`
	MissingTokens     int             `json:"missingTokens"`
	ExtraTokens       int             `json:"extraTokens"`
	LongestMissingRun int             `json:"longestMissingRun"`
	Alignment         AlignmentParams `json:"alignment"`
	Items             SummaryItems    `json:"items"`
	Analysis          SummaryAnalysis `json:"analysis"`
}

// SummaryItems counts the manifest's items as the sidecar treated them.
type SummaryItems struct {
	Analyzed      int     `json:"analyzed"`
	Muted         int     `json:"muted"`
	PlayedSeconds float64 `json:"playedSeconds"`
	Transcribed   int     `json:"transcribed"`
	Reused        int     `json:"reused"`
}

// SummaryAnalysis labels how the run was made (Q7, Q13).
type SummaryAnalysis struct {
	Model            string  `json:"model"`
	Language         *string `json:"language"`
	EquivalencesHash *string `json:"equivalencesHash"`
}

// ItemLine is one COVERAGE_ITEM line: an analyzed or muted manifest item.
type ItemLine struct {
	Index         int     `json:"index"`
	ItemGUID      string  `json:"itemGuid"`
	Status        string  `json:"status"`
	Words         *string `json:"words"`
	PlayedSeconds float64 `json:"playedSeconds"`
	WordCount     int     `json:"wordCount"`
	Model         *string `json:"model"`
	Language      *string `json:"language"`
}

// ParagraphLine is one COVERAGE_PARAGRAPH line.
type ParagraphLine struct {
	ID                string `json:"id"`
	Tokens            int    `json:"tokens"`
	Present           int    `json:"present"`
	LongestMissingRun int    `json:"longestMissingRun"`
}

// PresentFraction is the paragraph's share of words read (1 for an empty one,
// as the sidecar's ParagraphCoverage.present_fraction).
func (p ParagraphLine) PresentFraction() float64 {
	if p.Tokens == 0 {
		return 1
	}
	return float64(p.Present) / float64(p.Tokens)
}

// RegionPosition is a point in the audio: an item and a time in its source file.
type RegionPosition struct {
	ItemIndex  int     `json:"itemIndex"`
	ItemGUID   string  `json:"itemGuid"`
	SourceTime float64 `json:"sourceTime"`
}

// RegionLine is one COVERAGE_REGION line. Position is where the missing text
// would sit. Before and After bound it (ADR 0168): the end of the last matched
// word before the region and the start of the first matched word after it,
// each in its own item. Either is nil at a chapter edge (always before a head,
// after a tail), when nothing was said, and in a result written before the
// sidecar reported bounds.
type RegionLine struct {
	Kind         string          `json:"kind"`
	ParagraphIDs []string        `json:"paragraphIds"`
	TokenCount   int             `json:"tokenCount"`
	FirstWord    string          `json:"firstWord"`
	LastWord     string          `json:"lastWord"`
	Position     *RegionPosition `json:"position"`
	Before       *RegionPosition `json:"before"`
	After        *RegionPosition `json:"after"`
}

// Report is a whole results file.
type Report struct {
	Summary    Summary         `json:"summary"`
	Items      []ItemLine      `json:"items"`
	Paragraphs []ParagraphLine `json:"paragraphs"`
	Regions    []RegionLine    `json:"regions"`
}

// PresentFraction is the chapter's share of body words read: what fills
// ManuscriptChapter.recordedFraction (D11) for a current, complete result.
func (r Report) PresentFraction() float64 {
	if r.Summary.BodyTokens == 0 {
		return 1
	}
	return float64(r.Summary.PresentTokens) / float64(r.Summary.BodyTokens)
}

// readReport reads and checks a results file the sidecar wrote for chapterID.
func readReport(path, chapterID string) (Report, error) {
	file, err := os.Open(path)
	if err != nil {
		return Report{}, fmt.Errorf("the coverage results could not be read: %w", err)
	}
	defer func() { _ = file.Close() }()
	raw, err := io.ReadAll(io.LimitReader(file, maxResultsBytes+1))
	if err != nil {
		return Report{}, fmt.Errorf("the coverage results could not be read: %w", err)
	}
	if len(raw) > maxResultsBytes {
		return Report{}, fmt.Errorf("the coverage results are larger than %d bytes", maxResultsBytes)
	}
	return parseReport(raw, chapterID)
}

// parseReport reads the tagged lines (ADR 0127). A tag it does not know is
// skipped (the format is additive); a known tag whose payload does not decode,
// a count that does not add up, or a report for another chapter is an error.
func parseReport(raw []byte, chapterID string) (Report, error) {
	var report Report
	summaries := 0
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 0, 64*1024), maxResultsBytes)
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimRight(scanner.Text(), "\r")
		if text == "" {
			continue
		}
		tag, payload, found := strings.Cut(text, "|")
		if !found {
			return Report{}, fmt.Errorf("coverage results line %d has no tag", line)
		}
		var target any
		switch tag {
		case "COVERAGE":
			summaries++
			target = &report.Summary
		case "COVERAGE_ITEM":
			report.Items = append(report.Items, ItemLine{})
			target = &report.Items[len(report.Items)-1]
		case "COVERAGE_PARAGRAPH":
			report.Paragraphs = append(report.Paragraphs, ParagraphLine{})
			target = &report.Paragraphs[len(report.Paragraphs)-1]
		case "COVERAGE_REGION":
			report.Regions = append(report.Regions, RegionLine{})
			target = &report.Regions[len(report.Regions)-1]
		default:
			continue
		}
		if err := json.Unmarshal([]byte(payload), target); err != nil {
			return Report{}, fmt.Errorf("coverage results line %d (%s) could not be read: %w", line, tag, err)
		}
	}
	if err := scanner.Err(); err != nil {
		return Report{}, fmt.Errorf("the coverage results could not be read: %w", err)
	}
	if summaries != 1 {
		return Report{}, fmt.Errorf("the coverage results have %d COVERAGE lines, not one", summaries)
	}
	return report, report.check(chapterID)
}

func (r Report) check(chapterID string) error {
	s := r.Summary
	switch {
	case s.SchemaVersion != resultSchemaVersion:
		return fmt.Errorf("the coverage results are schema version %d, not %d", s.SchemaVersion, resultSchemaVersion)
	case s.ChapterID != chapterID:
		return fmt.Errorf("the coverage results are for chapter %q, not %q", s.ChapterID, chapterID)
	case s.BodyTokens < 0 || s.PresentTokens < 0 || s.MissingTokens < 0 || s.ExtraTokens < 0 || s.LongestMissingRun < 0:
		return fmt.Errorf("the coverage results have a negative count")
	case s.PresentTokens+s.MissingTokens != s.BodyTokens:
		return fmt.Errorf("the coverage results' present and missing words do not add up to the chapter's words")
	case s.LongestMissingRun > s.MissingTokens:
		return fmt.Errorf("the coverage results' longest missing run is longer than the missing words")
	}
	tokens := 0
	for _, paragraph := range r.Paragraphs {
		if paragraph.ID == "" || paragraph.Tokens < 0 || paragraph.Present < 0 || paragraph.Present > paragraph.Tokens || paragraph.LongestMissingRun < 0 {
			return fmt.Errorf("the coverage results have an invalid paragraph %q", paragraph.ID)
		}
		tokens += paragraph.Tokens
	}
	if tokens != s.BodyTokens {
		return fmt.Errorf("the coverage results' paragraphs hold %d words, not the chapter's %d", tokens, s.BodyTokens)
	}
	for _, region := range r.Regions {
		if !regionKinds[region.Kind] || region.TokenCount <= 0 {
			return fmt.Errorf("the coverage results have an invalid %q region", region.Kind)
		}
	}
	return nil
}

// Thresholds are the narrator's pass/fail settings (Q3), applied on read so a
// change never re-transcribes or re-aligns. They come from settings
// (ResolveSettings) and are applied by RecordingSignal.
type Thresholds struct {
	MinParagraphPresent float64
	MaxMissingRun       int
}

// DefaultThresholds are the shipped defaults (ADR 0132): calibrated on the
// synthetic fixtures only, so still Proposed and uncalibrated on real narration (Q15).
var DefaultThresholds = Thresholds{MinParagraphPresent: 0.8, MaxMissingRun: 3}

// TextComplete is the PRD's chapter `text_complete`: every paragraph's present
// fraction is at or above the minimum and no missing run, head and tail
// included, is longer than the maximum. It mirrors the sidecar model's
// ChapterCoverage.text_complete.
func (r Report) TextComplete(thresholds Thresholds) bool {
	if r.Summary.LongestMissingRun > thresholds.MaxMissingRun {
		return false
	}
	for _, paragraph := range r.Paragraphs {
		if !paragraphPasses(paragraph, thresholds) {
			return false
		}
	}
	return true
}

// paragraphPasses is one paragraph's half of TextComplete: enough of it read
// and no missing run inside it over the limit.
func paragraphPasses(paragraph ParagraphLine, thresholds Thresholds) bool {
	return paragraph.PresentFraction() >= thresholds.MinParagraphPresent && paragraph.LongestMissingRun <= thresholds.MaxMissingRun
}
