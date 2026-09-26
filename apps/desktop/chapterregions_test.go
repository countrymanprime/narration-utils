package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// chapterRegionsCreditsTrack holds the credits recording in the regions project: one item from 20 s to 25 s.
const chapterRegionsCreditsTrack = "{44444444-4444-4444-8444-444444444444}"

const chapterRegionsCredits = `  <TRACK {44444444-4444-4444-8444-444444444444}
    NAME "Credits"
    TRACKID {44444444-4444-4444-8444-444444444444}
    <ITEM
      POSITION 20
      LENGTH 5
      IGUID {24444444-4444-4444-8444-444444444444}
      GUID {34444444-4444-4444-8444-444444444444}
      <SOURCE WAVE
        FILE "media/ch1.wav"
      >
    >
  >
`

// newTestHostForChapterRegions is chaptermatch_test.go's Alice project plus a credits track. It returns the narration
// chapters' ids and titles.
func newTestHostForChapterRegions(t *testing.T) (*Host, []string, []string) {
	t.Helper()
	host, ids := newTestHostForChapterMatch(t)
	writeRegionsProject(t, host)
	links := decodeLinks(t, host)
	titles := make([]string, 0, len(links.Chapters))
	for _, chapter := range links.Chapters {
		titles = append(titles, chapter.ChapterTitle)
	}
	return host, ids, titles
}

// writeRegionsProject saves the Alice project with the credits track and the given MARKER lines, at a fixed time so
// the golden payloads are stable.
func writeRegionsProject(t *testing.T, host *Host, markers ...string) {
	t.Helper()
	rpp := strings.TrimSuffix(chapterTracksRpp, ">\n") + chapterRegionsCredits
	for _, marker := range markers {
		rpp += "  " + marker + "\n"
	}
	rpp += ">\n"
	path := filepath.Join(host.config.projectFolder, "Alice.rpp")
	if err := os.WriteFile(path, []byte(rpp), 0o600); err != nil {
		t.Fatal(err)
	}
	saved := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	if err := os.Chtimes(path, saved, saved); err != nil {
		t.Fatal(err)
	}
}

func linkChapter(t *testing.T, host *Host, chapterID, trackGUID string) {
	t.Helper()
	if _, err := host.ChapterTrackSet(chapterID, trackGUID); err != nil {
		t.Fatal(err)
	}
}

