package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// fakeTrackStates stands in for bridge.Actions.ChapterTrackState (whose own tests drive a fake REAPER through the file
// protocol, and the Lua harness the command): it records the GUIDs asked about and answers what the test set.
type fakeTrackStates struct {
	asked []string
	state bridge.TrackState
	err   error
}

func (f *fakeTrackStates) ChapterTrackState(_ context.Context, guid string) (bridge.TrackState, error) {
	f.asked = append(f.asked, guid)
	state := f.state
	state.TrackGUID = guid
	return state, f.err
}

const readAloudTrack = "{11111111-1111-4111-8111-111111111111}"

// newReadAloudReaperHost is chaptermatch_test.go's Alice project, connected to REAPER (a live heartbeat), with the first
// chapter linked to its track. It returns the host and the chapters' ids.
func newReadAloudReaperHost(t *testing.T) (*Host, []string) {
	t.Helper()
	host, ids := newTestHostForChapterMatch(t)
	linkChapter(t, host, ids[0], readAloudTrack)
	host.reachability = liveReachability()
	host.navigation = &findingNavigation{navigator: &fakeNavigator{}}
	return host, ids
}

func readState(t *testing.T, host *Host, reader trackStateReader, chapterID string) readAloudReaperState {
	t.Helper()
	state, err := readAloudReaperStateIn(context.Background(), host.services(), reader, chapterID)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestTheChaptersTrackTheOnlyOneArmedIsReady(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	reader := &fakeTrackStates{state: bridge.TrackState{TrackArmed: true, ArmedCount: 1}}

	state := readState(t, host, reader, ids[0])

	if state.Status != readAloudReady || state.TrackGUID != readAloudTrack || state.ArmedCount == nil || *state.ArmedCount != 1 {
		t.Fatalf("state = %+v", state)
	}
	if len(reader.asked) != 1 || reader.asked[0] != readAloudTrack {
		t.Fatalf("asked REAPER about %v, want the linked track", reader.asked)
	}
}

func TestTheArmsDecideTheStatus(t *testing.T) {
	cases := []struct {
		name     string
		state    bridge.TrackState
		want     string
		contains string
	}{
		{"nothing armed", bridge.TrackState{}, readAloudNotArmed, "is not armed"},
		{"another track armed", bridge.TrackState{ArmedCount: 1}, readAloudOtherArmed, "Another track is armed"},
		{"another two armed", bridge.TrackState{ArmedCount: 2}, readAloudSeveralArmed, "2 tracks are armed"},
		{"this and another armed", bridge.TrackState{TrackArmed: true, ArmedCount: 2}, readAloudSeveralArmed, "2 tracks are armed"},
		{"already recording", bridge.TrackState{TrackArmed: true, ArmedCount: 1, Recording: true, PlayState: 5, Playing: true}, readAloudRecordingElsewhere, "already recording"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			host, ids := newReadAloudReaperHost(t)

			state := readState(t, host, &fakeTrackStates{state: c.state}, ids[0])

			if state.Status != c.want || !strings.Contains(state.Message, c.contains) {
				t.Fatalf("state = %+v, want %s saying %q", state, c.want, c.contains)
			}
		})
	}
}

func TestAChapterWithNoLinkNeverAsksREAPER(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	reader := &fakeTrackStates{}

	unlinked := readState(t, host, reader, ids[1])

	if unlinked.Status != readAloudNoLink || unlinked.Reason != readAloudUnlinked || !strings.Contains(unlinked.Message, "Tracks page") {
		t.Fatalf("unlinked = %+v", unlinked)
	}
	if len(reader.asked) != 0 {
		t.Fatalf("asked REAPER about %v for a chapter with no link", reader.asked)
	}
}

func TestATrackGoneFromTheProjectIsNoLink(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)

	state := readState(t, host, &fakeTrackStates{err: &bridge.TrackStaleError{GUID: readAloudTrack}}, ids[0])

	if state.Status != readAloudNoLink || state.Reason != readAloudTrackMissing {
		t.Fatalf("state = %+v", state)
	}
}

func TestWithoutAnAnsweringREAPERTheStateIsUnavailableAndSaysWhy(t *testing.T) {
	cases := []struct {
		name   string
		setup  func(*Host)
		err    error
		reason string
	}{
		{"standalone", func(h *Host) { h.navigation = &findingNavigation{standalone: true} }, nil, reaperStandalone},
		{"heartbeat gone quiet", func(h *Host) { h.reachability = nil }, nil, reaperNotRunning},
		{"no answer", nil, bridge.ErrNoAnswer, reaperNotRunning},
		{"experimental actions off", nil, bridge.ErrExperimentalOff, readAloudExperimentalOff},
		{"anything else", nil, errors.New("disk full"), refusedFailed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			host, ids := newReadAloudReaperHost(t)
			if c.setup != nil {
				c.setup(host)
			}
			reader := &fakeTrackStates{err: c.err}

			state := readState(t, host, reader, ids[0])

			if state.Status != readAloudUnavailable || state.Reason != c.reason || state.Message == "" {
				t.Fatalf("state = %+v, want unavailable/%s", state, c.reason)
			}
			if c.err == nil && len(reader.asked) != 0 {
				t.Fatalf("asked REAPER %v without a heartbeat", reader.asked)
			}
		})
	}
}

func TestANilReaderIsStandalone(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)

	state := readState(t, host, nil, ids[0])

	if state.Status != readAloudUnavailable || state.Reason != reaperStandalone {
		t.Fatalf("state = %+v", state)
	}
}

func TestAChapterTheManuscriptDoesNotHaveIsAnError(t *testing.T) {
	host, _ := newReadAloudReaperHost(t)
	if _, err := readAloudReaperStateIn(context.Background(), host.services(), &fakeTrackStates{}, "no-such-chapter"); err == nil {
		t.Fatal("answered for a chapter the manuscript does not have")
	}
}

func TestReadAloudReaperStateBindingAnswersJSON(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	raw, err := host.ReadAloudReaperState(ids[0])
	if err != nil {
		t.Fatal(err)
	}
	var state readAloudReaperState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		t.Fatal(err)
	}
	if state.Status != readAloudUnavailable || state.Reason != reaperStandalone { // no bridge.Actions on a test host
		t.Fatalf("state = %+v", state)
	}
}

// The binding's answers, pinned for the UI's schema (ADR 0069): one of each status and reason.
func TestContractReadAloudReaperStates(t *testing.T) {
	host, ids := newReadAloudReaperHost(t)
	answers := map[string]readAloudReaperState{}
	for name, reader := range map[string]*fakeTrackStates{
		"ready":               {state: bridge.TrackState{TrackArmed: true, ArmedCount: 1}},
		"not_armed":           {state: bridge.TrackState{}},
		"other_armed":         {state: bridge.TrackState{ArmedCount: 1}},
		"several_armed":       {state: bridge.TrackState{TrackArmed: true, ArmedCount: 3}},
		"recording_elsewhere": {state: bridge.TrackState{ArmedCount: 1, Recording: true, Playing: true, PlayState: 5}},
		"track_missing":       {err: &bridge.TrackStaleError{GUID: readAloudTrack}},
		"experimental_off":    {err: bridge.ErrExperimentalOff},
	} {
		answers[name] = readState(t, host, reader, ids[0])
	}
	answers["no_link"] = readState(t, host, &fakeTrackStates{}, ids[1])
	contractfile.Check(t, "read-aloud-reaper-states", answers)
}
