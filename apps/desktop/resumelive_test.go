package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// The live half of the resume locate (read-aloud-resume-from-daw PRD Phase 4, ADR 0349): REAPER's edit cursor on the
// chapter track's recorded audio, or the live end of that audio (RD2), mapped to a place in a source file.

func liveItem(guid string, position, length, offset, rate float64, file string) dawport.TrackItem {
	return dawport.TrackItem{ItemGUID: guid, TakeGUID: guid + "-take", Position: position, Length: length, SourceOffset: offset, PlayRate: rate, SourceFile: file}
}

func mutedItem(item dawport.TrackItem, muted bool) dawport.TrackItem {
	item.Muted = &muted
	return item
}

func TestLiveRecordedEndMapsTheCursorOrTheEndOfTheAudioToTheSource(t *testing.T) {
	folder := t.TempDir()
	a, b := filepath.Join(folder, "a.wav"), filepath.Join(folder, "b.wav")
	for _, file := range []string{a, b} {
		if err := os.WriteFile(file, []byte("RIFF"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// Two items: A plays source 0-10 at project 0-10; B is trimmed (starts 3 s into its file) and 1.5x fast, at 20-30.
	items := []dawport.TrackItem{liveItem("A", 0, 10, 0, 1, a), liveItem("B", 20, 10, 3, 1.5, b)}
	cases := []struct {
		name       string
		cursor     float64
		items      []dawport.TrackItem
		wantItem   string
		wantAt     string
		wantProj   float64
		wantStart  float64
		wantSource float64
	}{
		{"cursor inside the first item", 4, items, "A", liveAtCursor, 4, 0, 4},
		{"cursor inside a trimmed, faster item", 24, items, "B", liveAtCursor, 24, 3, 3 + 4*1.5},
		{"cursor on an item's last instant", 10, items, "A", liveAtCursor, 10, 0, 10},
		{"cursor between items: the end of the audio", 15, items, "B", liveAtEnd, 30, 3, 3 + 10*1.5},
		{"cursor before the first item (parked at 0)", 0, items, "B", liveAtEnd, 30, 3, 3 + 10*1.5},
		{"cursor after the last item", 45, items, "B", liveAtEnd, 30, 3, 3 + 10*1.5},
		{"a muted item is skipped, cursor on it or not", 24, []dawport.TrackItem{items[0], mutedItem(items[1], true)}, "A", liveAtEnd, 10, 0, 10},
		{"an item without a take is skipped", 5, []dawport.TrackItem{{ItemGUID: "E", Position: 0, Length: 10}, items[1]}, "B", liveAtEnd, 30, 3, 3 + 10*1.5},
		{"overlapping items: the one that starts later is on top", 22, []dawport.TrackItem{liveItem("L", 0, 30, 0, 1, a), items[1]}, "B", liveAtCursor, 22, 3, 3 + 2*1.5},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			state := dawport.TrackState{EditCursor: c.cursor, Items: c.items}
			end, at, ok := liveRecordedEnd(state, nil, nil, folder)
			if !ok {
				t.Fatal("no recorded end")
			}
			if end.ItemGUID != c.wantItem || at != c.wantAt || end.ProjectTime != c.wantProj || end.SourceStart != c.wantStart || end.SourceTime != c.wantSource {
				t.Fatalf("got item %s at %s, project %v, source %v-%v; want %s at %s, project %v, source %v-%v",
					end.ItemGUID, at, end.ProjectTime, end.SourceStart, end.SourceTime, c.wantItem, c.wantAt, c.wantProj, c.wantStart, c.wantSource)
			}
			if !end.SourceAvailable || !end.Supported || end.TakeGUID != c.wantItem+"-take" {
				t.Fatalf("end = %+v, want the take's readable source", end)
			}
		})
	}
}

func TestLiveRecordedEndHasNothingWithoutAnAudibleItem(t *testing.T) {
	for name, items := range map[string][]dawport.TrackItem{
		"no items":   nil,
		"all muted":  {mutedItem(liveItem("A", 0, 10, 0, 1, "a.wav"), true)},
		"no sources": {{ItemGUID: "A", Position: 0, Length: 10}},
	} {
		if _, _, ok := liveRecordedEnd(dawport.TrackState{EditCursor: 5, Items: items}, nil, nil, t.TempDir()); ok {
			t.Fatalf("%s: found a recorded end", name)
		}
	}
}

func TestLiveRecordedEndTakesWhatOnlyTheSavedProjectKnows(t *testing.T) {
	folder := t.TempDir()
	saved := &tracks.Track{Items: []tracks.Item{
		// Muted in the saved project, and an older bridge script does not say.
		{GUID: "M", Muted: true, Takes: []tracks.Take{{GUID: "M-take"}}},
		// A trimmed section of a longer file, with stretch markers, stored as MIDI.
		{GUID: "S", Takes: []tracks.Take{{GUID: "S-take", SourceKind: "MIDI", Section: &tracks.SectionOffsets{StartPos: 60}, StretchMarkerCount: 2}}},
	}}
	section := liveItem("S", 0, 10, 1, 1, filepath.Join(folder, "long.wav"))
	state := dawport.TrackState{EditCursor: 5, Items: []dawport.TrackItem{section, liveItem("M", 20, 5, 0, 1, filepath.Join(folder, "m.wav"))}}
	end, at, ok := liveRecordedEnd(state, saved, nil, folder)
	if !ok || end.ItemGUID != "S" || at != liveAtCursor {
		t.Fatalf("end = %+v at %s, want the section item under the cursor (the muted one skipped)", end, at)
	}
	if end.SourceStart != 61 || end.SourceTime != 66 || !end.Approximate || end.Supported || end.SourceAvailable {
		t.Fatalf("end = %+v, want the section start (60 + 1), approximate for its stretch markers, unsupported as saved, and missing", end)
	}
	// Live says unmuted: the live answer wins over the saved project.
	state.EditCursor = 50
	state.Items[1] = mutedItem(state.Items[1], false)
	if end, _, _ := liveRecordedEnd(state, saved, nil, folder); end.ItemGUID != "M" {
		t.Fatalf("end = %+v, want the item REAPER says plays now", end)
	}
}

func TestLiveRecordedEndStaysInsideTheChaptersRegionAndResolvesRelativePaths(t *testing.T) {
	folder := t.TempDir()
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "media", "c2.wav"), []byte("RIFF"), 0o600); err != nil {
		t.Fatal(err)
	}
	state := dawport.TrackState{EditCursor: 100, Items: []dawport.TrackItem{
		liveItem("C2", 0, 50, 0, 1, filepath.Join("media", "c2.wav")),
		liveItem("C3", 60, 50, 0, 1, filepath.Join("media", "c3.wav")),
	}}
	end, at, ok := liveRecordedEnd(state, nil, &tracks.Span{Start: 0, End: 55}, folder)
	if !ok || end.ItemGUID != "C2" || at != liveAtEnd || end.SourceFile != filepath.Join(folder, "media", "c2.wav") || !end.SourceAvailable {
		t.Fatalf("end = %+v at %s, want the end of the region's own item, resolved against the project folder", end, at)
	}
	for _, name := range []string{"notes.txt", "take.mid", "noextension"} {
		state := dawport.TrackState{Items: []dawport.TrackItem{liveItem("X", 0, 5, 0, 1, filepath.Join(folder, name))}}
		if end, _, _ := liveRecordedEnd(state, nil, nil, folder); end.Supported {
			t.Fatalf("%s: supported, want a file the locate cannot decode refused", name)
		}
	}
}

