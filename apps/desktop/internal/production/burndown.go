package production

import (
	"sort"
	"time"
)

// This file is Phase 6 of the production tracking PRD (delivered and deleted; ADR 0028) (Could): a time series of the book's logged hours
// over time, data only - no chart rendering here, for a future chart primitive to plot. It reads the same time log
// as everything else in this package (Q2) and adds nothing to it.

// BurndownPoint is one calendar date's running total: every hour logged by the end of that day, added up from every
// earlier day. Only stopped sessions count (mirrors LoggedHours, PRD success metric "Timer honesty"): a running
// timer has logged nothing yet.
type BurndownPoint struct {
	Date        string  `json:"date"`
	HoursLogged float64 `json:"hoursLogged"`
}

// Burndown is the book's logged hours by day, one point for every calendar date from the first stopped session's day
// to the last, inclusive, so a chart can draw a continuous line with no gaps. A day with nothing logged repeats the
// running total. A book with no stopped session yet has no points.
func Burndown(sessions []Session) []BurndownPoint {
	byDay := map[string]float64{}
	for _, session := range sessions {
		if session.Running() {
			continue
		}
		day := session.StartedAt.UTC().Format(time.DateOnly)
		byDay[day] += session.Duration().Hours()
	}
	if len(byDay) == 0 {
		return []BurndownPoint{}
	}
	days := make([]string, 0, len(byDay))
	for day := range byDay {
		days = append(days, day)
	}
	sort.Strings(days)
	first, _ := time.Parse(time.DateOnly, days[0])
	last, _ := time.Parse(time.DateOnly, days[len(days)-1])
	points := []BurndownPoint{}
	running := 0.0
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		key := d.Format(time.DateOnly)
		running += byDay[key]
		points = append(points, BurndownPoint{Date: key, HoursLogged: running})
	}
	return points
}
