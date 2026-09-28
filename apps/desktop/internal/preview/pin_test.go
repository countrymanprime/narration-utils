package preview

import "testing"

func TestCheckStaleNoneWhenTextUnchanged(t *testing.T) {
	pin := PinnedRange{ChapterID: "c1", ParagraphIDs: []string{"p1", "p2"}, AnchorText: map[string]string{"p1": "one", "p2": "two"}}
	current := map[string]string{"p1": "one", "p2": "two", "p3": "three"}
	if reason := CheckStale(pin, current); reason != StaleNone {
		t.Fatalf("CheckStale = %q, want %q", reason, StaleNone)
	}
}

func TestCheckStaleTextChanged(t *testing.T) {
	pin := PinnedRange{ChapterID: "c1", ParagraphIDs: []string{"p1", "p2"}, AnchorText: map[string]string{"p1": "one", "p2": "two"}}
	current := map[string]string{"p1": "one", "p2": "two edited"}
	if reason := CheckStale(pin, current); reason != StaleTextChanged {
		t.Fatalf("CheckStale = %q, want %q", reason, StaleTextChanged)
	}
}

func TestCheckStaleParagraphMissing(t *testing.T) {
	pin := PinnedRange{ChapterID: "c1", ParagraphIDs: []string{"p1", "p2"}, AnchorText: map[string]string{"p1": "one", "p2": "two"}}
	current := map[string]string{"p1": "one"} // p2 is gone (a re-import renumbered or dropped it)
	if reason := CheckStale(pin, current); reason != StaleParagraphMissing {
		t.Fatalf("CheckStale = %q, want %q", reason, StaleParagraphMissing)
	}
}

// chapterOf builds n paragraphs of chapterID, indexed in order, each with distinct text so staleness tests can
// tell them apart.
func chapterOf(chapterID string, n int) []Paragraph {
	out := make([]Paragraph, n)
	for i := range out {
		out[i] = Paragraph{ID: chapterParaID(chapterID, i), ChapterID: chapterID, Index: i, Text: words(10)}
	}
	return out
}

func chapterParaID(chapterID string, i int) string { return chapterID + string(rune('a'+i)) }

func TestAdjustRangeGrowsStartByOneParagraph(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 2), chapterParaID("c1", 3)} // paragraphs[2], paragraphs[3]
	got, ok := AdjustRange(paragraphs, "c1", current, EdgeStart, true)
	if !ok {
		t.Fatal("AdjustRange reported not ok")
	}
	want := []string{chapterParaID("c1", 1), chapterParaID("c1", 2), chapterParaID("c1", 3)}
	if !equalStrings(got, want) {
		t.Fatalf("AdjustRange = %v, want %v", got, want)
	}
}

func TestAdjustRangeGrowStartNoOpAtChapterStart(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 0), chapterParaID("c1", 1)}
	got, ok := AdjustRange(paragraphs, "c1", current, EdgeStart, true)
	if !ok {
		t.Fatal("AdjustRange reported not ok")
	}
	if !equalStrings(got, current) {
		t.Fatalf("AdjustRange = %v, want unchanged %v", got, current)
	}
}

func TestAdjustRangeGrowsEndByOneParagraph(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 1), chapterParaID("c1", 2)}
	got, ok := AdjustRange(paragraphs, "c1", current, EdgeEnd, true)
	if !ok {
		t.Fatal("AdjustRange reported not ok")
	}
	want := []string{chapterParaID("c1", 1), chapterParaID("c1", 2), chapterParaID("c1", 3)}
	if !equalStrings(got, want) {
		t.Fatalf("AdjustRange = %v, want %v", got, want)
	}
}

func TestAdjustRangeGrowEndNoOpAtChapterEnd(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 3), chapterParaID("c1", 4)}
	got, ok := AdjustRange(paragraphs, "c1", current, EdgeEnd, true)
	if !ok {
		t.Fatal("AdjustRange reported not ok")
	}
	if !equalStrings(got, current) {
		t.Fatalf("AdjustRange = %v, want unchanged %v", got, current)
	}
}

func TestAdjustRangeShrinksStartByOneParagraph(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 1), chapterParaID("c1", 2), chapterParaID("c1", 3)}
	got, ok := AdjustRange(paragraphs, "c1", current, EdgeStart, false)
	if !ok {
		t.Fatal("AdjustRange reported not ok")
	}
	want := []string{chapterParaID("c1", 2), chapterParaID("c1", 3)}
	if !equalStrings(got, want) {
		t.Fatalf("AdjustRange = %v, want %v", got, want)
	}
}

func TestAdjustRangeShrinksEndByOneParagraph(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 1), chapterParaID("c1", 2), chapterParaID("c1", 3)}
	got, ok := AdjustRange(paragraphs, "c1", current, EdgeEnd, false)
	if !ok {
		t.Fatal("AdjustRange reported not ok")
	}
	want := []string{chapterParaID("c1", 1), chapterParaID("c1", 2)}
	if !equalStrings(got, want) {
		t.Fatalf("AdjustRange = %v, want %v", got, want)
	}
}

// TestAdjustRangeNeverShrinksBelowOneParagraph is Q3's "never split a paragraph" applied to shrinking: a
// single-paragraph range has no smaller in-bounds answer, so both edges' shrink is a no-op rather than an empty
// range.
func TestAdjustRangeNeverShrinksBelowOneParagraph(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 2)}
	for _, edge := range []Edge{EdgeStart, EdgeEnd} {
		got, ok := AdjustRange(paragraphs, "c1", current, edge, false)
		if !ok {
			t.Fatalf("AdjustRange(%s) reported not ok", edge)
		}
		if !equalStrings(got, current) {
			t.Fatalf("AdjustRange(%s) = %v, want unchanged %v", edge, got, current)
		}
	}
}

// TestAdjustRangeRejectsANonContiguousRange covers a pin whose stored ids no longer form a contiguous run in the
// current text (paragraph_missing stale, or a corrupt store): AdjustRange refuses to guess a new range rather than
// silently producing one that does not correspond to what the narrator actually pinned.
func TestAdjustRangeRejectsANonContiguousRange(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	current := []string{chapterParaID("c1", 1), chapterParaID("c1", 3)} // skips c1c: not contiguous
	if _, ok := AdjustRange(paragraphs, "c1", current, EdgeStart, true); ok {
		t.Fatal("AdjustRange reported ok for a non-contiguous range")
	}
}

func TestAdjustRangeRejectsAnUnknownChapter(t *testing.T) {
	paragraphs := chapterOf("c1", 5)
	if _, ok := AdjustRange(paragraphs, "nope", []string{chapterParaID("c1", 0)}, EdgeStart, true); ok {
		t.Fatal("AdjustRange reported ok for an unknown chapter")
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
