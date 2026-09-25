package main

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// This file is the host half of the chapter regions (reaper-automation-follow-through PRD Phase 7, "chapter regions
// from matched tracks") and of the credits regions (credits-in-chapter-table PRD Phase 4, CT8): one plan of REAPER
// regions, read from the saved .rpp and the confirmed chapter-track links, that the narrator previews and then
// approves. Nothing is written to REAPER until ChapterRegionsCreate, and that recomputes the plan itself rather than
// trusting bounds the UI sends back. The one command both PRDs share is create_regions (ADR 0235).

// Credits rows are named like the chapter table's rows (CT8: "own regions named like the row labels"; the labels are
// AudiobookEstimatePanel.tsx's CREDITS_LABEL), so a $region render writes files named the way the table names them.
const (
	openingCreditsRegion = "Opening credits"
	closingCreditsRegion = "Closing credits"
)

// regionRowState says what the plan expects create_regions to do with a row, judged against the regions the saved
// .rpp already holds, in create_regions' own order (a matching region first). REAPER decides for real: the live
// project can differ from its last save. Moves and ambiguous describe an update run; without update, create_regions
// adds a second region with that title for either.
type regionRowState string

const (
	regionNew       regionRowState = "new"       // no region has this title
	regionExists    regionRowState = "exists"    // a region has this title and these bounds, within 0.01 s: left alone
	regionMoves     regionRowState = "moves"     // one region has this title with other bounds: moved only on an update run
	regionAmbiguous regionRowState = "ambiguous" // several regions have this title: left alone
)

// regionBoundsTolerance is create_regions' own duplicate rule (narration_regions.lua, ADR 0235).
const regionBoundsTolerance = 0.01

// chapterRegionRow is one region the plan would ask REAPER for: a credits row ("opening" or "closing") or a narration
// chapter ("chapter"), bounded by its track's first item start and last item end.
type chapterRegionRow struct {
	Kind      string         `json:"kind"`
	ChapterID string         `json:"chapterId"`
	Title     string         `json:"title"`
	TrackGUID string         `json:"trackGuid"`
	TrackName string         `json:"trackName"`
	Start     float64        `json:"start"`
	End       float64        `json:"end"`
	State     regionRowState `json:"state"`
}

// chapterRegionSkip is a chapter or a credits entry that gets no region, and why, so the preview never drops one
// silently.
type chapterRegionSkip struct {
	Kind      string `json:"kind"`
	ChapterID string `json:"chapterId"`
	Title     string `json:"title"`
	Reason    string `json:"reason"`
}

// chapterRegionPlan is ChapterRegionsPreview's payload. Rows run opening credits, the chapters in book order, then
// closing credits. When Project is not ready, Message says why and Rows is empty.
type chapterRegionPlan struct {
	Project     linksProjectState   `json:"project"`
	Message     string              `json:"message"`
	ProjectFile string              `json:"projectFile"`
	SavedAt     string              `json:"savedAt"`
	Rows        []chapterRegionRow  `json:"rows"`
	Skipped     []chapterRegionSkip `json:"skipped"`
}

// chapterRegionsCreated is ChapterRegionsCreate's payload: how many rows it sent and what REAPER answered.
type chapterRegionsCreated struct {
	Sent      int `json:"sent"`
	Created   int `json:"created"`
	Existing  int `json:"existing"`
	Invalid   int `json:"invalid"`
	Updated   int `json:"updated"`
	Ambiguous int `json:"ambiguous"`
	Failed    int `json:"failed"`
}

// regionCreator is the one bridge.Actions method the create step needs; a seam for tests.
type regionCreator interface {
	CreateRegions(ctx context.Context, rows []bridge.Region, colour string, update bool) (bridge.RegionsCreated, error)
}

// errNoRegionsToCreate: the plan holds no row, so nothing was sent.
var errNoRegionsToCreate = errors.New("no chapter or credits entry has a linked track with recorded items, so there are no regions to create")

