package credits

import (
	"fmt"
	"strings"
)

// WordsPerFinishedHour is the estimate's narration rate (~155 words a minute), the same figure as the UI's
// WORDS_PER_FINISHED_HOUR (apps/ui/src/state.ts); the host needs it only to hold a retail sample to its limit.
const WordsPerFinishedHour = 9300

// MaxRetailSampleSeconds is the longest retail sample ACX accepts, 5 minutes (PRD Open Question C10).
const MaxRetailSampleSeconds = 300

// RetailSample is the range of the book the narrator picked as the retail sample (C10, owner decision 2026-09-23: at most
// 5 minutes, anywhere in the book). It is stored on the project manifest by paragraph id and is a marker only: it adds
// no time to the estimate (ADR 0152).
type RetailSample struct {
	StartParagraphID string `json:"startParagraphId"`
	EndParagraphID   string `json:"endParagraphId"`
}

// SampleParagraph is one manuscript.json paragraph, in book order.
type SampleParagraph struct {
	ID        string
	ChapterID string
	Text      string
}

// MeasuredSample is a retail sample with where it starts and ends (the line the Manuscript reader shows, counted from 1
// within each chapter) and how long it runs at WordsPerFinishedHour.
type MeasuredSample struct {
	StartParagraphID string  `json:"startParagraphId"`
	EndParagraphID   string  `json:"endParagraphId"`
	StartChapterID   string  `json:"startChapterId"`
	StartLine        int     `json:"startLine"`
	EndChapterID     string  `json:"endChapterId"`
	EndLine          int     `json:"endLine"`
	Words            int     `json:"words"`
	Seconds          float64 `json:"seconds"`
}

// MeasureSample measures the range startID..endID (both included) of paragraphs, which are in book order. It refuses a
// paragraph the manuscript does not have, an end before the start, and a range over MaxRetailSampleSeconds.
func MeasureSample(paragraphs []SampleParagraph, startID, endID string) (MeasuredSample, error) {
	start, end := -1, -1
	lines := make([]int, len(paragraphs))
	perChapter := map[string]int{}
	for index, paragraph := range paragraphs {
		perChapter[paragraph.ChapterID]++
		lines[index] = perChapter[paragraph.ChapterID]
		if paragraph.ID == startID && start == -1 {
			start = index
		}
		if paragraph.ID == endID && end == -1 {
			end = index
		}
	}
	if start == -1 || end == -1 {
		return MeasuredSample{}, fmt.Errorf("the retail sample's lines are not in this manuscript; pick the range again")
	}
	if end < start {
		return MeasuredSample{}, fmt.Errorf("the retail sample ends before it starts")
	}
	total := 0
	for _, paragraph := range paragraphs[start : end+1] {
		total += len(strings.Fields(paragraph.Text))
	}
	if total*3600 > MaxRetailSampleSeconds*WordsPerFinishedHour {
		return MeasuredSample{}, fmt.Errorf("a retail sample can be at most 5 minutes; this range is %d words, about %s", total, clock(float64(total)*3600/WordsPerFinishedHour))
	}
	return MeasuredSample{
		StartParagraphID: startID, EndParagraphID: endID,
		StartChapterID: paragraphs[start].ChapterID, StartLine: lines[start],
		EndChapterID: paragraphs[end].ChapterID, EndLine: lines[end],
		Words: total, Seconds: float64(total) * 3600 / WordsPerFinishedHour,
	}, nil
}

func clock(seconds float64) string {
	whole := int(seconds + 0.5)
	if whole >= 3600 {
		return fmt.Sprintf("%dh %02dm", whole/3600, whole%3600/60)
	}
	return fmt.Sprintf("%dm %02ds", whole/60, whole%60)
}
