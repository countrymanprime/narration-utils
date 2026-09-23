package findings

import (
	"math"
	"slices"
	"strings"
	"testing"
)

// sortFixture is one finding per shape the sort keys have to handle: a time
// range or none, a numeric confidence or none, each severity, two chapters.
func sortFixture() []Finding {
	withTime := func(f Finding, start float64) Finding {
		f.TimeRange = &TimeRange{Start: start, End: start + 1}
		return f
	}
	withConfidence := func(f Finding, confidence *float64) Finding {
		f.Confidence = confidence
		return f
	}
	withSeverity := func(f Finding, severity Severity) Finding {
		f.Severity = severity
		return f
	}
	return []Finding{
		withSeverity(withConfidence(withTime(testFinding("a", "c-0002", "v1"), 30), floatPtr(0.9)), SeverityInfo),
		withSeverity(withConfidence(withTime(testFinding("b", "c-0001", "v1"), 20), floatPtr(0.4)), SeverityError),
		withSeverity(withConfidence(testFinding("c", "c-0001", "v1"), nil), SeverityWarning),
		withSeverity(withConfidence(withTime(testFinding("d", "c-0002", "v1"), 10), floatPtr(0.6)), SeverityWarning),
	}
}

func saveSortFixture(t *testing.T) *Store {
	t.Helper()
	store := NewStore(t.TempDir())
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "all", sortFixture()); err != nil {
		t.Fatal(err)
	}
	return store
}

func ids(findings []Finding) []string {
	result := make([]string, 0, len(findings))
	for _, f := range findings {
		result = append(result, f.ID)
	}
	return result
}

func TestListSortsByEachKeyWithMissingValuesLast(t *testing.T) {
	store := saveSortFixture(t)
	cases := []struct {
		name  string
		query Query
		want  []string
	}{
		{"default is chapter then id", Query{}, []string{"b", "c", "a", "d"}},
		{"chapter", Query{Sort: SortChapter}, []string{"b", "c", "a", "d"}},
		{"chapter descending", Query{Sort: SortChapter, Descending: true}, []string{"a", "d", "b", "c"}},
		{"time, no time range last", Query{Sort: SortTime}, []string{"d", "b", "a", "c"}},
		{"time descending, no time range still last", Query{Sort: SortTime, Descending: true}, []string{"a", "b", "d", "c"}},
		{"confidence lowest first, no score last", Query{Sort: SortConfidence}, []string{"b", "d", "a", "c"}},
		{"confidence descending, no score still last", Query{Sort: SortConfidence, Descending: true}, []string{"a", "d", "b", "c"}},
		{"severity most severe first, ties by chapter then id", Query{Sort: SortSeverity}, []string{"b", "c", "d", "a"}},
		{"severity descending", Query{Sort: SortSeverity, Descending: true}, []string{"a", "c", "d", "b"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := store.List(tc.query)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(ids(got), tc.want) {
				t.Fatalf("order = %v, want %v", ids(got), tc.want)
			}
		})
	}
}