// fakeTrackState is the Track state role: a fixed answer (or error), after an optional delay, recording what it was asked.
type fakeTrackState struct {
	state dawport.TrackState
	err   error
	delay time.Duration
	mu    sync.Mutex
	asked []string
}

func (f *fakeTrackState) ChapterTrackState(ctx context.Context, trackGUID string) (dawport.TrackState, error) {
	f.mu.Lock()
	f.asked = append(f.asked, trackGUID)
	f.mu.Unlock()
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return dawport.TrackState{}, ctx.Err()
		}
	}
	if f.err != nil {
		return dawport.TrackState{}, f.err
	}
	state := f.state
	state.TrackGUID = trackGUID
	return state, nil
}

func (f *fakeTrackState) askedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.asked)
}

func (f *fakeTrackState) askedAt(i int) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.asked[i]
}

const chapterOneTrack = "{11111111-1111-4111-8111-111111111111}"

// liveLocate runs the locate for chapter I with reader as the live source.
func (f locateHost) liveLocate(t *testing.T, reader trackStateReader) map[string]any {
	t.Helper()
	result, err := f.host.teleprompterLocateWith(f.host.services(), reader, f.chapters[0], "", "")
	if err != nil {
		t.Fatal(err)
	}
	return decodeBinding(t, mustEncode(t, result))
}

