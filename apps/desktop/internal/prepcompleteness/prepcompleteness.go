// Package prepcompleteness is prep-depth.prd.md Phase 7's per-chapter rollup: a chapter's still-open pronunciation
// queries (Phase 3, guide.Service.PronunciationQueries) and its markup spans the manuscript text has since outgrown
// (Phase 5's staleness check, prepmarkup.Service.List). It reads those two phases' own data and adds no store of its
// own, the same way production.BuildOverview only arranges what the host already read: Build is pure and keeps no
// state, so a project switch mid-call never mixes two projects' figures.
package prepcompleteness

// Chapter is one manuscript chapter as the host resolved it: its id and title, how many of its names still have an
// open pronunciation query, and how many of its markup spans are stale. Neither count needs the other: a chapter can
// have queries with no markup yet, or the reverse.
type Chapter struct {
	ID               string
	Title            string
	OpenQueries      int
	StaleMarkupSpans int
}

// ChapterCompleteness is one row of the rollup. Complete is true only when the chapter has neither an open query nor
// a stale markup span left - the "nothing left to figure out on the fly" state prep-depth's own Job to be done names.
type ChapterCompleteness struct {
	ChapterID        string `json:"chapterId"`
	Title            string `json:"title"`
	OpenQueries      int    `json:"openQueries"`
	StaleMarkupSpans int    `json:"staleMarkupSpans"`
	Complete         bool   `json:"complete"`
}

// Totals are the book-wide figures a board's KPI row wants. UnattributedQueries is folded into OpenQueries (nothing
// a narrator asked about is left out of the count), but names no chapter: it is a query whose recorded chapter title
// no longer matches a current chapter (the name never occurs in the text, or the chapter that used it was renamed or
// deleted since Phase 3 last read it).
type Totals struct {
	Chapters            int `json:"chapters"`
	CompleteChapters    int `json:"completeChapters"`
	OpenQueries         int `json:"openQueries"`
	StaleMarkupSpans    int `json:"staleMarkupSpans"`
	UnattributedQueries int `json:"unattributedQueries"`
}

// Summary is Build's answer: one row per manuscript chapter, in the order given (book order), plus the totals.
type Summary struct {
	Chapters []ChapterCompleteness `json:"chapters"`
	Totals   Totals                `json:"totals"`
}

// Build arranges chapters (each already carrying its own resolved counts) and unattributedQueries into the rollup.
func Build(chapters []Chapter, unattributedQueries int) Summary {
	summary := Summary{
		Chapters: make([]ChapterCompleteness, 0, len(chapters)),
		Totals: Totals{
			Chapters:            len(chapters),
			OpenQueries:         unattributedQueries,
			UnattributedQueries: unattributedQueries,
		},
	}
	for _, chapter := range chapters {
		row := ChapterCompleteness{
			ChapterID:        chapter.ID,
			Title:            chapter.Title,
			OpenQueries:      chapter.OpenQueries,
			StaleMarkupSpans: chapter.StaleMarkupSpans,
			Complete:         chapter.OpenQueries == 0 && chapter.StaleMarkupSpans == 0,
		}
		if row.Complete {
			summary.Totals.CompleteChapters++
		}
		summary.Totals.OpenQueries += chapter.OpenQueries
		summary.Totals.StaleMarkupSpans += chapter.StaleMarkupSpans
		summary.Chapters = append(summary.Chapters, row)
	}
	return summary
}
