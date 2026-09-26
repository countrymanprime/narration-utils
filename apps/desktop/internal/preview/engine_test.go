package preview

import (
	"strings"
	"testing"
)

// words returns a paragraph text of n whitespace-separated words, "word0 word1 ...".
func words(n int) string {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = "word"
	}
	return strings.Join(parts, " ")
}

// A one-chapter manuscript with enough narration text to fill several five-minute windows: 20 paragraphs of 100
// words each (2,000 words; a 5:00 window at the fixed pace is about 775 words, so several distinct windows exist).
func manyParagraphManuscript() ([]Chapter, []Paragraph) {
	chapters := []Chapter{{ID: "c1", Title: "Chapter One", ContentKind: ContentNarration, Order: 0}}
	paragraphs := make([]Paragraph, 20)
	for i := range paragraphs {
		paragraphs[i] = Paragraph{ID: paraID(i), ChapterID: "c1", Index: i, Text: words(100)}
	}
	return chapters, paragraphs
}

func paraID(i int) string { return "p" + string(rune('a'+i)) }

func TestSuggestIsDeterministic(t *testing.T) {
	chapters, paragraphs := manyParagraphManuscript()
	in := Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()}
	first := Suggest(in)
	second := Suggest(in)
	if len(first.Candidates) == 0 {
		t.Fatal("expected at least one candidate")
	}
	for i := range first.Candidates {
		a, b := first.Candidates[i], second.Candidates[i]
		if a.ChapterID != b.ChapterID || a.WordCount != b.WordCount || len(a.ParagraphIDs) != len(b.ParagraphIDs) {
			t.Fatalf("Suggest is not deterministic: %+v vs %+v", a, b)
		}
		for j := range a.ParagraphIDs {
			if a.ParagraphIDs[j] != b.ParagraphIDs[j] {
				t.Fatalf("paragraph order differs between runs: %+v vs %+v", a.ParagraphIDs, b.ParagraphIDs)
			}
		}
	}
}

func TestSuggestNoManuscript(t *testing.T) {
	if got := Suggest(Input{}); got.Outcome != OutcomeNoManuscript {
		t.Fatalf("Outcome = %q, want %q", got.Outcome, OutcomeNoManuscript)
	}
}

func TestSuggestNothingEligible(t *testing.T) {
	chapters := []Chapter{{ID: "c1", ContentKind: ContentReference, Order: 0}, {ID: "c2", ContentKind: ContentOpening, Order: 1}}
	paragraphs := []Paragraph{{ID: "p1", ChapterID: "c1", Index: 0, Text: words(1000)}}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	if got.Outcome != OutcomeNothingEligible {
		t.Fatalf("Outcome = %q, want %q", got.Outcome, OutcomeNothingEligible)
	}
}

// TestSuggestExcludesReferenceAndOpeningAndNeverCrossesAChapter is the eligibility table test (Success Metrics: "0
// candidates that include reference or opening content or cross a chapter boundary").
func TestSuggestExcludesReferenceAndOpeningAndNeverCrossesAChapter(t *testing.T) {
	chapters := []Chapter{
		{ID: "front", ContentKind: ContentOpening, Order: 0},
		{ID: "c1", ContentKind: ContentNarration, Order: 1},
		{ID: "back", ContentKind: ContentReference, Order: 2},
	}
	var paragraphs []Paragraph
	for _, chapterID := range []string{"front", "c1", "back"} {
		for i := 0; i < 15; i++ {
			paragraphs = append(paragraphs, Paragraph{ID: chapterID + paraID(i), ChapterID: chapterID, Index: i, Text: words(100)})
		}
	}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	for _, c := range got.Candidates {
		if c.ChapterID != "c1" {
			t.Fatalf("a candidate came from an ineligible chapter: %+v", c)
		}
	}
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v, want exactly the one eligible chapter's window", got.Candidates)
	}
}

// TestSuggestMissingContentKindReadsAsNarration is Q4's D22 default.
func TestSuggestMissingContentKindReadsAsNarration(t *testing.T) {
	chapters := []Chapter{{ID: "c1", Order: 0}} // no ContentKind set at all
	paragraphs := []Paragraph{{ID: "p1", ChapterID: "c1", Index: 0, Text: words(1000)}}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	if got.Outcome != OutcomeOK || len(got.Candidates) != 1 {
		t.Fatalf("a missing content kind must be treated as narration: %+v", got)
	}
	if len(got.Candidates[0].Warnings) == 0 {
		t.Fatal("a missing content kind must be named honestly in the evidence")
	}
}

