package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

func reviewFinding(id, analyzer, chapter string, severity findings.Severity, confidence *float64) findings.Finding {
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion, ID: id, Analyzer: analyzer,
		Category: findings.CategoryTranscriptDiscrepancy, Severity: severity,
		Confidence: confidence, ConfidenceReason: "fixture", EvidenceVersion: "v1",
		Manuscript: &findings.Manuscript{ChapterID: chapter, ChapterTitle: "Title of " + chapter},
		Review:     findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}

func confidenceOf(v float64) *float64 { return &v }

// newFindingsHost is a host whose only service is a findings store over a
// temp project holding three findings across two chapters and two analyzers.
func newFindingsHost(t *testing.T) *Host {
	t.Helper()
	folder := t.TempDir()
	store := findings.NewStore(folder)
	if _, err := store.SaveAnalyzerFindings("transcript-compare", "chapter-1", []findings.Finding{
		reviewFinding("aaa", "transcript-compare", "chapter-1", findings.SeverityWarning, confidenceOf(0.9)),
		reviewFinding("bbb", "transcript-compare", "chapter-1", findings.SeverityError, confidenceOf(0.3)),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveAnalyzerFindings("take-review", "chapter-2", []findings.Finding{
		reviewFinding("ccc", "take-review", "chapter-2", findings.SeverityInfo, nil),
	}); err != nil {
		t.Fatal(err)
	}
	host := &Host{findings: store}
	host.config.projectFolder = folder
	return host
}

// bindingAnswer returns a function that takes a binding's two results, so a call reads
// bindingAnswer[findings.Page](t)(host.FindingsList(query)).
func bindingAnswer[T any](t *testing.T) func(string, error) T {
	return func(payload string, err error) T {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var value T
		if err := json.Unmarshal([]byte(payload), &value); err != nil {
			t.Fatalf("binding answer is not the expected JSON: %v\n%s", err, payload)
		}
		return value
	}
}

func pageIDs(page findings.Page) []string {
	result := []string{}
	for _, f := range page.Findings {
		result = append(result, f.ID)
	}
	return result
}

func TestFindingsListFiltersSortsAndPagesInGo(t *testing.T) {
	host := newFindingsHost(t)

	all := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{}))
	if all.Total != 3 || strings.Join(pageIDs(all), ",") != "aaa,bbb,ccc" {
		t.Fatalf("unfiltered = %v (total %d), want every finding in chapter order", pageIDs(all), all.Total)
	}

	filtered := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{Analyzer: "transcript-compare", Sort: "confidence"}))
	if strings.Join(pageIDs(filtered), ",") != "bbb,aaa" {
		t.Fatalf("filtered by analyzer, lowest confidence first = %v, want bbb,aaa", pageIDs(filtered))
	}

	paged := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{Sort: "severity", Limit: 1, Offset: 1}))
	if paged.Total != 3 || strings.Join(pageIDs(paged), ",") != "aaa" {
		t.Fatalf("second page by severity = %v (total %d), want aaa of 3", pageIDs(paged), paged.Total)
	}

	chapter := bindingAnswer[findings.Page](t)(host.FindingsList(FindingsQuery{ChapterID: "chapter-2", MinConfidence: nil, Status: "unreviewed"}))
	if strings.Join(pageIDs(chapter), ",") != "ccc" {
		t.Fatalf("chapter-2 = %v, want ccc", pageIDs(chapter))
	}
}

func TestFindingsListRefusesAFilterTheStoreCannotAnswer(t *testing.T) {
	host := newFindingsHost(t)
	for _, query := range []FindingsQuery{{Sort: "random"}, {Status: "maybe"}, {Category: "vibes"}, {Limit: -1}} {
		if _, err := host.FindingsList(query); err == nil {
			t.Fatalf("FindingsList(%+v) succeeded, want the store's validation error", query)
		}
	}
}

func TestFindingsBindingsNeedAnOpenProject(t *testing.T) {
	host := &Host{}
	calls := map[string]func() (string, error){
		"FindingsList":    func() (string, error) { return host.FindingsList(FindingsQuery{}) },
		"FindingsGet":     func() (string, error) { return host.FindingsGet("aaa") },
		"FindingsReview":  func() (string, error) { return host.FindingsReview("aaa", "v1", "accepted", "") },
		"FindingsSummary": host.FindingsSummary,
	}
	for name, call := range calls {
		if _, err := call(); err == nil || !strings.Contains(err.Error(), "no project is open") {
			t.Errorf("%s err = %v, want a message about no project being open", name, err)
		}
	}
}

