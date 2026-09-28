package main

import "github.com/countrymanprime/narration-utils/shell/internal/prepcompleteness"

// The prep completeness summary (docs/prds/prep-depth.prd.md Phase 7, Could): a per-chapter rollup of open
// pronunciation queries (Phase 3, guide.Service.PronunciationQueries) and unresolved markup staleness (Phase 5,
// prepmarkup.Service.List), read by the Production home's Prep column (stage-navigation-and-page-replacement.prd.md
// D79). It adds no store and no binding beyond this one read; every figure comes from the two phases' own data.

// PrepCompletenessSummary reads every manuscript chapter and answers one row each: how many of its names still have
// an open pronunciation query, and how many of its markup spans are stale, plus the book-wide totals. With no project
// open, or no Story Bible or manuscript yet, it answers an empty summary rather than an error, the same way
// GuidePronunciationQueries and PrepMarkupList already do for a phase this early in prep.
func (h *Host) PrepCompletenessSummary() (string, error) {
	svc := h.services()
	if svc.guide == nil || svc.manuscript == nil {
		return encodeBinding(prepcompleteness.Build(nil, 0), nil)
	}
	chapters, err := svc.manuscript.Chapters()
	if err != nil {
		return "", err
	}
	queries, err := svc.guide.PronunciationQueries()
	if err != nil {
		return "", err
	}
	// PronunciationQuery.Chapter is the chapter's title, not its id (the sidecar's own occurrence shape): a query
	// whose name never occurs carries no title at all, and matching by title is the same provisional, best-effort
	// match manuscript.Service.ChapterIDByTitle's own doc comment describes for a data source outside the manuscript
	// - including its ambiguity: two chapters sharing a title both count every query recorded under it.
	openByTitle := map[string]int{}
	for _, query := range queries {
		if query.Chapter != "" {
			openByTitle[query.Chapter]++
		}
	}
	markup := h.prepMarkup()
	matchedTitles := make(map[string]bool, len(chapters))
	inputs := make([]prepcompleteness.Chapter, 0, len(chapters))
	for _, chapter := range chapters {
		id, _ := chapter["id"].(string)
		title, _ := chapter["title"].(string)
		matchedTitles[title] = true
		list, err := markup.List(id)
		if err != nil {
			return "", err
		}
		stale := 0
		for _, span := range list.Spans {
			if span.Stale {
				stale++
			}
		}
		inputs = append(inputs, prepcompleteness.Chapter{ID: id, Title: title, OpenQueries: openByTitle[title], StaleMarkupSpans: stale})
	}
	// A query's own name never occurring counts here too (its Chapter is already ""), alongside one whose recorded
	// chapter title no longer names a current chapter (renamed or deleted since Phase 3 last read it): neither is
	// silently dropped from the book-wide count, but neither has a chapter row to blame.
	unattributed := 0
	for _, query := range queries {
		if query.Chapter == "" {
			unattributed++
		}
	}
	for title, count := range openByTitle {
		if !matchedTitles[title] {
			unattributed += count
		}
	}
	return encodeBinding(prepcompleteness.Build(inputs, unattributed), nil)
}
