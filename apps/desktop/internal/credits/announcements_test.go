package credits

import (
	"reflect"
	"testing"
)

func TestRenderAnnouncementsFillsChapterAndChapterTitlePerChapter(t *testing.T) {
	chapters := []Chapter{
		{ID: "c-0001", Heading: "Chapter 1", Subtitle: "Down the Rabbit-Hole"},
		{ID: "c-0002", Heading: "Chapter 2", Subtitle: "The Pool of Tears"},
	}
	got := RenderAnnouncements("[Chapter]. [Chapter Title].", map[string]string{"Title": "Alice"}, chapters)
	if len(got) != 2 {
		t.Fatalf("got %d announcements, want one per chapter", len(got))
	}
	if got[0].ChapterID != "c-0001" || got[0].Result.Text != "Chapter 1. Down the Rabbit-Hole." {
		t.Fatalf("first = %+v", got[0])
	}
	if got[1].Result.Text != "Chapter 2. The Pool of Tears." || got[1].Result.Words != 6 {
		t.Fatalf("second = %+v", got[1])
	}
}

func TestRenderAnnouncementsDropsAnOptionalChapterTitleWhenTheChapterHasNone(t *testing.T) {
	got := RenderAnnouncements("[Chapter]{: [Chapter Title]}.", nil, []Chapter{{ID: "c-0001", Heading: "Prologue"}})
	if got[0].Result.Text != "Prologue." {
		t.Fatalf("Text = %q, want the optional segment dropped", got[0].Result.Text)
	}
	if len(got[0].Result.Unresolved) != 0 {
		t.Fatalf("Unresolved = %v, want none (the segment was optional)", got[0].Result.Unresolved)
	}
}

func TestRenderAnnouncementsReportsAMissingChapterTitleOutsideASegment(t *testing.T) {
	got := RenderAnnouncements("[Chapter]. [Chapter Title].", nil, []Chapter{{ID: "c-0001", Heading: "Prologue"}})
	if !reflect.DeepEqual(got[0].Result.Unresolved, []string{"Chapter Title"}) {
		t.Fatalf("Unresolved = %v, want [Chapter Title]", got[0].Result.Unresolved)
	}
}

func TestRenderAnnouncementsKeepsProjectTokensAndNeverChangesTheCallersMap(t *testing.T) {
	tokens := map[string]string{"Title": "Alice"}
	got := RenderAnnouncements("[Title], [Chapter].", tokens, []Chapter{{ID: "c-0001", Heading: "Chapter 1"}})
	if got[0].Result.Text != "Alice, Chapter 1." {
		t.Fatalf("Text = %q", got[0].Result.Text)
	}
	if _, leaked := tokens["Chapter"]; leaked {
		t.Fatal("the caller's token map was changed")
	}
}

func TestRenderAnnouncementsForNoChaptersIsAnEmptyListNotNil(t *testing.T) {
	got := RenderAnnouncements("[Chapter].", nil, nil)
	if got == nil || len(got) != 0 {
		t.Fatalf("got %#v, want an empty list", got)
	}
}