func mustEncode(t *testing.T, value any) string {
	t.Helper()
	raw, err := encodeBinding(value, nil)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// liveChapterOne is REAPER answering for chapter I's track in the test project: its two saved items, plus a take
// recorded after the last save (media/ch1-new.wav at 20-26 s), with the cursor at cursor.
func (f locateHost) liveChapterOne(t *testing.T, cursor float64) dawport.TrackState {
	t.Helper()
	folder := f.host.config.projectFolder
	newTake := filepath.Join(folder, "media", "ch1-new.wav")
	if err := os.WriteFile(newTake, []byte("RIFF"), 0o600); err != nil {
		t.Fatal(err)
	}
	media := filepath.Join(folder, "media", "ch1.wav")
	return dawport.TrackState{
		ProjectPath: filepath.Join(folder, "Alice.rpp"),
		EditCursor:  cursor,
		Items: []dawport.TrackItem{
			{ItemGUID: "{21111111-1111-4111-8111-111111111111}", TakeGUID: "{31111111-1111-4111-8111-111111111111}", Position: 0, Length: 10, PlayRate: 1, SourceFile: media},
			{ItemGUID: "{22222222-1111-4111-8111-111111111111}", TakeGUID: "{32222222-1111-4111-8111-111111111111}", Position: 12, Length: 5, SourceOffset: 2, PlayRate: 1.5, SourceFile: media},
			{ItemGUID: "{ABABABAB-0000-4000-8000-000000000001}", TakeGUID: "{ABABABAB-0000-4000-8000-000000000002}", Position: 20, Length: 6, PlayRate: 1, SourceFile: newTake},
		},
	}
}

func TestTeleprompterLocatePrefersREAPERsLiveCursorOverTheSavedProject(t *testing.T) {
	f := newTestHostForLocate(t, true)
	reader := &fakeTrackState{state: f.liveChapterOne(t, 5)}

	result := f.liveLocate(t, reader)

	if len(reader.asked) != 1 || reader.asked[0] != chapterOneTrack {
		t.Fatalf("asked %v, want chapter I's track once", reader.asked)
	}
	if result["status"] != "found" || result["dawSource"] != "live" || result["dawAt"] != "cursor" {
		t.Fatalf("result = %v, want a live locate at the cursor", result)
	}
	// The cursor sits 5 s into the first item: the tail is its first 5 s, never the saved project's 2-9.5 s.
	args := strings.Join(f.sidecarArgs(t), " ")
	if !strings.Contains(args, "--wav "+filepath.Join(f.host.config.projectFolder, "media", "ch1.wav")+" --tail-start 0.000 --tail-end 5.000") {
		t.Fatalf("sidecar args %q, want the 5 s before the cursor", args)
	}
	if daw, _ := verdictOf(t, result)["daw"].(map[string]any); daw["source"] != "live" {
		t.Fatalf("verdict daw = %v, want the live source", daw)
	}
}

func TestTeleprompterLocateReadsAnUnsavedTakeAtTheLiveEndOfTheAudio(t *testing.T) {
	f := newTestHostForLocate(t, true)
	result := f.liveLocate(t, &fakeTrackState{state: f.liveChapterOne(t, 0)})

	end, _ := result["recordedEnd"].(map[string]any)
	if result["dawSource"] != "live" || result["dawAt"] != "end" || end["itemGuid"] != "{ABABABAB-0000-4000-8000-000000000001}" || end["projectTime"] != 26.0 {
		t.Fatalf("result = %v, want the end of the take recorded since the last save", result)
	}
	if args := strings.Join(f.sidecarArgs(t), " "); !strings.Contains(args, "ch1-new.wav --tail-start 0.000 --tail-end 6.000") {
		t.Fatalf("sidecar args %q, want the new take's 6 s", args)
	}
}

func TestTeleprompterLocateFallsBackToTheSavedProjectWhenREAPERCannotSay(t *testing.T) {
	cases := []struct {
		name   string
		reader func(f locateHost, t *testing.T) trackStateReader
	}{
		{"unreachable or switched off", func(locateHost, *testing.T) trackStateReader { return nil }},
		{"another project open", func(f locateHost, t *testing.T) trackStateReader {
			state := f.liveChapterOne(t, 5)
			state.ProjectPath = filepath.Join(f.host.config.projectFolder, "Other.rpp")
			return &fakeTrackState{state: state}
		}},
		{"a project never saved", func(f locateHost, t *testing.T) trackStateReader {
			state := f.liveChapterOne(t, 5)
			state.ProjectPath, state.Unsaved = "", true
			return &fakeTrackState{state: state}
		}},
		{"the track is gone", func(locateHost, *testing.T) trackStateReader {
			return &fakeTrackState{err: &bridge.TrackStaleError{GUID: chapterOneTrack}}
		}},
		{"the experimental switch is off", func(locateHost, *testing.T) trackStateReader {
			return &fakeTrackState{err: bridge.ErrExperimentalOff}
		}},
		{"no answer in time", func(f locateHost, t *testing.T) trackStateReader {
			return &fakeTrackState{state: f.liveChapterOne(t, 5), delay: time.Minute}
		}},
		{"any other failure", func(locateHost, *testing.T) trackStateReader { return &fakeTrackState{err: errors.New("boom")} }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newTestHostForLocate(t, true)
			previous := liveTrackStateTimeout
			liveTrackStateTimeout = 50 * time.Millisecond
			t.Cleanup(func() { liveTrackStateTimeout = previous })
			result := f.liveLocate(t, c.reader(f, t))
			if result["status"] != "found" || result["dawSource"] != "saved" || result["dawAt"] != "end" {
				t.Fatalf("result = %v, want the saved project's end", result)
			}
			tail, _ := result["tail"].(map[string]any)
			if tail["from"] != float64(2) || tail["to"] != 9.5 {
				t.Fatalf("tail = %v, want the saved project's 2 to 9.5", tail)
			}
			if daw, _ := verdictOf(t, result)["daw"].(map[string]any); daw["source"] != "saved" {
				t.Fatalf("verdict daw = %v, want the saved source", daw)
			}
		})
	}
}

