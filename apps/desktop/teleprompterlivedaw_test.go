package main

import (
	"context"
	"errors"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// savedFixtureProject and savedFixtureCandidate are a minimal saved project with one unmuted item (source seconds 2
// to 9.5, ADR pattern already used by teleprompterlocate_test.go's Alice fixture) for the "no live answer" fallback
// tests below.
func savedFixtureProject() (tracks.Project, chaptermatch.Candidate) {
	track := tracks.Track{GUID: readAloudTrack, Name: "Chapter I", Items: []tracks.Item{{
		Position: 10, Length: 5, GUID: "{item-1}",
		Takes: []tracks.Take{{GUID: "{take-1}", SourceFile: "media/ch1.wav", SourceAvailable: true, Supported: true, SOFFS: 2, PlayRate: 1.5}},
	}}}
	return tracks.Project{Tracks: []tracks.Track{track}}, chaptermatch.Candidate{TrackGUID: readAloudTrack, TrackName: "Chapter I"}
}

func TestRecordedEndForFallsBackToTheSavedProjectWithNoReader(t *testing.T) {
	project, candidate := savedFixtureProject()

	end, live, recording, ok := recordedEndFor(context.Background(), nil, reaperConnected, project, candidate)

	want, wantOK := chaptermatch.RecordedEnd(project, candidate)
	if !ok || !wantOK || live || recording || end != want {
		t.Fatalf("recordedEndFor = %+v, %v, %v, %v; want the saved project's own answer %+v", end, live, recording, ok, want)
	}
}

func TestRecordedEndForFallsBackWhenReaperIsNotConnected(t *testing.T) {
	project, candidate := savedFixtureProject()
	reader := &fakeTrackStates{state: bridge.TrackState{Items: []bridge.TrackItem{{Position: 0, Length: 100, SourceOffset: 0, PlayRate: 1, SourceFile: "live.wav"}}}}

	end, live, _, ok := recordedEndFor(context.Background(), reader, reaperNotRunning, project, candidate)

	want, _ := chaptermatch.RecordedEnd(project, candidate)
	if live || !ok || end != want || len(reader.asked) != 0 {
		t.Fatalf("recordedEndFor = %+v, live=%v, ok=%v, asked=%v; want the saved fallback and no live ask", end, live, ok, reader.asked)
	}
}

func TestRecordedEndForFallsBackForATrackSharedThroughARegion(t *testing.T) {
	project, candidate := savedFixtureProject()
	candidate.Region = &chaptermatch.RegionRef{Start: 0, End: 20}
	reader := &fakeTrackStates{state: bridge.TrackState{Items: []bridge.TrackItem{{Position: 0, Length: 100, SourceOffset: 0, PlayRate: 1, SourceFile: "live.wav"}}}}

	_, live, _, _ := recordedEndFor(context.Background(), reader, reaperConnected, project, candidate)

	if live || len(reader.asked) != 0 {
		t.Fatalf("a region candidate must never ask REAPER live: asked=%v, live=%v", reader.asked, live)
	}
}

func TestRecordedEndForFallsBackOnAReaderRefusal(t *testing.T) {
	project, candidate := savedFixtureProject()
	reader := &fakeTrackStates{err: errors.New("experimental switch is off")}

	end, live, _, ok := recordedEndFor(context.Background(), reader, reaperConnected, project, candidate)

	want, _ := chaptermatch.RecordedEnd(project, candidate)
	if live || !ok || end != want {
		t.Fatalf("recordedEndFor = %+v, live=%v, ok=%v; want the saved fallback on a refusal", end, live, ok)
	}
}

func TestRecordedEndForPrefersTheLiveEditCursorOnTheTrack(t *testing.T) {
	project, candidate := savedFixtureProject()
	reader := &fakeTrackStates{state: bridge.TrackState{EditCursor: 12, Items: []bridge.TrackItem{
		{ItemGUID: "{live-item}", TakeGUID: "{live-take}", Position: 10, Length: 5, SourceOffset: 3, PlayRate: 2, SourceFile: "live.wav"},
	}}}

	end, live, recording, ok := recordedEndFor(context.Background(), reader, reaperConnected, project, candidate)

	// Cursor at project time 12 is 2 s into the item (12 - 10); at PlayRate 2 that is 4 s of source past SourceOffset 3.
	if !ok || !live || recording || end.SourceFile != "live.wav" || end.SourceTime != 7 || end.SourceStart != 3 || end.ProjectTime != 12 {
		t.Fatalf("end = %+v, live=%v, recording=%v, ok=%v", end, live, recording, ok)
	}
	if len(reader.asked) != 1 || reader.asked[0] != readAloudTrack {
		t.Fatalf("asked = %v, want one ask of %s", reader.asked, readAloudTrack)
	}
}

func TestRecordedEndForUsesTheLiveEndWhenTheCursorIsOffTheTracksAudio(t *testing.T) {
	project, candidate := savedFixtureProject()
	reader := &fakeTrackStates{state: bridge.TrackState{EditCursor: 100, Items: []bridge.TrackItem{
		{ItemGUID: "{first}", Position: 0, Length: 4, SourceOffset: 0, PlayRate: 1, SourceFile: "live.wav"},
		{ItemGUID: "{last}", Position: 10, Length: 5, SourceOffset: 1, PlayRate: 1, SourceFile: "live.wav"},
	}}}

	end, live, _, ok := recordedEndFor(context.Background(), reader, reaperConnected, project, candidate)

	// The cursor (100) sits on neither item's played range, so the track's live end wins: the later item, at its own end.
	if !ok || !live || end.ItemGUID != "{last}" || end.ProjectTime != 15 || end.SourceTime != 6 {
		t.Fatalf("end = %+v, live=%v, ok=%v", end, live, ok)
	}
}

func TestRecordedEndForReportsRecordingLiveWithNoSourceToLocate(t *testing.T) {
	project, candidate := savedFixtureProject()
	reader := &fakeTrackStates{state: bridge.TrackState{Recording: true, Items: []bridge.TrackItem{{Position: 0, Length: 5, SourceFile: "live.wav"}}}}

	end, live, recording, ok := recordedEndFor(context.Background(), reader, reaperConnected, project, candidate)

	if !live || !recording || ok || end != (tracks.RecordedEnd{}) {
		t.Fatalf("recordedEndFor while recording = %+v, live=%v, recording=%v, ok=%v", end, live, recording, ok)
	}
}

func TestRecordedEndForFallsBackWhenTheLiveTrackHasNoItems(t *testing.T) {
	project, candidate := savedFixtureProject()
	reader := &fakeTrackStates{state: bridge.TrackState{}}

	end, live, _, ok := recordedEndFor(context.Background(), reader, reaperConnected, project, candidate)

	want, _ := chaptermatch.RecordedEnd(project, candidate)
	if live || !ok || end != want {
		t.Fatalf("recordedEndFor = %+v, live=%v, ok=%v; want the saved fallback with no live items", end, live, ok)
	}
}

func TestRecordedEndAtDefaultsAZeroPlayRateToOne(t *testing.T) {
	end := recordedEndAt(bridge.TrackItem{Position: 0, Length: 4, SourceOffset: 1, SourceFile: "a.wav"}, 3)

	if end.SourceTime != 4 || !end.SourceAvailable || !end.Supported {
		t.Fatalf("end = %+v, want sourceTime 4 (offset 1 + 3 s at rate 1)", end)
	}
}