func TestPageReportsTheTotalBeforePagingAndSlicesTheSortedList(t *testing.T) {
	store := saveSortFixture(t)

	page, err := store.Page(Query{Sort: SortTime, Offset: 1, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 4 {
		t.Fatalf("Total = %d, want 4 (every match, before paging)", page.Total)
	}
	if !slices.Equal(ids(page.Findings), []string{"b", "a"}) {
		t.Fatalf("page = %v, want [b a]", ids(page.Findings))
	}

	past, err := store.Page(Query{Offset: 10})
	if err != nil {
		t.Fatal(err)
	}
	if past.Total != 4 || len(past.Findings) != 0 || past.Findings == nil {
		t.Fatalf("an offset past the end = %+v, want an empty (non-nil) page with the total", past)
	}

	unlimited, err := store.Page(Query{Offset: 3})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(ids(unlimited.Findings), []string{"d"}) {
		t.Fatalf("a zero limit means no limit: got %v", ids(unlimited.Findings))
	}
}

func TestPageOnAFreshProjectIsEmptyNotNil(t *testing.T) {
	page, err := NewStore(t.TempDir()).Page(Query{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Findings == nil || page.Total != 0 {
		t.Fatalf("page = %+v, want an empty list, so the wire carries [] rather than null", page)
	}
}

func TestQueryValidateRejectsWhatTheStoreCannotAnswer(t *testing.T) {
	cases := []struct {
		name  string
		query Query
		want  string
	}{
		{"unknown category", Query{Category: "vibes"}, "category"},
		{"unknown severity", Query{Severity: "fatal"}, "severity"},
		{"unknown status", Query{Status: "maybe"}, "status"},
		{"unknown sort", Query{Sort: "random"}, "sort"},
		{"confidence above one", Query{MinConfidence: floatPtr(1.5)}, "confidence"},
		{"confidence below zero", Query{MinConfidence: floatPtr(-0.1)}, "confidence"},
		{"confidence NaN", Query{MinConfidence: floatPtr(math.NaN())}, "confidence"},
		{"negative limit", Query{Limit: -1}, "limit"},
		{"negative offset", Query{Offset: -1}, "offset"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.query.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Validate() = %v, want an error naming %q", err, tc.want)
			}
			if _, err := NewStore(t.TempDir()).List(tc.query); err == nil {
				t.Fatal("List must refuse a query Validate refuses")
			}
		})
	}

	valid := Query{Analyzer: "anything", ChapterID: "c-0001", Category: CategoryPickup, Severity: SeverityError,
		Status: StatusDeferred, Sort: SortConfidence, MinConfidence: floatPtr(0), Limit: 5, Offset: 2}
	if err := valid.Validate(); err != nil {
		t.Fatalf("a query using every field validly was refused: %v", err)
	}
}

func TestSummaryCountsTheLatestRunByStatusAndListsFacets(t *testing.T) {
	store := NewStore(t.TempDir())
	titled := func(f Finding, title string) Finding {
		f.Manuscript.ChapterTitle = title
		return f
	}
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{
		titled(testFinding("t1", "c-0001", "v1"), "Chapter One"),
		titled(testFinding("t2", "c-0001", "v1"), "Chapter One"),
		titled(testFinding("t3", "c-0001", "v1"), "Chapter One"),
	}); err != nil {
		t.Fatal(err)
	}
	entity := testFinding("g1", "", "v1")
	entity.Analyzer, entity.Category, entity.Manuscript = "story-bible", CategoryEntity, nil
	if _, err := store.SaveAnalyzerFindings("story-bible", "entities", []Finding{entity}); err != nil {
		t.Fatal(err)
	}
	// t3 is no longer reproduced: it leaves the counts but stays a facet.
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{
		titled(testFinding("t1", "c-0001", "v1"), "Chapter One"),
		titled(testFinding("t2", "c-0001", "v1"), "Chapter One"),
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.RecordDecision("t1", "v1", StatusAccepted, "", "2026-09-23T10:00:00Z"); err != nil {
		t.Fatal(err)
	}

	summary, err := store.Summary()
	if err != nil {
		t.Fatal(err)
	}
	want := Summary{
		Total: 3, Unreviewed: 2, Accepted: 1, NotInLatestRun: 1,
		Analyzers:  []string{"story-bible", "transcript_compare"},
		Categories: []Category{CategoryEntity, CategoryTranscriptDiscrepancy},
		Chapters:   []ChapterFacet{{ID: "c-0001", Title: "Chapter One"}},
	}
	if summary.Total != want.Total || summary.Unreviewed != want.Unreviewed || summary.Accepted != want.Accepted ||
		summary.Dismissed != 0 || summary.Deferred != 0 || summary.NotInLatestRun != want.NotInLatestRun {
		t.Fatalf("counts = %+v, want %+v", summary, want)
	}
	if !slices.Equal(summary.Analyzers, want.Analyzers) || !slices.Equal(summary.Categories, want.Categories) ||
		!slices.Equal(summary.Chapters, want.Chapters) {
		t.Fatalf("facets = %+v / %+v / %+v, want %+v", summary.Analyzers, summary.Categories, summary.Chapters, want)
	}
}

func TestSummaryOnAFreshProjectHasEmptyFacetsNotNil(t *testing.T) {
	summary, err := NewStore(t.TempDir()).Summary()
	if err != nil {
		t.Fatal(err)
	}
	if summary.Analyzers == nil || summary.Categories == nil || summary.Chapters == nil || summary.Total != 0 {
		t.Fatalf("summary = %+v, want zero counts and empty (non-nil) facets", summary)
	}
}

func TestSummaryFailsWhenAScopeFileCannotBeRead(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, err := store.SaveAnalyzerFindings("transcript_compare", "c-0001", []Finding{testFinding("f1", "c-0001", "v1")}); err != nil {
		t.Fatal(err)
	}
	path, err := store.scopePath("transcript_compare", "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	denyRead(t, path)
	if _, err := store.Summary(); err == nil {
		t.Fatal("Summary must report a scope file it cannot read, not undercount")
	}
}