// TestSuggestLengthWithinTolerance is the length-accuracy metric.
func TestSuggestLengthWithinTolerance(t *testing.T) {
	chapters, paragraphs := manyParagraphManuscript()
	settings := DefaultSettings()
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: settings})
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	c := got.Candidates[0]
	target := settings.TargetSeconds
	tolerance := target * settings.ToleranceFraction
	if c.EstimatedSeconds < target-tolerance || c.EstimatedSeconds > target+tolerance {
		t.Fatalf("estimated seconds %v outside tolerance of target %v +/- %v", c.EstimatedSeconds, target, tolerance)
	}
	if c.Shorter {
		t.Fatal("a chapter with plenty of text must not be marked Shorter")
	}
}

// TestSuggestNamesAChapterShorterThanTarget is the "named state" for too-short text.
func TestSuggestNamesAChapterShorterThanTarget(t *testing.T) {
	chapters := []Chapter{{ID: "c1", ContentKind: ContentNarration, Order: 0}}
	paragraphs := []Paragraph{{ID: "p1", ChapterID: "c1", Index: 0, Text: words(20)}}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	if !got.Candidates[0].Shorter {
		t.Fatal("a chapter with far too little text must be marked Shorter, not silently padded or hidden")
	}
	if len(got.Candidates[0].Warnings) == 0 {
		t.Fatal("a Shorter candidate must say so in its warnings")
	}
}

// TestSuggestOneCandidatePerChapterTopThree is Q12: at most one per chapter, top three overall.
func TestSuggestOneCandidatePerChapterTopThree(t *testing.T) {
	var chapters []Chapter
	var paragraphs []Paragraph
	for chapterIndex := 0; chapterIndex < 5; chapterIndex++ {
		id := paraID(chapterIndex) + "-chapter"
		chapters = append(chapters, Chapter{ID: id, ContentKind: ContentNarration, Order: chapterIndex})
		for i := 0; i < 20; i++ {
			paragraphs = append(paragraphs, Paragraph{ID: id + paraID(i), ChapterID: id, Index: i, Text: words(100)})
		}
	}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	if len(got.Candidates) != 3 {
		t.Fatalf("candidates = %d, want top 3 of 5 eligible chapters", len(got.Candidates))
	}
	seen := map[string]bool{}
	for _, c := range got.Candidates {
		if seen[c.ChapterID] {
			t.Fatalf("chapter %s appears twice: %+v", c.ChapterID, got.Candidates)
		}
		seen[c.ChapterID] = true
	}
}

// TestSuggestNoDialogueNoEntitiesOneChapterStillReturnsHonestReasons is Phase 1's own success signal wording.
func TestSuggestNoDialogueNoEntitiesOneChapterStillReturnsHonestReasons(t *testing.T) {
	chapters := []Chapter{{ID: "c1", ContentKind: ContentNarration, Order: 0}}
	var paragraphs []Paragraph
	for i := 0; i < 10; i++ {
		paragraphs = append(paragraphs, Paragraph{ID: paraID(i), ChapterID: "c1", Index: i, Text: words(100)})
	}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	if len(got.Candidates) != 1 || len(got.Candidates[0].Reasons) == 0 {
		t.Fatalf("a plain manuscript with no dialogue or entities must still get a candidate with reasons: %+v", got)
	}
}

func TestSuggestNeverSplitsAParagraphOrCrossesAChapterBoundary(t *testing.T) {
	chapters, paragraphs := manyParagraphManuscript()
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	byID := map[string]Paragraph{}
	for _, p := range paragraphs {
		byID[p.ID] = p
	}
	for _, c := range got.Candidates {
		for _, id := range c.ParagraphIDs {
			p, ok := byID[id]
			if !ok {
				t.Fatalf("candidate references an unknown paragraph id %q", id)
			}
			if p.ChapterID != c.ChapterID {
				t.Fatalf("candidate %+v crosses a chapter boundary via paragraph %+v", c, p)
			}
		}
	}
}
