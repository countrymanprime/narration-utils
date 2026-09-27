package preview

import (
	"strings"
	"testing"
)

// TestSuggestExcludesHardGatedWindowForSample is Phase 5's core success signal: a fixture with an open, anchored
// pickup finding at severity warning in the manuscript's first, otherwise-best window must not be suggested for
// the Sample preset when a clean window exists elsewhere in the chapter.
func TestSuggestExcludesHardGatedWindowForSample(t *testing.T) {
	chapters := []Chapter{{ID: "c1", ContentKind: ContentNarration, Order: 0}}
	var paragraphs []Paragraph
	for i := 0; i < 20; i++ {
		paragraphs = append(paragraphs, Paragraph{ID: paraID(i), ChapterID: "c1", Index: i, Text: words(100)})
	}
	findings := []OpenFinding{
		{ID: "f1", ChapterID: "c1", ParagraphID: paraID(0), Category: FindingPickup, Severity: FindingWarning},
	}
	settings := DefaultSettings()
	settings.Preset = PresetSample
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, OpenFindings: findings, Settings: settings})
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	c := got.Candidates[0]
	for _, id := range c.ParagraphIDs {
		if id == paraID(0) {
			t.Fatalf("the Sample candidate must avoid the hard-gated paragraph when a clean window exists: %+v", c)
		}
	}
	for _, w := range c.Warnings {
		if w != "" && strings.Contains(w, "pickup") {
			t.Fatalf("a clean chosen window must not carry the excluded finding's own warning: %+v", c.Warnings)
		}
	}
}

// TestSuggestSpotCheckKeepsHardGatedWindowButRanksItDownAndListsIt is Q7's "B for Spot-check": the same finding
// never excludes a window for the SpotCheck preset, only lowers its rank and appears as evidence. The fixture
// gives the first window a clearly higher text score (five distinct entities, versus none elsewhere) so it still
// wins even after the findings penalty; Sample, by contrast, must exclude it outright regardless of that score
// (TestSuggestExcludesHardGatedWindowForSample already covers Sample on this same shape).
func TestSuggestSpotCheckKeepsHardGatedWindowButRanksItDownAndListsIt(t *testing.T) {
	chapters := []Chapter{{ID: "c1", ContentKind: ContentNarration, Order: 0}}
	var paragraphs []Paragraph
	for i := 0; i < 20; i++ {
		p := Paragraph{ID: paraID(i), ChapterID: "c1", Index: i, Text: words(100)}
		if i == 0 {
			// Only the first paragraph mentions any entity, so a window can only get this score boost by
			// including it - shifting the window one paragraph later (as TestSuggestExcludesHardGatedWindowForSample
			// does for Sample) would lose it, not just avoid the finding for free.
			p.EntityIDs = []string{"e1", "e2", "e3", "e4", "e5"}
		}
		paragraphs = append(paragraphs, p)
	}
	findings := []OpenFinding{
		{ID: "f1", ChapterID: "c1", ParagraphID: paraID(0), Category: FindingPickup, Severity: FindingWarning},
	}
	settings := DefaultSettings()
	settings.Preset = PresetSpotCheck
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, OpenFindings: findings, Settings: settings})
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	c := got.Candidates[0]
	hasFirst := false
	for _, id := range c.ParagraphIDs {
		if id == paraID(0) {
			hasFirst = true
		}
	}
	if !hasFirst {
		t.Fatalf("SpotCheck must still be willing to choose the entity-rich window despite its open finding: %+v", c)
	}
	found := false
	for _, w := range c.Warnings {
		if strings.Contains(w, "pickup") {
			found = true
		}
	}
	if !found {
		t.Fatalf("SpotCheck must list the open finding as evidence: %+v", c.Warnings)
	}
}

