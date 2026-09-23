package findings

import (
	"cmp"
	"fmt"
	"slices"
)

// SortKey orders a List or Page. Each key has one natural order, which
// Descending reverses; a finding with no value for the key (no time range,
// no numeric confidence) sorts last either way, so "unknown" never reads as
// "best" or "worst".
type SortKey string

const (
	// SortChapter orders by chapter id, A to Z. It is the default.
	SortChapter SortKey = "chapter"
	// SortTime orders by time_range.start, earliest first.
	SortTime SortKey = "time"
	// SortConfidence orders by confidence, lowest (least certain) first.
	SortConfidence SortKey = "confidence"
	// SortSeverity orders by severity, most severe (error) first.
	SortSeverity SortKey = "severity"
)

// Query filters, sorts and pages a List or Page call. A zero Query matches
// every finding except ones absent from the latest run, in chapter order,
// unpaged. Filtering and sorting run in Go, not the UI (review-dashboard PRD
// Q9), so the same code serves every analyzer and stays fast on a large
// book. Every filter is optional; an empty one matches everything.
type Query struct {
	Analyzer      string
	Category      Category
	Severity      Severity
	Status        Status
	ChapterID     string
	MinConfidence *float64
	// IncludeNotInLatestRun, when true, also returns findings the latest
	// run did not reproduce (still marked NotInLatestRun).
	IncludeNotInLatestRun bool
	Sort                  SortKey
	Descending            bool
	// Limit caps the page; zero means no limit. Offset skips that many
	// sorted matches first.
	Limit  int
	Offset int
}

// Page is one page of a query's sorted matches and how many matched in all.
// It is a binding result, so its keys are camelCase like the other binding
// envelopes; the findings inside keep the contract's snake_case.
type Page struct {
	Findings []Finding `json:"findings"`
	Total    int       `json:"total"`
}

// Summary is the review queue at a glance: the latest run's findings counted
// by review status, how many earlier findings the latest run did not
// reproduce, and the facets present for the Review page's filters.
type Summary struct {
	Total          int            `json:"total"`
	Unreviewed     int            `json:"unreviewed"`
	Accepted       int            `json:"accepted"`
	Dismissed      int            `json:"dismissed"`
	Deferred       int            `json:"deferred"`
	NotInLatestRun int            `json:"notInLatestRun"`
	Analyzers      []string       `json:"analyzers"`
	Categories     []Category     `json:"categories"`
	Chapters       []ChapterFacet `json:"chapters"`
}

// ChapterFacet is one chapter findings refer to, with a title one of them
// carried (empty when none did).
type ChapterFacet struct {
	ID    string `json:"id"`
	Title string `json:"title,omitempty"`
}

// Validate reports the first field the store cannot answer, so a bad filter
// from the UI fails loudly instead of silently matching nothing.
func (q Query) Validate() error {
	switch {
	case q.Category != "" && !slices.Contains(Categories(), q.Category):
		return fmt.Errorf("category %q is not a documented category", q.Category)
	case q.Severity != "" && severityRank(q.Severity) == len(severityOrder):
		return fmt.Errorf("severity %q is not info, warning, or error", q.Severity)
	case q.Status != "" && !validStatus(q.Status):
		return fmt.Errorf("review status %q is not recognised", q.Status)
	case q.Sort != "" && !slices.Contains([]SortKey{SortChapter, SortTime, SortConfidence, SortSeverity}, q.Sort):
		return fmt.Errorf("sort %q is not chapter, time, confidence, or severity", q.Sort)
	case q.MinConfidence != nil && !(*q.MinConfidence >= 0 && *q.MinConfidence <= 1): // also rejects NaN
		return fmt.Errorf("minimum confidence %v is outside 0 to 1", *q.MinConfidence)
	case q.Limit < 0:
		return fmt.Errorf("limit %d is negative", q.Limit)
	case q.Offset < 0:
		return fmt.Errorf("offset %d is negative", q.Offset)
	}
	return nil
}

// severityOrder is most severe first; severityRank of anything else is
// len(severityOrder), after every known severity.
var severityOrder = []Severity{SeverityError, SeverityWarning, SeverityInfo}

func severityRank(severity Severity) int {
	if index := slices.Index(severityOrder, severity); index >= 0 {
		return index
	}
	return len(severityOrder)
}

func sortFindings(findings []Finding, key SortKey, descending bool) {
	slices.SortStableFunc(findings, func(a, b Finding) int {
		if c := comparePrimary(a, b, key, descending); c != 0 {
			return c
		}
		if c := cmp.Compare(chapterOf(a), chapterOf(b)); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
}

func comparePrimary(a, b Finding, key SortKey, descending bool) int {
	switch key {
	case SortTime:
		return compareOptional(startOf(a), startOf(b), descending)
	case SortConfidence:
		return compareOptional(a.Confidence, b.Confidence, descending)
	case SortSeverity:
		return reverseIf(cmp.Compare(severityRank(a.Severity), severityRank(b.Severity)), descending)
	default:
		return reverseIf(cmp.Compare(chapterOf(a), chapterOf(b)), descending)
	}
}

// compareOptional orders present values (reversed when descending) before
// missing ones, whatever the direction.
func compareOptional(a, b *float64, descending bool) int {
	switch {
	case a == nil && b == nil:
		return 0
	case a == nil:
		return 1
	case b == nil:
		return -1
	}
	return reverseIf(cmp.Compare(*a, *b), descending)
}

func reverseIf(c int, descending bool) int {
	if descending {
		return -c
	}
	return c
}

func startOf(f Finding) *float64 {
	if f.TimeRange == nil {
		return nil
	}
	return &f.TimeRange.Start
}

// pageOf returns sorted[offset:offset+limit], clamped, never nil; a zero
// limit means the rest of the list.
func pageOf(sorted []Finding, offset, limit int) []Finding {
	if offset >= len(sorted) {
		return []Finding{}
	}
	end := len(sorted)
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return sorted[offset:end]
}

func summarize(all []Finding) Summary {
	summary := Summary{Analyzers: []string{}, Categories: []Category{}, Chapters: []ChapterFacet{}}
	chapterTitles := map[string]string{}
	for _, f := range all {
		if !slices.Contains(summary.Analyzers, f.Analyzer) {
			summary.Analyzers = append(summary.Analyzers, f.Analyzer)
		}
		if !slices.Contains(summary.Categories, f.Category) {
			summary.Categories = append(summary.Categories, f.Category)
		}
		if id := chapterOf(f); id != "" {
			if title := f.Manuscript.ChapterTitle; title != "" || chapterTitles[id] == "" {
				chapterTitles[id] = title
			}
		}
		countStatus(&summary, f)
	}
	for id, title := range chapterTitles {
		summary.Chapters = append(summary.Chapters, ChapterFacet{ID: id, Title: title})
	}
	slices.Sort(summary.Analyzers)
	slices.Sort(summary.Categories)
	slices.SortFunc(summary.Chapters, func(a, b ChapterFacet) int { return cmp.Compare(a.ID, b.ID) })
	return summary
}

func countStatus(summary *Summary, f Finding) {
	if f.NotInLatestRun {
		summary.NotInLatestRun++
		return
	}
	summary.Total++
	switch f.Review.Status {
	case StatusUnreviewed:
		summary.Unreviewed++
	case StatusAccepted:
		summary.Accepted++
	case StatusDismissed:
		summary.Dismissed++
	case StatusDeferred:
		summary.Deferred++
	}
}
