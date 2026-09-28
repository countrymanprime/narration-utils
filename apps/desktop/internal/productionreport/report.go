// Package productionreport builds the Production page's exported status report
// (production tracking PRD Phase 5, delivered and deleted; ADR 0028): one model rendered twice, as JSON for tools and as a
// self-contained HTML page for a reviewer without the app, mirroring internal/deliveryreport's own shape and
// "not a certification" framing.
//
// The output is deterministic apart from GeneratedAt: every map is written in key order and every list keeps the
// order its input already has (the same order the Production page reads). The contracted amount and the effective
// rate, the one financial pair this report can hold, are written only when the narrator opts in
// (Options.IncludeContractedAmount): a status report is often the one thing a narrator shares with someone they
// would not otherwise tell their rate.
package productionreport

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/production"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// SchemaVersion is the version of the JSON report this package writes.
const SchemaVersion = 1

// Dir is the sidecar folder the host writes reports to, relative to the project folder; distinct from
// narration-utils/production's own sessions.json, so an export never touches the time log.
const Dir = "narration-utils/production/reports"

// Options are the narrator's choices for one export.
type Options struct {
	// IncludeContractedAmount writes the contracted amount and the effective rate; off by default.
	IncludeContractedAmount bool
}

// Input is everything one report is built from. Overview is the same production.Overview the Production page reads
// (production.BuildOverview), so the report's figures never drift from what the page just showed. Milestones is the
// plan's own list (production.Plan.Milestones); Overview carries only the deadline, not the milestones.
type Input struct {
	GeneratedAt string
	AppVersion  string
	Options     Options

	Overview   production.Overview
	Milestones []project.Milestone
	// Now is the local time milestones' days-left are counted from; the host passes real time, tests a fixed one.
	Now time.Time
}

// Build turns the input into the report model. It never fails: an undefined figure is written as absent, not guessed at.
func Build(in Input) Report {
	return Report{
		SchemaVersion: SchemaVersion,
		GeneratedAt:   in.GeneratedAt,
		App:           App{Name: "Narration Utils", Version: in.AppVersion},
		Notice:        notice,
		Book:          bookOf(in.Overview),
		Deadline:      deadlineOf(in.Overview),
		Milestones:    milestonesOf(in.Milestones, in.Now),
		Readiness:     readinessOf(in.Overview.Chapters),
		Rate:          rateOf(in.Overview.Totals, in.Options),
		Privacy:       privacyOf(in.Options),
	}
}

// JSON renders the report as indented JSON with a trailing newline.
func (r Report) JSON() ([]byte, error) {
	encoded, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("could not write the report as JSON: %w", err)
	}
	return append(encoded, '\n'), nil
}

func bookOf(overview production.Overview) BookSummary {
	byStage := map[string]float64{}
	for stage, hours := range overview.Totals.HoursByStage {
		byStage[string(stage)] = hours
	}
	return BookSummary{
		Chapters: overview.Totals.Chapters, FinalizedChapters: overview.Totals.FinalizedChapters, WordCount: overview.Totals.WordCount,
		RecordedSeconds: overview.Totals.RecordedSeconds, MeasuredChapters: overview.Totals.MeasuredChapters,
		HoursLogged: overview.Totals.HoursLogged, HoursByStage: byStage, BookPFH: overview.Totals.BookPFH,
	}
}

func deadlineOf(overview production.Overview) *Deadline {
	if overview.Deadline == nil {
		return nil
	}
	return &Deadline{Date: overview.Deadline.Date, DaysLeft: overview.Deadline.DaysLeft}
}

// milestonesOf keeps the plan's own order (the narrator's), and marks each overdue as of now's calendar date.
func milestonesOf(milestones []project.Milestone, now time.Time) []Milestone {
	out := make([]Milestone, 0, len(milestones))
	for _, milestone := range milestones {
		due, err := time.Parse(time.DateOnly, milestone.DueDate)
		days := 0
		if err == nil {
			days = daysBetween(now, due)
		}
		out = append(out, Milestone{Name: milestone.Name, DueDate: milestone.DueDate, Note: milestone.Note, DaysLeft: days, Overdue: err == nil && days < 0})
	}
	return out
}

// daysBetween counts whole calendar days from now's date to due's date: the same number all day, whatever the hour
// (mirrors internal/production/overview.go's own daysBetween).
func daysBetween(now, due time.Time) int {
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	to := time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, time.UTC)
	return int(to.Sub(from).Hours() / 24)
}

func readinessOf(chapters []production.OverviewChapter) Readiness {
	var counts Readiness
	for _, chapter := range chapters {
		if chapter.Readiness == nil {
			counts.None++
			continue
		}
		switch chapter.Readiness.Verdict {
		case "recommended":
			counts.Recommended++
		case "not_ready":
			counts.NotReady++
		case "unknown":
			counts.Unknown++
		case "dismissed":
			counts.Dismissed++
		default:
			counts.None++
		}
	}
	return counts
}

func rateOf(totals production.Totals, options Options) RateInfo {
	if !options.IncludeContractedAmount {
		return RateInfo{Note: "The narrator chose not to include the contracted amount or the effective rate in this report."}
	}
	note := "The effective rate is undefined (no contracted amount set, or no hours logged yet)."
	if totals.EffectiveRate != nil {
		note = "The contracted amount divided by every hour logged on the book."
	}
	return RateInfo{ContractedAmount: totals.ContractedAmount, EffectiveRate: totals.EffectiveRate, Note: note}
}

func privacyOf(options Options) Privacy {
	note := "The contracted amount and effective rate are left out unless the narrator ticks the box to include them."
	if options.IncludeContractedAmount {
		note = "The narrator chose to include the contracted amount and the effective rate."
	}
	return Privacy{ContractedAmountIncluded: options.IncludeContractedAmount, Note: note}
}
