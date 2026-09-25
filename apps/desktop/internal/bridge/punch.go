package bridge

import (
	"context"
	"errors"
	"fmt"
)

// Punch and roll (teleprompter-manuscript-integration PRD Phase 12, ADR 0246; play_position and punch_to in
// narration_punch.lua). play_position is read-only and is what the host polls during a live reading to anchor words
// in project time; punch_to moves only the edit cursor. Both are experimental (actions.go) until the verification pass
// has confirmed them in a real REAPER, and spike S4 decides which play position anchors a word.

// MaxPreRoll is the longest pre-roll punch_to accepts, in seconds (the Teleprompter.punch_preroll_seconds range).
const MaxPreRoll = 10

var (
	// ErrBadPunch: the word time or the pre-roll is one REAPER would refuse, so nothing was sent.
	ErrBadPunch = errors.New("the word time or pre-roll is not a usable number of seconds")
	// ErrPunchWhileRecording: REAPER is recording, and the cursor was not moved.
	ErrPunchWhileRecording = errors.New("REAPER is recording: stop it before moving to a word")
)

// PlayPosition is one play_position answer: whether REAPER plays or records, the position the narrator hears
// (GetPlayPosition), the position REAPER is processing (GetPlayPosition2, ahead by the output latency), and the edit
// cursor, all in project seconds.
type PlayPosition struct {
	Playing, Paused, Recording bool
	Heard, Processed, Cursor   float64
}

// PlayPosition reads REAPER's transport once. It changes nothing.
func (a *Actions) PlayPosition(ctx context.Context) (PlayPosition, error) {
	events, err := a.request(ctx, "play_position", []string{"PLAY_POSITION"})
	if err != nil {
		return PlayPosition{}, err
	}
	fields := events[len(events)-1].Fields
	state := int(numberAt(fields, 2))
	return PlayPosition{
		Playing: state&1 != 0, Paused: state&2 != 0, Recording: state&4 != 0,
		Heard: numberAt(fields, 3), Processed: numberAt(fields, 4), Cursor: numberAt(fields, 5),
	}, nil
}

// PunchTo moves REAPER's edit cursor to wordTime minus preRoll (never before the project start) and scrolls the view
// there, and answers where the cursor landed. Playback is never started or moved and no undo step is added; REAPER
// refuses while it records (ErrPunchWhileRecording).
func (a *Actions) PunchTo(ctx context.Context, wordTime, preRoll float64) (float64, error) {
	if !finite(wordTime) || !finite(preRoll) || wordTime < 0 || preRoll < 0 || preRoll > MaxPreRoll {
		return 0, fmt.Errorf("%w: %v and %v", ErrBadPunch, wordTime, preRoll)
	}
	events, err := a.request(ctx, "punch_to", []string{"PUNCHED"}, formatSeconds(wordTime), formatSeconds(preRoll))
	if err != nil {
		return 0, err
	}
	return numberAt(events[len(events)-1].Fields, 2), nil
}
