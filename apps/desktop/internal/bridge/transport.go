package bridge

import (
	"context"
	"errors"
	"fmt"
)

// Recording in REAPER for the Read Aloud control bar (arm_only, record_start and record_stop in
// narration_transport.lua; read-aloud-control-bar PRD Phase 7, owner decision D28). All three are experimental
// (actions.go) until the verification pass has confirmed them in a real REAPER.

// The refusals the control bar tells apart, in the script's own words (narration_transport.lua).
var (
	ErrNoTrackArmed         = errors.New("no track is armed in REAPER")
	ErrSeveralTracksArmed   = errors.New("more than one track is armed in REAPER")
	ErrOtherTrackArmed      = errors.New("another track than this chapter's is armed in REAPER")
	ErrPlaying              = errors.New("REAPER is playing: stop it first")
	ErrAlreadyRecording     = errors.New("REAPER is already recording")
	ErrRecordingDidNotStart = errors.New("REAPER did not start recording")
	ErrNotOurRecording      = errors.New("REAPER is not recording anything this app started, so nothing was stopped")
)

var refusals = map[string]error{
	"No track is armed.":                ErrNoTrackArmed,
	"More than one track is armed.":     ErrSeveralTracksArmed,
	"Another track is armed.":           ErrOtherTrackArmed,
	"REAPER is playing. Stop it first.": ErrPlaying,
	"REAPER is already recording.":      ErrAlreadyRecording,
	"REAPER did not start recording.":   ErrRecordingDidNotStart,
}

// Armed is what arm_only did: the track it armed, how many others it disarmed, and whether anything changed.
type Armed struct {
	TrackGUID string
	Disarmed  int
	Changed   bool
}

// RecordStarted is the track REAPER records on and the edit cursor where recording began, in seconds.
type RecordStarted struct {
	TrackGUID string
	Position  float64
}

// RecordStopped says how many track arms were put back to what the narrator had before arm_only, and how many were
// kept because the narrator changed them during the take.
type RecordStopped struct {
	Restored, Kept int
}

// RecordEnded is a recording the app started that stopped without record_stop (the narrator pressed Stop in REAPER).
type RecordEnded struct {
	Restored, Kept int
}

// ArmOnly arms the track trackGUID names and disarms every other one, after REAPER remembers the arms the narrator had;
// they come back when the recording the app starts stops. Refused while REAPER records (ErrRecording); a track that is
// gone is a *TrackStaleError.
func (a *Actions) ArmOnly(ctx context.Context, trackGUID string) (Armed, error) {
	events, err := a.request(ctx, "arm_only", []string{"ARMED", "TRACK_STALE"}, trackGUID)
	if err != nil {
		return Armed{}, err
	}
	event := events[len(events)-1]
	if event.Tag == "TRACK_STALE" {
		return Armed{}, &TrackStaleError{GUID: event.Fields[2]}
	}
	if event.Fields[2] != normalizeGUID(trackGUID) {
		return Armed{}, fmt.Errorf("REAPER armed another track than the one this app asked for")
	}
	return Armed{TrackGUID: event.Fields[2], Disarmed: int(numberAt(event.Fields, 3)), Changed: event.Fields[4] == "1"}, nil
}

// RecordStart asks REAPER to record on trackGUID, which must be the one armed track, while REAPER is stopped. It
// returns once REAPER reports recording. The refusals are ErrNoTrackArmed, ErrSeveralTracksArmed, ErrOtherTrackArmed,
// ErrPlaying, ErrAlreadyRecording and ErrRecordingDidNotStart.
func (a *Actions) RecordStart(ctx context.Context, trackGUID string) (RecordStarted, error) {
	events, err := a.request(ctx, "record_start", []string{"RECORD_STARTED", "TRACK_STALE"}, trackGUID)
	if err != nil {
		return RecordStarted{}, err
	}
	event := events[len(events)-1]
	if event.Tag == "TRACK_STALE" {
		return RecordStarted{}, &TrackStaleError{GUID: event.Fields[2]}
	}
	if event.Fields[2] != normalizeGUID(trackGUID) {
		return RecordStarted{}, fmt.Errorf("REAPER started recording on another track than the one this app asked for")
	}
	a.mu.Lock()
	a.recordingRun = event.RunID
	a.mu.Unlock()
	return RecordStarted{TrackGUID: event.Fields[2], Position: numberAt(event.Fields, 3)}, nil
}

// RecordStop stops the recording the app started and puts the narrator's arms back. A recording the app did not start
// is never stopped: that is ErrNotOurRecording.
func (a *Actions) RecordStop(ctx context.Context) (RecordStopped, error) {
	events, err := a.request(ctx, "record_stop", []string{"RECORD_STOPPED", "RECORD_NOT_OURS"})
	if err != nil {
		return RecordStopped{}, err
	}
	a.mu.Lock()
	a.recordingRun = ""
	a.mu.Unlock()
	event := events[len(events)-1]
	if event.Tag == "RECORD_NOT_OURS" {
		return RecordStopped{}, ErrNotOurRecording
	}
	return RecordStopped{Restored: int(numberAt(event.Fields, 2)), Kept: int(numberAt(event.Fields, 3))}, nil
}

// OnRecordEnded sets the function told when a recording the app started stops without RecordStop. It runs on its own
// goroutine.
func (a *Actions) OnRecordEnded(handler func(RecordEnded)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.onRecordEnded = handler
}