func TestFindingsGetReturnsOneFindingOrSaysItIsGone(t *testing.T) {
	host := newFindingsHost(t)
	got := bindingAnswer[findings.Finding](t)(host.FindingsGet("bbb"))
	if got.ID != "bbb" || got.Severity != findings.SeverityError {
		t.Fatalf("FindingsGet(bbb) = %+v", got)
	}
	if _, err := host.FindingsGet("missing"); err == nil || !strings.Contains(err.Error(), "no longer") {
		t.Fatalf("FindingsGet(missing) err = %v, want a message that the finding is gone", err)
	}
}

func TestFindingsReviewRecordsTheDecisionAndReturnsTheUpdatedFinding(t *testing.T) {
	host := newFindingsHost(t)
	before := time.Now().UTC().Add(-time.Second)

	reviewed := bindingAnswer[findings.Finding](t)(host.FindingsReview("aaa", "v1", "dismissed", "room noise, not a misread"))
	if reviewed.Review.Status != findings.StatusDismissed || reviewed.Review.Note != "room noise, not a misread" {
		t.Fatalf("review = %+v, want dismissed with the note", reviewed.Review)
	}
	stamped, err := time.Parse(time.RFC3339, reviewed.Review.Timestamp)
	if err != nil || stamped.Before(before) {
		t.Fatalf("timestamp %q is not a current RFC 3339 time (%v)", reviewed.Review.Timestamp, err)
	}

	// The decision is persisted: a fresh read and the summary both see it.
	again := bindingAnswer[findings.Finding](t)(host.FindingsGet("aaa"))
	if again.Review.Status != findings.StatusDismissed {
		t.Fatalf("persisted status = %q, want dismissed", again.Review.Status)
	}
	summary := bindingAnswer[findings.Summary](t)(host.FindingsSummary())
	if summary.Unreviewed != 2 || summary.Dismissed != 1 {
		t.Fatalf("summary = %+v, want 2 unreviewed and 1 dismissed", summary)
	}

	// Reopening is a decision too.
	reopened := bindingAnswer[findings.Finding](t)(host.FindingsReview("aaa", "v1", "unreviewed", ""))
	if reopened.Review.Status != findings.StatusUnreviewed {
		t.Fatalf("reopened status = %q, want unreviewed", reopened.Review.Status)
	}
}

func TestFindingsReviewRefusesAStaleOrUnknownFindingAndRecordsNothing(t *testing.T) {
	host := newFindingsHost(t)
	cases := []struct {
		name, id, version, status, note, want string
	}{
		{"evidence changed since it was shown", "aaa", "v0", "accepted", "", "changed"},
		{"finding no longer exists", "missing", "v1", "accepted", "", "no longer"},
		{"unknown status", "aaa", "v1", "approved", "", "status"},
		{"empty id", "", "v1", "accepted", "", "no longer"},
		{"note too long", "aaa", "v1", "accepted", strings.Repeat("n", maxReviewNoteRunes+1), "note"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := host.FindingsReview(tc.id, tc.version, tc.status, tc.note); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one mentioning %q", err, tc.want)
			}
		})
	}
	summary := bindingAnswer[findings.Summary](t)(host.FindingsSummary())
	if summary.Unreviewed != 3 {
		t.Fatalf("a refused review changed the store: %+v", summary)
	}
}

func TestFindingsSummaryCountsAndListsFacets(t *testing.T) {
	host := newFindingsHost(t)
	summary := bindingAnswer[findings.Summary](t)(host.FindingsSummary())
	if summary.Total != 3 || summary.Unreviewed != 3 {
		t.Fatalf("counts = %+v", summary)
	}
	if strings.Join(summary.Analyzers, ",") != "take-review,transcript-compare" || len(summary.Chapters) != 2 ||
		summary.Chapters[0] != (findings.ChapterFacet{ID: "chapter-1", Title: "Title of chapter-1"}) {
		t.Fatalf("facets = %+v / %+v", summary.Analyzers, summary.Chapters)
	}
}