// chapterRegionPlanIn builds the plan from one services snapshot: every narration chapter's confirmed link (the
// chapter track link control's store, never an unconfirmed suggestion) and the credits tracks the narrator picked.
// An empty credits GUID leaves that credits row out without a skip; a GUID the project does not have is a skip.
func chapterRegionPlanIn(svc hostServices, openingTrackGUID, closingTrackGUID string) (chapterRegionPlan, error) {
	links, err := chapterTrackLinksIn(svc)
	if err != nil {
		return chapterRegionPlan{}, err
	}
	plan := chapterRegionPlan{
		Project: links.Project, Message: links.Message, ProjectFile: links.ProjectFile, SavedAt: links.SavedAt,
		Rows: []chapterRegionRow{}, Skipped: []chapterRegionSkip{},
	}
	if links.Project != linksProjectReady {
		return plan, nil
	}
	// chapterTrackLinks leaves the saved regions off its wire payload, so read them from the same file again.
	project, state, message := readLinksProject(svc)
	if state != linksProjectReady {
		plan.Project, plan.Message = state, message
		return plan, nil
	}
	summaries := make(map[string]trackSummary, len(links.Tracks))
	for _, track := range links.Tracks {
		summaries[track.GUID] = track
	}
	add := func(kind, chapterID, title, trackGUID string) {
		row, reason := planRegionRow(kind, chapterID, title, trackGUID, summaries, project.Regions)
		if reason != "" {
			plan.Skipped = append(plan.Skipped, chapterRegionSkip{Kind: kind, ChapterID: chapterID, Title: title, Reason: reason})
			return
		}
		plan.Rows = append(plan.Rows, row)
	}
	if openingTrackGUID != "" {
		add("opening", "", openingCreditsRegion, openingTrackGUID)
	}
	for _, chapter := range links.Chapters {
		switch len(chapter.Links) {
		case 0:
			plan.Skipped = append(plan.Skipped, chapterRegionSkip{Kind: "chapter", ChapterID: chapter.ChapterID, Title: chapter.ChapterTitle, Reason: "No track is linked to this chapter."})
		case 1:
			add("chapter", chapter.ChapterID, chapter.ChapterTitle, chapter.Links[0].TrackGUID)
		default:
			plan.Skipped = append(plan.Skipped, chapterRegionSkip{Kind: "chapter", ChapterID: chapter.ChapterID, Title: chapter.ChapterTitle, Reason: "Several tracks are linked to this chapter; link one."})
		}
	}
	if closingTrackGUID != "" {
		add("closing", "", closingCreditsRegion, closingTrackGUID)
	}
	return plan, nil
}

// planRegionRow bounds one row by its track's span and judges it against the saved regions, or says why it has none.
func planRegionRow(kind, chapterID, title, trackGUID string, summaries map[string]trackSummary, regions []tracks.Region) (chapterRegionRow, string) {
	track, ok := summaries[trackGUID]
	switch {
	case !ok:
		return chapterRegionRow{}, "The linked track is not in the saved REAPER project."
	case track.Span == nil || track.Span.End <= track.Span.Start:
		return chapterRegionRow{}, "The linked track has no recorded items."
	}
	row := chapterRegionRow{
		Kind: kind, ChapterID: chapterID, Title: title, TrackGUID: track.GUID, TrackName: track.Name,
		Start: track.Span.Start, End: track.Span.End, State: regionNew,
	}
	same := 0
	for _, region := range regions {
		if region.Name != title {
			continue
		}
		same++
		if math.Abs(region.Start-row.Start) <= regionBoundsTolerance && math.Abs(region.End-row.End) <= regionBoundsTolerance {
			row.State = regionExists
		}
	}
	switch {
	case row.State == regionExists:
	case same == 1:
		row.State = regionMoves
	case same > 1:
		row.State = regionAmbiguous
	}
	return row, ""
}

// createChapterRegions recomputes the plan and sends every row in one create_regions request (one undo step in
// REAPER). With update, a region whose title one region already holds with other bounds is moved rather than doubled.
func createChapterRegions(ctx context.Context, svc hostServices, creator regionCreator, openingTrackGUID, closingTrackGUID string, update bool) (chapterRegionsCreated, error) {
	plan, err := chapterRegionPlanIn(svc, openingTrackGUID, closingTrackGUID)
	if err != nil {
		return chapterRegionsCreated{}, err
	}
	if plan.Project != linksProjectReady {
		return chapterRegionsCreated{}, errors.New(plan.Message)
	}
	if len(plan.Rows) == 0 {
		return chapterRegionsCreated{}, errNoRegionsToCreate
	}
	if creator == nil {
		return chapterRegionsCreated{}, bridge.ErrUnavailable
	}
	rows := make([]bridge.Region, 0, len(plan.Rows))
	for _, row := range plan.Rows {
		rows = append(rows, bridge.Region{Start: row.Start, End: row.End, Title: row.Title})
	}
	answer, err := creator.CreateRegions(ctx, rows, "", update)
	if err != nil {
		return chapterRegionsCreated{}, fmt.Errorf("could not create the regions in REAPER: %w", err)
	}
	return chapterRegionsCreated{
		Sent: len(rows), Created: answer.Created, Existing: answer.Existing, Invalid: answer.Invalid,
		Updated: answer.Updated, Ambiguous: answer.Ambiguous, Failed: answer.Failed,
	}, nil
}