func TestTeleprompterLocateRunsNothingWhileREAPERRecordsTheChaptersTrack(t *testing.T) {
	f := newTestHostForLocate(t, true)
	f.writeLastReading(t, f.chapters[0], 20)
	state := f.liveChapterOne(t, 5)
	state.Recording, state.Playing, state.TrackArmed = true, true, true

	result := f.liveLocate(t, &fakeTrackState{state: state})

	if result["status"] != "recording" || result["dawSource"] != "live" || result["located"] != nil || result["tail"] != nil {
		t.Fatalf("result = %v, want recording with nothing located", result)
	}
	if args := f.sidecarArgs(t); args != nil {
		t.Fatalf("sidecar ran with %v while the file is still growing", args)
	}
	if verdict := verdictOf(t, result); verdict["kind"] != "none" {
		t.Fatalf("verdict = %v, want nothing offered while REAPER records", verdict)
	}
}

func TestTeleprompterLocateReadsTheChaptersTrackWhileREAPERRecordsAnotherOne(t *testing.T) {
	f := newTestHostForLocate(t, true)
	state := f.liveChapterOne(t, 5)
	state.Recording, state.Playing, state.TrackArmed = true, true, false

	result := f.liveLocate(t, &fakeTrackState{state: state})

	if result["status"] != "found" || result["dawSource"] != "live" {
		t.Fatalf("result = %v, want the chapter's own track read live", result)
	}
}

func TestTeleprompterLocateAsksREAPERNothingForAChapterWithNoTrack(t *testing.T) {
	f := newTestHostForLocate(t, true)
	reader := &fakeTrackState{}
	result, err := f.host.teleprompterLocateWith(f.host.services(), reader, f.chapters[2], "", "")
	if err != nil {
		t.Fatal(err)
	}
	if located, _ := result.(teleprompterLocate); located.Status != "no_track" || len(reader.asked) != 0 || located.DAWSource != "" {
		t.Fatalf("result = %+v, asked %v; want no_track and no question to REAPER", result, reader.asked)
	}
}

func TestContractTeleprompterLocateLive(t *testing.T) {
	f := newTestHostForLocate(t, true)
	folder := f.host.config.projectFolder
	recording := f.liveChapterOne(t, 5)
	recording.Recording, recording.Playing, recording.TrackArmed = true, true, true
	for name, state := range map[string]dawport.TrackState{
		"teleprompter-locate-live":      f.liveChapterOne(t, 5),
		"teleprompter-locate-recording": recording,
	} {
		result, err := f.host.teleprompterLocateWith(f.host.services(), &fakeTrackState{state: state}, f.chapters[0], "", "")
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(mustEncode(t, result)), &payload); err != nil {
			t.Fatal(err)
		}
		stable, err := contractfile.PortablePaths(payload, folder, "C:/Projects/Alice")
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, name, stable)
	}
}
