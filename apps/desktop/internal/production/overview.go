package production

import (
	"cmp"
	"slices"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// This file is Phase 4 of docs/prds/production-tracking.prd.md: the one read the Production page makes. BuildOverview
// is pure: the host hands it the chapters (status and measured recorded time from the manuscript, readiness from the
// stage recommendations), the time log and the plan, and it only arranges and adds them up. It never writes a chapter
// status and never recomputes a readiness signal (Q8 A): the board shows what the signal owners already said.

// nextUpLimit is how many chapters "Next up" lists.
const nextUpLimit = 5

// Readiness is a chapter's current-stage verdict as the stage recommendations gave it (stages.Assessment): whether
// the stage it is at looks finished (recommended), is held back by something known (not_ready), or cannot be told
// (unknown). Reason is the first held-back or unknown signal's reason, or empty.
type Readiness struct {
	Verdict stages.Verdict `json:"verdict"`
	Target  stages.Stage   `json:"target,omitempty"`
	Reason  string         `json:"reason"`
}

// ChapterInput is one manuscript chapter as the host read it. RecordedSeconds is nil when the chapter's recorded
// length is not measured, with RecordedUnavailable saying why; Readiness is nil for a chapter the stage
// recommendations did not assess.
type ChapterInput struct {
	ID                  string
	Title               string
	Subtitle            string
	ContentKind         string
	Status              stages.Stage
	WordCount           int
	RecordedSeconds     *float64
	RecordedUnavailable string
	Readiness           *Readiness
}

// OverviewInput is everything BuildOverview reads. Plan is the book's deadline and contracted amount as Phase 3 keeps
// them on the project manifest (plan.go): an unset one is nil, and the figures it feeds are undefined. Now is the local
// time the deadline's days are counted from.
type OverviewInput struct {
	Chapters []ChapterInput
	Sessions []Session
	Plan     Plan
	Now      time.Time
}

// OverviewChapter is one row of the Production page's board.
type OverviewChapter struct {
	ID                  string       `json:"id"`
	Title               string       `json:"title"`
	Subtitle            string       `json:"subtitle,omitempty"`
	ContentKind         string       `json:"contentKind"`
	Status              stages.Stage `json:"status"`
	WordCount           int          `json:"wordCount"`
	RecordedSeconds     *float64     `json:"recordedSeconds"`
	RecordedUnavailable string       `json:"recordedUnavailable,omitempty"`
	HoursLogged         float64      `json:"hoursLogged"`
	PFH                 *float64     `json:"pfh"`
	Readiness           *Readiness   `json:"readiness"`
}

// Totals are the book-wide figures of the page's KPI row. A nil figure is undefined: shown as "—", never 0.
type Totals struct {
	Chapters          int                      `json:"chapters"`
	FinalizedChapters int                      `json:"finalizedChapters"`
	WordCount         int                      `json:"wordCount"`
	RecordedSeconds   float64                  `json:"recordedSeconds"`
	MeasuredChapters  int                      `json:"measuredChapters"`
	HoursLogged       float64                  `json:"hoursLogged"`
	HoursByStage      map[stages.Stage]float64 `json:"hoursByStage"`
	BookPFH           *float64                 `json:"bookPfh"`
	ContractedAmount  *float64                 `json:"contractedAmount"`
	EffectiveRate     *float64                 `json:"effectiveRate"`
}

// Deadline is the book's due date and the whole days left until it, negative once it has passed.
type Deadline struct {
	Date     string `json:"date"`
	DaysLeft int    `json:"daysLeft"`
}

// NextUpItem is one chapter "Next up" lists: the stage to work on and why it is listed.
type NextUpItem struct {
	ChapterID string       `json:"chapterId"`
	Title     string       `json:"title"`
	Subtitle  string       `json:"subtitle,omitempty"`
	Stage     stages.Stage `json:"stage"`
	Readiness *Readiness   `json:"readiness"`
}

// Overview is ProductionOverview's answer.
type Overview struct {
	Chapters []OverviewChapter `json:"chapters"`
	Totals   Totals            `json:"totals"`
	Deadline *Deadline         `json:"deadline"`
	Running  *Session          `json:"running"`
	NextUp   []NextUpItem      `json:"nextUp"`
}

// BuildOverview arranges the chapters, the time log and the plan into the Production page's board, KPIs and
// "Next up" list.
func BuildOverview(in OverviewInput) Overview {
	recorded := map[string]float64{}
	overview := Overview{
		Chapters: make([]OverviewChapter, 0, len(in.Chapters)),
		Totals:   Totals{Chapters: len(in.Chapters), HoursByStage: HoursByStage(in.Sessions)},
		NextUp:   []NextUpItem{},
	}
	for _, chapter := range in.Chapters {
		row := OverviewChapter{
			ID:                  chapter.ID,
			Title:               chapter.Title,
			Subtitle:            chapter.Subtitle,
			ContentKind:         chapter.ContentKind,
			Status:              chapter.Status,
			WordCount:           chapter.WordCount,
			RecordedUnavailable: chapter.RecordedUnavailable,
			HoursLogged:         ChapterHours(in.Sessions, chapter.ID),
			Readiness:           chapter.Readiness,
		}
		if chapter.RecordedSeconds != nil && measured(*chapter.RecordedSeconds) {
			value := *chapter.RecordedSeconds
			row.RecordedSeconds = &value
			recorded[chapter.ID] = value
			overview.Totals.RecordedSeconds += value
			overview.Totals.MeasuredChapters++
		}
		row.PFH = optional(ChapterPFH(in.Sessions, recorded, chapter.ID))
		overview.Totals.WordCount += chapter.WordCount
		if chapter.Status == stages.StageFinalized {
			overview.Totals.FinalizedChapters++
		}
		overview.Chapters = append(overview.Chapters, row)
	}
	overview.Totals.HoursLogged = LoggedHours(in.Sessions)
	overview.Totals.BookPFH = optional(BookPFH(in.Sessions, recorded))
	if amount := in.Plan.ContractedAmount; amount != nil && measured(*amount) {
		value := *amount
		overview.Totals.ContractedAmount = &value
	}
	overview.Totals.EffectiveRate = optional(EffectiveRate(in.Plan.ContractedAmount, in.Sessions))
	// The manifest only ever holds a date CheckDate accepted; one that does not parse is shown as no deadline, never
	// guessed at.
	if in.Plan.Deadline != nil {
		if due, err := time.Parse(time.DateOnly, *in.Plan.Deadline); err == nil {
			overview.Deadline = &Deadline{Date: *in.Plan.Deadline, DaysLeft: daysBetween(in.Now, due)}
		}
	}
	if index, ok := runningIn(in.Sessions); ok {
		session := in.Sessions[index].clone()
		overview.Running = &session
	}
	overview.NextUp = nextUp(in.Chapters)
	return overview
}

// nextUp ranks the narration chapters not yet finalized by the risk each puts on the deadline (ADR 0404). The book
// has one deadline and no chapter has its own, so a chapter's risk is how far it is from done and whether something
// is known to hold it back: first the chapters in progress whose stage is held back (not_ready), then the rest in
// progress whose readiness cannot be told, then those in progress that look ready to move on, then the chapters not
// started. Within each, the least advanced stage comes first, then book order.
func nextUp(chapters []ChapterInput) []NextUpItem {
	type ranked struct {
		group, stage, order int
		item                NextUpItem
	}
	var candidates []ranked
	for order, chapter := range chapters {
		// A manuscript imported before structural classification has no kind: every chapter of it is narration, as
		// the manuscript package reads it.
		if (chapter.ContentKind != "" && chapter.ContentKind != "narration") || chapter.Status == stages.StageFinalized {
			continue
		}
		stage, known := stageOrder[chapter.Status]
		if !known {
			continue
		}
		candidates = append(candidates, ranked{
			group: riskGroup(chapter),
			stage: stage,
			order: order,
			item:  NextUpItem{ChapterID: chapter.ID, Title: chapter.Title, Subtitle: chapter.Subtitle, Stage: chapter.Status, Readiness: chapter.Readiness},
		})
	}
	slices.SortStableFunc(candidates, func(a, b ranked) int {
		return cmp.Or(cmp.Compare(a.group, b.group), cmp.Compare(a.stage, b.stage), cmp.Compare(a.order, b.order))
	})
	out := []NextUpItem{}
	for _, candidate := range candidates[:min(len(candidates), nextUpLimit)] {
		out = append(out, candidate.item)
	}
	return out
}

// stageOrder is how far along each stage a chapter can be listed at is.
var stageOrder = map[stages.Stage]int{
	stages.StageNotStarted: 0,
	stages.StageRecording:  1,
	stages.StageEditing:    2,
	stages.StageProofing:   3,
}

func riskGroup(chapter ChapterInput) int {
	if chapter.Status == stages.StageNotStarted {
		return 3
	}
	if chapter.Readiness == nil {
		return 1
	}
	switch chapter.Readiness.Verdict {
	case stages.VerdictNotReady:
		return 0
	case stages.VerdictRecommended:
		return 2
	}
	return 1
}

// daysBetween counts whole calendar days from now's date to due's date: the same number all day, whatever the hour.
func daysBetween(now, due time.Time) int {
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	to := time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, time.UTC)
	return int(to.Sub(from).Hours() / 24)
}

func optional(value float64, ok bool) *float64 {
	if !ok {
		return nil
	}
	return &value
}
