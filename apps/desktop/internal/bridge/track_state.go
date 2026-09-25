package bridge

import (
	"context"
	"fmt"
	"strconv"
)

// TrackState is one read of REAPER's transport and of one track (chapter_track_state, narration_track_state.lua): what
// the resume prompt (read-aloud-resume PRD Phase 4), the Read Aloud control bar (Phase 6) and the teleprompter's input
// detection (teleprompter PRD Phase 11) need. Times are seconds.
type TrackState struct {
	TrackGUID                  string // the track read, or "" when none was asked for
	PlayState                  int    // GetPlayState's bit field: 1 playing, 2 paused, 4 recording
	Playing, Paused, Recording bool
	EditCursor, PlayPosition   float64
	ProjectPath                string // the active project's .rpp, "" when never saved
	Unsaved                    bool
	ChangeCount                int  // GetProjectStateChangeCount: rises on every edit, restarts when the project opens
	TrackArmed                 bool // the named track is armed for recording
	ArmedCount                 int  // tracks armed in the whole project
	RecordInput                *int // the named track's I_RECINPUT as REAPER stores it; nil with no track
	InputDevice                string
	Items                      []TrackItem // the named track's items, at most the bridge's limit
	ItemsTotal                 int         // how many items the track holds, listed or not
}

// TrackItem is one item on the track with its active take ("" TakeGUID and SourceFile when it has none).
type TrackItem struct {
	ItemGUID, TakeGUID                       string
	Position, Length, SourceOffset, PlayRate float64
	SourceFile                               string
}

// TrackStaleError reports a track GUID REAPER could not find; nothing was read for another track.
type TrackStaleError struct{ GUID string }

func (e *TrackStaleError) Error() string {
	return "this chapter's track is no longer in the REAPER project"
}
func (e *TrackStaleError) Is(target error) bool { return target == ErrStale }

// ChapterTrackState reads REAPER's transport and the track trackGUID names (or the transport and the arms only, when
// trackGUID is empty). It changes nothing in REAPER. A track that is gone is a *TrackStaleError.
func (a *Actions) ChapterTrackState(ctx context.Context, trackGUID string) (TrackState, error) {
	events, err := a.request(ctx, "chapter_track_state", []string{"TRACK_STATE_END", "TRACK_STALE"}, trackGUID)
	if err != nil {
		return TrackState{}, err
	}
	var state TrackState
	seen := false
	for _, event := range events {
		switch event.Tag {
		case "TRACK_STALE":
			return TrackState{}, &TrackStaleError{GUID: event.Fields[2]}
		case "TRACK_STATE":
			state, seen = readTrackState(event.Fields), true
		case "TRACK_ITEM":
			state.Items = append(state.Items, readTrackItem(event.Fields))
		case "TRACK_STATE_END":
			state.ItemsTotal = int(numberAt(event.Fields, 3))
		}
	}
	if !seen {
		return TrackState{}, fmt.Errorf("REAPER ended the track state without reading it")
	}
	if state.TrackGUID != normalizeGUID(trackGUID) {
		return TrackState{}, fmt.Errorf("REAPER answered for another track than the one this app asked about")
	}
	return state, nil
}

// readTrackState reads a TRACK_STATE event wire.go has already checked.
func readTrackState(fields []string) TrackState {
	playState := int(numberAt(fields, 3))
	state := TrackState{
		TrackGUID:    fields[2],
		PlayState:    playState,
		Playing:      playState%2 == 1,
		Paused:       playState/2%2 == 1,
		Recording:    playState/4%2 == 1,
		EditCursor:   numberAt(fields, 4),
		PlayPosition: numberAt(fields, 5),
		ProjectPath:  fields[6],
		Unsaved:      fields[7] == "1",
		ChangeCount:  int(numberAt(fields, 8)),
		TrackArmed:   fields[9] == "1",
		ArmedCount:   int(numberAt(fields, 10)),
	}
	if len(fields) > 11 && fields[11] != "" {
		if input, err := strconv.Atoi(fields[11]); err == nil {
			state.RecordInput = &input
		}
	}
	if len(fields) > 12 {
		state.InputDevice = fields[12]
	}
	return state
}

func readTrackItem(fields []string) TrackItem {
	return TrackItem{
		ItemGUID:     fields[2],
		TakeGUID:     fields[3],
		Position:     numberAt(fields, 4),
		Length:       numberAt(fields, 5),
		SourceOffset: numberAt(fields, 6),
		PlayRate:     numberAt(fields, 7),
		SourceFile:   fields[8],
	}
}
