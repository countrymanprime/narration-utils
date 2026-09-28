package prepcompleteness

import "testing"

func TestBuildWithNoChaptersIsEmpty(t *testing.T) {
	summary := Build(nil, 0)
	if len(summary.Chapters) != 0 {
		t.Fatalf("chapters = %+v, want none", summary.Chapters)
	}
	if summary.Totals != (Totals{}) {
		t.Fatalf("totals = %+v, want zero", summary.Totals)
	}
}

func TestBuildMarksAChapterCompleteOnlyWithNoOpenQueriesAndNoStaleMarkup(t *testing.T) {
	summary := Build([]Chapter{
		{ID: "c1", Title: "Chapter One", OpenQueries: 0, StaleMarkupSpans: 0},
		{ID: "c2", Title: "Chapter Two", OpenQueries: 1, StaleMarkupSpans: 0},
		{ID: "c3", Title: "Chapter Three", OpenQueries: 0, StaleMarkupSpans: 2},
	}, 0)
	want := []bool{true, false, false}
	for index, chapter := range summary.Chapters {
		if chapter.Complete != want[index] {
			t.Fatalf("chapter %d complete = %v, want %v: %+v", index, chapter.Complete, want[index], chapter)
		}
	}
}

func TestBuildKeepsChaptersInTheOrderGiven(t *testing.T) {
	summary := Build([]Chapter{
		{ID: "c2", Title: "Chapter Two"},
		{ID: "c1", Title: "Chapter One"},
	}, 0)
	if summary.Chapters[0].ChapterID != "c2" || summary.Chapters[1].ChapterID != "c1" {
		t.Fatalf("chapters reordered: %+v", summary.Chapters)
	}
}

func TestBuildCountsBookWideTotals(t *testing.T) {
	summary := Build([]Chapter{
		{ID: "c1", Title: "Chapter One", OpenQueries: 2, StaleMarkupSpans: 1},
		{ID: "c2", Title: "Chapter Two", OpenQueries: 0, StaleMarkupSpans: 0},
	}, 0)
	want := Totals{Chapters: 2, CompleteChapters: 1, OpenQueries: 2, StaleMarkupSpans: 1}
	if summary.Totals != want {
		t.Fatalf("totals = %+v, want %+v", summary.Totals, want)
	}
}

// A query whose recorded chapter title matches no current chapter (it never occurs in the text, or the chapter that
// used it was renamed or deleted since) is never silently dropped: it adds to the book-wide open-query total, with no
// chapter row to blame it on.
func TestUnattributedQueriesAddToTotalsButNoChapterRow(t *testing.T) {
	summary := Build([]Chapter{
		{ID: "c1", Title: "Chapter One", OpenQueries: 0, StaleMarkupSpans: 0},
	}, 3)
	if summary.Totals.UnattributedQueries != 3 || summary.Totals.OpenQueries != 3 {
		t.Fatalf("totals = %+v, want 3 unattributed folded into open queries", summary.Totals)
	}
	if !summary.Chapters[0].Complete {
		t.Fatalf("chapter = %+v, want complete (unattributed queries name no chapter)", summary.Chapters[0])
	}
}