func previewRegions(t *testing.T, host *Host, opening, closing string) chapterRegionPlan {
	t.Helper()
	raw, err := host.ChapterRegionsPreview(opening, closing)
	if err != nil {
		t.Fatal(err)
	}
	var plan chapterRegionPlan
	if err := json.Unmarshal([]byte(raw), &plan); err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestChapterRegionsPreviewListsTheCreditsFirstAndLastAroundTheLinkedChapters(t *testing.T) {
	host, ids, titles := newTestHostForChapterRegions(t)
	linkChapter(t, host, ids[0], chapterLinksTrack)
	plan := previewRegions(t, host, chapterRegionsCreditsTrack, chapterRegionsCreditsTrack)
	if plan.Project != linksProjectReady || len(plan.Rows) != 3 {
		t.Fatalf("plan = %#v, want a ready project with three rows", plan)
	}
	want := []chapterRegionRow{
		{Kind: "opening", Title: "Opening credits", TrackGUID: chapterRegionsCreditsTrack, TrackName: "Credits", Start: 20, End: 25, State: regionNew},
		{Kind: "chapter", ChapterID: ids[0], Title: titles[0], TrackGUID: chapterLinksTrack, TrackName: "Chapter I", Start: 0, End: 17, State: regionNew},
		{Kind: "closing", Title: "Closing credits", TrackGUID: chapterRegionsCreditsTrack, TrackName: "Credits", Start: 20, End: 25, State: regionNew},
	}
	for i, row := range plan.Rows {
		if row != want[i] {
			t.Fatalf("row %d = %#v, want %#v", i, row, want[i])
		}
	}
}

func TestChapterRegionsPreviewSaysWhyEveryChapterWithoutARegionHasNone(t *testing.T) {
	host, ids, _ := newTestHostForChapterRegions(t)
	linkChapter(t, host, ids[1], chapterLinksTrackII) // a track with no items
	plan := previewRegions(t, host, "", "{DEADBEEF-0000-4000-8000-000000000000}")
	if len(plan.Rows) != 0 {
		t.Fatalf("rows = %#v, want none", plan.Rows)
	}
	reasons := map[string]string{}
	for _, skip := range plan.Skipped {
		reasons[skip.Kind+":"+skip.ChapterID] = skip.Reason
	}
	for key, want := range map[string]string{
		"chapter:" + ids[0]: "No track is linked",
		"chapter:" + ids[1]: "no recorded items",
		"chapter:" + ids[2]: "No track is linked",
		"closing:":          "not in the saved REAPER project",
	} {
		if !strings.Contains(reasons[key], want) {
			t.Fatalf("skip %s = %q, want it to say %q (all: %#v)", key, reasons[key], want, reasons)
		}
	}
	if _, ok := reasons["opening:"]; ok {
		t.Fatal("an opening credits entry with no track chosen was listed as skipped, want it left out")
	}
}

func TestChapterRegionsPreviewSkipsAChapterLinkedToSeveralTracks(t *testing.T) {
	host, ids, _ := newTestHostForChapterRegions(t)
	for _, track := range []string{chapterLinksTrack, chapterLinksTrackII} {
		if _, err := host.ChapterTrackMapConfirm(track, ids[0]); err != nil {
			t.Fatal(err)
		}
	}
	plan := previewRegions(t, host, "", "")
	if len(plan.Rows) != 0 || len(plan.Skipped) != 3 || !strings.Contains(plan.Skipped[0].Reason, "Several tracks") {
		t.Fatalf("plan = %#v, want Chapter I skipped for its two links", plan)
	}
}

func TestChapterRegionsPreviewJudgesEachRowAgainstTheSavedRegions(t *testing.T) {
	host, ids, titles := newTestHostForChapterRegions(t)
	if strings.Contains(titles[0], `"`) {
		t.Fatalf("Chapter I's title %q cannot be written in a MARKER line as is", titles[0])
	}
	// Chapter I's region already matches (within 0.01 s); the one opening credits region starts a second early, so it
	// moves; two regions are both named Closing credits, so that row is ambiguous.
	writeRegionsProject(t, host,
		`MARKER 1 0 "`+titles[0]+`" 1 0 1 R {A1} 0`, `MARKER 1 17.005 "" 1`,
		`MARKER 2 19 "Opening credits" 1 0 1 R {A2} 0`, `MARKER 2 25 "" 1`,
		`MARKER 3 21 "Closing credits" 1 0 1 R {A3} 0`, `MARKER 3 25 "" 1`,
		`MARKER 4 30 "Closing credits" 1 0 1 R {A4} 0`, `MARKER 4 31 "" 1`,
	)
	linkChapter(t, host, ids[0], chapterLinksTrack)
	plan := previewRegions(t, host, chapterRegionsCreditsTrack, chapterRegionsCreditsTrack)
	got := []regionRowState{}
	for _, row := range plan.Rows {
		got = append(got, row.State)
	}
	want := []regionRowState{regionMoves, regionExists, regionAmbiguous}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("states = %v, want %v", got, want)
	}
}

func TestChapterRegionsPreviewReportsAProjectThatIsNotReady(t *testing.T) {
	host, _ := newTestHostForMapping(t)
	plan := previewRegions(t, host, chapterRegionsCreditsTrack, "")
	if plan.Project != linksProjectNone || plan.Message == "" || len(plan.Rows) != 0 || len(plan.Skipped) != 0 {
		t.Fatalf("plan = %#v, want no .rpp reported and nothing planned", plan)
	}
	fake := &fakeRegionCreator{}
	if _, err := createChapterRegions(context.Background(), host.services(), fake, "", "", false); err == nil || err.Error() != plan.Message || fake.calls != 0 {
		t.Fatalf("create err = %v after %d requests, want the preview's message %q and nothing sent", err, fake.calls, plan.Message)
	}
}

type fakeRegionCreator struct {
	calls  int
	rows   []bridge.Region
	colour string
	update bool
	answer bridge.RegionsCreated
	err    error
}

func (f *fakeRegionCreator) CreateRegions(_ context.Context, rows []bridge.Region, colour string, update bool) (bridge.RegionsCreated, error) {
	f.calls++
	f.rows, f.colour, f.update = rows, colour, update
	return f.answer, f.err
}

