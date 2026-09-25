package chaptersync

import (
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

var book = []chaptermatch.Chapter{
	{ID: "c-0001", Title: "PROLOGUE — The Last Good Applause"},
	{ID: "c-0002", Title: "Chapter 1"},
	{ID: "c-0003", Title: "Chapter 2"},
	{ID: "c-0004", Title: "Chapter 6"},
	{ID: "c-0005", Title: "Chapter 7"},
	{ID: "c-0006", Title: "Epilogue"},
}

func track(guid, name string, items ...tracks.Item) tracks.Track {
	return tracks.Track{GUID: guid, Name: name, Items: items}
}

func item(guid string, position, length float64, source string) tracks.Item {
	return tracks.Item{GUID: guid, Position: position, Length: length, Supported: true, SourceFile: source, Takes: []tracks.Take{{GUID: guid + "-take", SourceFile: source, Supported: true}}}
}

func project(list ...tracks.Track) tracks.Project {
	for i := range list {
		list[i].Index = i
	}
	return tracks.Project{Path: "Book.rpp", Tracks: list}
}

func autoLinked(plan Plan) map[string]string {
	links := map[string]string{}
	for _, link := range plan.AutoLink {
		links[link.TrackGUID] = link.ChapterID
	}
	return links
}

func TestConventionallyNamedTracksLinkOneToOne(t *testing.T) {
	plan := Build(Input{Chapters: book, Project: project(
		track("{P}", "Prologue"),
		track("{1}", "CHAPTER ONE"),
		track("{2}", "Ch. 2"),
		track("{6}", "Chapter VI"),
	)})
	want := map[string]string{"{P}": "c-0001", "{1}": "c-0002", "{2}": "c-0003", "{6}": "c-0004"}
	got := autoLinked(plan)
	if len(got) != len(want) {
		t.Fatalf("AutoLink = %#v, want %#v", plan.AutoLink, want)
	}
	for guid, chapter := range want {
		if got[guid] != chapter {
			t.Fatalf("track %s linked to %q, want %q (plan %#v)", guid, got[guid], chapter, plan.AutoLink)
		}
	}
	for _, link := range plan.AutoLink {
		if link.TrackGUID == "{P}" && link.Match.Kind != evidence.MatchContained {
			t.Fatalf("the prologue's prefix match kind = %q", link.Match.Kind)
		}
		if link.TrackGUID == "{1}" && (link.Match.Kind != evidence.MatchExact || link.Match.Score != chaptermatch.ScoreExact) {
			t.Fatalf("Chapter One's match = %#v", link.Match)
		}
	}
	noTrack := map[string]bool{}
	for _, chapter := range plan.NoTrack {
		noTrack[chapter.ChapterID] = true
	}
	if !noTrack["c-0005"] || !noTrack["c-0006"] || len(noTrack) != 2 {
		t.Fatalf("NoTrack = %#v, want Chapter 7 and the Epilogue", plan.NoTrack)
	}
}

func TestTwoTracksForOneChapterNeedTheNarrator(t *testing.T) {
	plan := Build(Input{Chapters: book, Project: project(track("{a}", "Chapter 6"), track("{b}", "CHAPTER SIX"))})
	if len(plan.AutoLink) != 0 {
		t.Fatalf("AutoLink = %#v, want nothing linked for a tie", plan.AutoLink)
	}
	if len(plan.NeedsYou) != 1 || plan.NeedsYou[0].ChapterID != "c-0004" || plan.NeedsYou[0].Reason != ReasonAmbiguous || plan.NeedsYou[0].Best == nil {
		t.Fatalf("NeedsYou = %#v", plan.NeedsYou)
	}
	if len(plan.NeedsYou[0].Candidates) != 2 {
		t.Fatalf("candidates = %#v", plan.NeedsYou[0].Candidates)
	}
}

func TestAFuzzyMatchIsNeverLinked(t *testing.T) {
	plan := Build(Input{Chapters: book, Project: project(track("{e}", "Epilouge"))})
	if len(plan.AutoLink) != 0 {
		t.Fatalf("AutoLink = %#v", plan.AutoLink)
	}
	if len(plan.NeedsYou) != 1 || plan.NeedsYou[0].Reason != ReasonUncertain || plan.NeedsYou[0].Best.TrackGUID != "{e}" {
		t.Fatalf("NeedsYou = %#v", plan.NeedsYou)
	}
}

func TestARegionOnlyMatchIsOfferedNeverLinked(t *testing.T) {
	p := project(track("{n}", "Narration", item("{i}", 30, 5, "a.wav")))
	p.Regions = []tracks.Region{{Index: 1, Name: "Chapter 2", Start: 28, End: 40}}
	plan := Build(Input{Chapters: book, Project: p})
	if len(plan.AutoLink) != 0 {
		t.Fatalf("AutoLink = %#v", plan.AutoLink)
	}
	if len(plan.NeedsYou) != 1 || plan.NeedsYou[0].ChapterID != "c-0003" || plan.NeedsYou[0].Reason != ReasonRegion {
		t.Fatalf("NeedsYou = %#v", plan.NeedsYou)
	}
}

func TestAPickupTrackIsRecordedButNeverLinked(t *testing.T) {
	plan := Build(Input{Chapters: book, Project: project(track("{6}", "Chapter 6"), track("{6p}", "Chapter 6 (pickups)"))})
	if got := autoLinked(plan); len(got) != 1 || got["{6}"] != "c-0004" {
		t.Fatalf("AutoLink = %#v", plan.AutoLink)
	}
	if len(plan.PickupTracks) != 1 || plan.PickupTracks[0].TrackGUID != "{6p}" || plan.PickupTracks[0].ChapterID != "c-0004" {
		t.Fatalf("PickupTracks = %#v", plan.PickupTracks)
	}
	for _, unmatched := range plan.Unmatched {
		if unmatched.GUID == "{6p}" {
			t.Fatal("the pickup track is listed as unmatched")
		}
	}
}

func TestTracksThatAreNotChaptersAreUnmatchedAndCreditsAreMarked(t *testing.T) {
	plan := Build(Input{Chapters: book, Project: project(track("{r}", "Room tone"), track("{c}", "Opening Credits"), track("{1}", "Chapter 1"))})
	byGUID := map[string]TrackRef{}
	for _, ref := range plan.Unmatched {
		byGUID[ref.GUID] = ref
	}
	if len(byGUID) != 2 || byGUID["{r}"].Name != "Room tone" || byGUID["{c}"].Marker != chaptermatch.MarkerCredits {
		t.Fatalf("Unmatched = %#v", plan.Unmatched)
	}
}

func TestAManualLinkIsKeptAndItsTrackAndChapterAreNotReused(t *testing.T) {
	links := []evidence.TrackMapping{{TrackGUID: "{x}", ChapterID: "c-0002", ChapterTitle: "Chapter 1", Origin: evidence.OriginManual}}
	plan := Build(Input{Chapters: book, Project: project(track("{x}", "Chapter 2"), track("{1}", "Chapter 1")), Links: links})
	for _, link := range plan.AutoLink {
		if link.TrackGUID == "{x}" || link.ChapterID == "c-0002" {
			t.Fatalf("AutoLink touched the manual link: %#v", plan.AutoLink)
		}
	}
	for _, need := range plan.NeedsYou {
		if need.ChapterID == "c-0002" {
			t.Fatalf("a linked chapter needs the narrator: %#v", need)
		}
	}
}

func TestARejectedPairIsNotMadeAgain(t *testing.T) {
	rejected := []evidence.RejectedPair{{TrackGUID: "{1}", ChapterTitle: "Chapter 1"}}
	plan := Build(Input{Chapters: book, Project: project(track("{1}", "Chapter 1")), Rejected: rejected})
	if len(plan.AutoLink) != 0 {
		t.Fatalf("AutoLink = %#v", plan.AutoLink)
	}
	if len(plan.NeedsYou) != 1 || plan.NeedsYou[0].Reason != ReasonRejected || plan.NeedsYou[0].Best.TrackGUID != "{1}" {
		t.Fatalf("NeedsYou = %#v", plan.NeedsYou)
	}
}

func TestAReImportReLinksThePreviousLinksByTitle(t *testing.T) {
	// The narrator had linked a track named "Narration" to Chapter 7; the
	// new manuscript still has "Chapter 7" under a new id, so the old link
	// comes back even though the track's name matches nothing.
	previous := []evidence.TrackMapping{{TrackGUID: "{n}", ChapterID: "c-0099", ChapterTitle: "Chapter 7", Origin: evidence.OriginManual}}
	plan := Build(Input{Chapters: book, Project: project(track("{n}", "Narration"), track("{1}", "Chapter 1")), PreviousLinks: previous})
	got := autoLinked(plan)
	if got["{n}"] != "c-0005" || got["{1}"] != "c-0002" {
		t.Fatalf("AutoLink = %#v", plan.AutoLink)
	}
	for _, link := range plan.AutoLink {
		if link.TrackGUID == "{n}" && link.Match.Kind != evidence.MatchPrevious {
			t.Fatalf("the carried link's kind = %q", link.Match.Kind)
		}
	}
}

func TestAPreviousLinkToAGoneTrackOrARenamedChapterIsDropped(t *testing.T) {
	previous := []evidence.TrackMapping{
		{TrackGUID: "{gone}", ChapterTitle: "Chapter 1"},
		{TrackGUID: "{n}", ChapterTitle: "Chapter 99"},
	}
	plan := Build(Input{Chapters: book, Project: project(track("{n}", "Narration")), PreviousLinks: previous})
	if len(plan.AutoLink) != 0 {
		t.Fatalf("AutoLink = %#v", plan.AutoLink)
	}
}

func TestTheFirstSyncReportsNoNewTracks(t *testing.T) {
	plan := Build(Input{Chapters: book, Project: project(track("{1}", "Chapter 1"))})
	if len(plan.New) != 0 || len(plan.Changed) != 0 || len(plan.Missing) != 0 {
		t.Fatalf("first sync: new %#v changed %#v missing %#v", plan.New, plan.Changed, plan.Missing)
	}
	if len(plan.Snapshot.Tracks) != 1 || plan.Snapshot.Tracks[0].Fingerprint == "" {
		t.Fatalf("Snapshot = %#v", plan.Snapshot)
	}
}

func TestNewChangedRenamedAndMissingTracksSinceTheLastSync(t *testing.T) {
	now := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	before := project(
		track("{1}", "Chapter 1", item("{i1}", 0, 60, "one.wav")),
		track("{2}", "Chapter 2", item("{i2}", 0, 60, "two.wav")),
		track("{3}", "Scratch"),
	)
	first := Build(Input{Chapters: book, Project: before, Now: now.Add(-time.Hour)})

	after := project(
		track("{1}", "Chapter 1", item("{i1}", 0, 60, "one.wav")),
		track("{2}", "Chapter Two", item("{i2}", 0, 60, "two.wav"), item("{i2b}", 60, 10, "two-pickup.wav")),
		track("{7}", "Ch. 7"),
	)
	links := []evidence.TrackMapping{{TrackGUID: "{3}", ChapterID: "c-0006", ChapterTitle: "Epilogue", Origin: evidence.OriginManual}}
	plan := Build(Input{Chapters: book, Project: after, Previous: first.Snapshot, Links: links, Now: now})

	if len(plan.New) != 1 || plan.New[0].GUID != "{7}" {
		t.Fatalf("New = %#v", plan.New)
	}
	if len(plan.Changed) != 1 || plan.Changed[0].GUID != "{2}" {
		t.Fatalf("Changed = %#v", plan.Changed)
	}
	if len(plan.Renamed) != 1 || plan.Renamed[0].GUID != "{2}" || plan.Renamed[0].PreviousName != "Chapter 2" {
		t.Fatalf("Renamed = %#v", plan.Renamed)
	}
	if len(plan.Missing) != 1 || plan.Missing[0].TrackGUID != "{3}" || plan.Missing[0].ChapterID != "c-0006" || plan.Missing[0].Name != "Scratch" {
		t.Fatalf("Missing = %#v", plan.Missing)
	}
	if got := autoLinked(plan); got["{7}"] != "c-0005" {
		t.Fatalf("the new Ch. 7 track was not linked: %#v", plan.AutoLink)
	}
	if !plan.Snapshot.SyncedAt.Equal(now) || len(plan.Snapshot.Tracks) != 3 {
		t.Fatalf("Snapshot = %#v", plan.Snapshot)
	}
}

func TestPlanRequestsFeedTheStore(t *testing.T) {
	plan := Build(Input{Chapters: book, Project: project(track("{1}", "Chapter 1"))})
	requests := plan.Requests()
	if len(requests) != 1 || requests[0].TrackGUID != "{1}" || requests[0].ChapterTitle != "Chapter 1" || requests[0].Match.Kind != evidence.MatchExact {
		t.Fatalf("Requests = %#v", requests)
	}
}

func TestTheSnapshotRemembersWhenEachTrackLastChanged(t *testing.T) {
	first := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
	before := project(track("{1}", "Chapter 1", item("{i}", 0, 60, "one.wav")), track("{2}", "Chapter 2", item("{j}", 0, 60, "two.wav")))
	plan := Build(Input{Chapters: book, Project: before, Now: first})
	for _, state := range plan.Snapshot.Tracks {
		if state.ChangedAt != nil {
			t.Fatalf("a first sync knows no change time, got %v for %s", state.ChangedAt, state.GUID)
		}
	}

	second := first.Add(time.Hour)
	after := project(
		track("{1}", "Chapter 1", item("{i}", 0, 58, "one.wav")),   // trimmed
		track("{2}", "Chapter Two", item("{j}", 0, 60, "two.wav")), // renamed only
		track("{7}", "Chapter 7"),                                  // new
	)
	plan = Build(Input{Chapters: book, Project: after, Previous: plan.Snapshot, Now: second})
	changed := map[string]*time.Time{}
	for _, state := range plan.Snapshot.Tracks {
		changed[state.GUID] = state.ChangedAt
	}
	if changed["{1}"] == nil || !changed["{1}"].Equal(second) {
		t.Fatalf("the trimmed track's change time = %v, want %v", changed["{1}"], second)
	}
	if changed["{2}"] != nil {
		t.Fatalf("a rename is not a change of what the track plays, got %v", changed["{2}"])
	}
	if changed["{7}"] == nil || !changed["{7}"].Equal(second) {
		t.Fatalf("a new track's change time = %v, want %v", changed["{7}"], second)
	}

	third := second.Add(time.Hour)
	plan = Build(Input{Chapters: book, Project: after, Previous: plan.Snapshot, Now: third})
	for _, state := range plan.Snapshot.Tracks {
		if state.GUID == "{1}" && (state.ChangedAt == nil || !state.ChangedAt.Equal(second)) {
			t.Fatalf("an unchanged track keeps its change time, got %v", state.ChangedAt)
		}
	}
}