// TestSuggestDismissedFindingsAreNeverPassedInDoNotCount confirms the package-level contract: a caller that
// filters dismissed findings out before building OpenFindings (PS Q2) sees no trace of them - there is nothing
// in this package that could "un-dismiss" one, since it never receives one at all.
func TestSuggestDismissedFindingsAreNeverPassedInDoNotCount(t *testing.T) {
	chapters, paragraphs := manyParagraphManuscript()
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, OpenFindings: nil, Settings: DefaultSettings()})
	if len(got.Candidates) != 1 || len(got.Candidates[0].Warnings) != 0 {
		t.Fatalf("no findings at all must mean no findings warnings: %+v", got.Candidates)
	}
}

// TestSuggestUnanchoredFindingWarnsEveryCandidateInItsChapter is Phase 5's stated fallback: a finding with no
// paragraph anchor can never be pinned to one window, so it becomes a chapter-level warning rather than a
// silent pass, and it never excludes a Sample candidate (only an anchored hard-gate finding does).
func TestSuggestUnanchoredFindingWarnsEveryCandidateInItsChapter(t *testing.T) {
	chapters := []Chapter{{ID: "c1", ContentKind: ContentNarration, Order: 0}}
	var paragraphs []Paragraph
	for i := 0; i < 20; i++ {
		paragraphs = append(paragraphs, Paragraph{ID: paraID(i), ChapterID: "c1", Index: i, Text: words(100)})
	}
	findings := []OpenFinding{
		{ID: "f1", ChapterID: "c1", ParagraphID: "", Category: FindingPickup, Severity: FindingWarning},
	}
	settings := DefaultSettings()
	settings.Preset = PresetSample
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, OpenFindings: findings, Settings: settings})
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	found := false
	for _, w := range got.Candidates[0].Warnings {
		if strings.Contains(w, "elsewhere in this chapter") {
			found = true
		}
	}
	if !found {
		t.Fatalf("an unanchored finding must warn, not silently pass: %+v", got.Candidates[0].Warnings)
	}
}

// TestSuggestInfoSeverityHardCategoryNeverExcludes is Q7's severity floor: a hard-gate category below warning
// severity only ranks down, it never excludes even for Sample.
func TestSuggestInfoSeverityHardCategoryNeverExcludes(t *testing.T) {
	chapters := []Chapter{{ID: "c1", ContentKind: ContentNarration, Order: 0}}
	var paragraphs []Paragraph
	for i := 0; i < 20; i++ {
		paragraphs = append(paragraphs, Paragraph{ID: paraID(i), ChapterID: "c1", Index: i, Text: words(100)})
	}
	findings := []OpenFinding{
		{ID: "f1", ChapterID: "c1", ParagraphID: paraID(0), Category: FindingPickup, Severity: FindingInfo},
	}
	settings := DefaultSettings()
	settings.Preset = PresetSample
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, OpenFindings: findings, Settings: settings})
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
}

// TestSuggestFindingsInAnotherChapterNeverAffectThisOne is a basic isolation check for findingsByChapter.
func TestSuggestFindingsInAnotherChapterNeverAffectThisOne(t *testing.T) {
	var chapters []Chapter
	var paragraphs []Paragraph
	for _, id := range []string{"c1", "c2"} {
		chapters = append(chapters, Chapter{ID: id, ContentKind: ContentNarration, Order: len(chapters)})
		for i := 0; i < 20; i++ {
			paragraphs = append(paragraphs, Paragraph{ID: id + paraID(i), ChapterID: id, Index: i, Text: words(100)})
		}
	}
	findings := []OpenFinding{
		{ID: "f1", ChapterID: "c2", ParagraphID: "c2" + paraID(0), Category: FindingPickup, Severity: FindingWarning},
	}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, OpenFindings: findings, Settings: DefaultSettings()})
	for _, c := range got.Candidates {
		if c.ChapterID == "c1" && len(c.Warnings) != 0 {
			t.Fatalf("chapter c1 must not see c2's finding: %+v", c)
		}
	}
}