func TestChapterRegionsCreateSendsThePlanInOneRequestAndReportsREAPERsCounts(t *testing.T) {
	host, ids, titles := newTestHostForChapterRegions(t)
	linkChapter(t, host, ids[0], chapterLinksTrack)
	fake := &fakeRegionCreator{answer: bridge.RegionsCreated{Created: 1, Existing: 1, Updated: 1}}
	result, err := createChapterRegions(context.Background(), host.services(), fake, chapterRegionsCreditsTrack, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if fake.calls != 1 || !fake.update || fake.colour != "" || len(fake.rows) != 2 {
		t.Fatalf("sent %d requests, update %v, colour %q, rows %#v; want one update request with two rows", fake.calls, fake.update, fake.colour, fake.rows)
	}
	if fake.rows[0] != (bridge.Region{Start: 20, End: 25, Title: "Opening credits"}) || fake.rows[1] != (bridge.Region{Start: 0, End: 17, Title: titles[0]}) {
		t.Fatalf("rows = %#v, want the opening credits then Chapter I", fake.rows)
	}
	if result != (chapterRegionsCreated{Sent: 2, Created: 1, Existing: 1, Updated: 1}) {
		t.Fatalf("result = %#v", result)
	}
}

func TestChapterRegionsCreateSendsNothingWhenNoRowIsPlanned(t *testing.T) {
	host, _, _ := newTestHostForChapterRegions(t)
	fake := &fakeRegionCreator{}
	if _, err := createChapterRegions(context.Background(), host.services(), fake, "", "", false); !errors.Is(err, errNoRegionsToCreate) || fake.calls != 0 {
		t.Fatalf("err = %v after %d requests, want errNoRegionsToCreate and none sent", err, fake.calls)
	}
}

func TestChapterRegionsCreateReportsREAPERsRefusal(t *testing.T) {
	host, ids, _ := newTestHostForChapterRegions(t)
	linkChapter(t, host, ids[0], chapterLinksTrack)
	fake := &fakeRegionCreator{err: bridge.ErrExperimentalOff}
	if _, err := createChapterRegions(context.Background(), host.services(), fake, "", "", false); !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatalf("err = %v, want the experimental switch's refusal", err)
	}
	if _, err := createChapterRegions(context.Background(), host.services(), nil, "", "", false); !errors.Is(err, bridge.ErrUnavailable) {
		t.Fatalf("err = %v with no bridge, want ErrUnavailable", err)
	}
}

func TestChapterRegionsCreateBindingIsRefusedWithoutAREAPERSession(t *testing.T) {
	host, ids, _ := newTestHostForChapterRegions(t)
	linkChapter(t, host, ids[0], chapterLinksTrack)
	host.actions = bridge.NewActions(nil, func(string) error { return nil })
	if _, err := host.ChapterRegionsCreate("", "", false); !errors.Is(err, bridge.ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable from a host with no bridge client", err)
	}
}

// The chapter regions' payloads (reaper-automation-follow-through PRD Phase 7, credits-in-chapter-table PRD Phase 4):
// a plan with credits first and last and a skipped chapter, no .rpp, and what a create run answers.
func TestContractChapterRegions(t *testing.T) {
	pin := func(t *testing.T, name, folder string, value any) {
		t.Helper()
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var payload any
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		stable, err := contractfile.PortablePaths(payload, folder, "C:/Projects/Alice")
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, stable)
	}

	noProject, _ := newTestHostForMapping(t)
	pin(t, "chapter-regions-no-project", noProject.config.projectFolder, previewRegions(t, noProject, "", ""))

	host, ids, _ := newTestHostForChapterRegions(t)
	writeRegionsProject(t, host, `MARKER 1 19 "Opening credits" 1 0 1 R {A2} 0`, `MARKER 1 25 "" 1`)
	linkChapter(t, host, ids[0], chapterLinksTrack)
	linkChapter(t, host, ids[1], chapterLinksTrackII)
	pin(t, "chapter-regions-preview", host.config.projectFolder, previewRegions(t, host, chapterRegionsCreditsTrack, chapterRegionsCreditsTrack))

	fake := &fakeRegionCreator{answer: bridge.RegionsCreated{Created: 2, Updated: 1}}
	created, err := createChapterRegions(context.Background(), host.services(), fake, chapterRegionsCreditsTrack, chapterRegionsCreditsTrack, true)
	if err != nil {
		t.Fatal(err)
	}
	pin(t, "chapter-regions-created", host.config.projectFolder, created)
}
