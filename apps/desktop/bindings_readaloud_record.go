package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// Record in REAPER (read-aloud-control-bar.prd.md Phase 7, booth-actions-enablement.prd.md Phase 2): arming a
// chapter's linked track, and starting and stopping a REAPER recording alongside a reading session. The Lua and
// bridge half (arm_only, record_start, record_stop in narration_transport.lua and bridge.Actions, DAW port PRD
// Phase 7's Recorder role) is already built and harness-tested; this file is the remaining caller. Every command is
// sent only from a click (or the Space shortcut on Play, ReadingControlBar.tsx), with the track GUID taken from the
// chapter-track mapping the same way ReadAloudReaperState reads it, never from the UI (threat-model row 5j).

// readAloudRecordStartTimeout bounds how long RecordStart waits for REAPER to report recording (read-aloud-control-
// bar.prd.md Phase 7): on a timeout nothing starts listening and the bar says why, the same as any other refusal.
const readAloudRecordStartTimeout = 3 * time.Second

// ReadAloudRecording is what an arm, a record start or a record stop did, in the shape the control bar reads. Outcome
// is "armed", "started", "stopped" or "refused" (Reason and Message say why; nothing in REAPER changed for a refusal).
type ReadAloudRecording struct {
	Outcome   string   `json:"outcome"`
	Reason    string   `json:"reason,omitempty"`
	Message   string   `json:"message,omitempty"`
	TrackGUID string   `json:"trackGuid,omitempty"`
	Disarmed  *int     `json:"disarmed,omitempty"`
	Changed   *bool    `json:"changed,omitempty"`
	Position  *float64 `json:"position,omitempty"`
	Restored  *int     `json:"restored,omitempty"`
	Kept      *int     `json:"kept,omitempty"`
}

func readAloudRefused(reason, message string) ReadAloudRecording {
	return ReadAloudRecording{Outcome: "refused", Reason: reason, Message: message}
}

// recorderFrom asks svc's DAW port resolver for the Record role (DAW port PRD P5a, ADR 0300), the same seam
// trackStateReaderFrom uses: nil when there is no resolver, no adapter, the capability is toggled off, or REAPER is
// not reachable right now.
func recorderFrom(svc hostServices) dawport.Recorder {
	if svc.dawPortResolver == nil {
		return nil
	}
	recorder, err := dawport.Role[dawport.Recorder](svc.dawPortResolver, dawport.CapRecord)
	if err != nil {
		return nil
	}
	return recorder
}

// readAloudTrackGUID is chapterID's one linked track, or a refusal in the control bar's own words for no link or
// several links - the same cases and wording readAloudReaperStateIn turns into no_link. A chapter the manuscript does
// not have is still a hard error, not a refusal.
func readAloudTrackGUID(svc hostServices, chapterID string) (string, *ReadAloudRecording, error) {
	title, links, err := chapterLinksFor(svc, chapterID)
	if err != nil {
		return "", nil, err
	}
	switch {
	case len(links) == 0:
		refused := readAloudRefused(readAloudUnlinked, fmt.Sprintf("%q has no linked track. Link it to its REAPER track on the Tracks page.", title))
		return "", &refused, nil
	case len(links) > 1:
		refused := readAloudRefused(readAloudSeveralLinks, fmt.Sprintf("%q is linked to %d tracks. Keep the one to record on, on the Tracks page.", title, len(links)))
		return "", &refused, nil
	}
	return links[0], nil, nil
}

// readAloudRecordRefusal turns what ArmOnly, RecordStart or RecordStop answered into the reason and words the bar
// shows, mirroring readAloudRefusal's REAPER-connection cases.
func readAloudRecordRefusal(err error) ReadAloudRecording {
	var stale *bridge.TrackStaleError
	switch {
	case errors.As(err, &stale):
		return readAloudRefused(readAloudTrackMissing, "The track linked to this chapter is no longer in the REAPER project. Link it again on the Tracks page.")
	case errors.Is(err, context.DeadlineExceeded):
		return readAloudRefused("timeout", "REAPER did not confirm within 3 seconds. Nothing started.")
	case errors.Is(err, bridge.ErrNoTrackArmed):
		return readAloudRefused("not_armed", capitalized(err.Error())+".")
	case errors.Is(err, bridge.ErrSeveralTracksArmed):
		return readAloudRefused("several_armed", capitalized(err.Error())+".")
	case errors.Is(err, bridge.ErrOtherTrackArmed):
		return readAloudRefused("other_armed", capitalized(err.Error())+".")
	case errors.Is(err, bridge.ErrPlaying):
		return readAloudRefused("playing", capitalized(err.Error())+".")
	case errors.Is(err, bridge.ErrAlreadyRecording):
		return readAloudRefused("already_recording", capitalized(err.Error())+".")
	case errors.Is(err, bridge.ErrRecordingDidNotStart):
		return readAloudRefused("did_not_start", capitalized(err.Error())+".")
	case errors.Is(err, bridge.ErrNotOurRecording):
		return readAloudRefused("not_our_recording", capitalized(err.Error())+".")
	case errors.Is(err, bridge.ErrNoAnswer):
		return readAloudRefused(reaperNotRunning, messageNotRunning)
	case errors.Is(err, bridge.ErrUnavailable):
		return readAloudRefused(reaperStandalone, messageReaperOff)
	}
	return readAloudRefused(refusedFailed, "REAPER could not do that: "+err.Error()+".")
}

// readAloudArmOnlyIn arms chapterID's linked track and disarms every other one (Q7 A's "Arm Chapter N only"),
// refusing while REAPER records. It changes nothing in the reading session. recorder is nil exactly when
// recorderFrom would answer nil (no resolver, the capability off, or REAPER not reachable).
func readAloudArmOnlyIn(ctx context.Context, svc hostServices, recorder dawport.Recorder, chapterID string) (ReadAloudRecording, error) {
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return readAloudRefused(status.Connection, readAloudConnectionMessage(status.Connection)), nil
	}
	if recorder == nil {
		return readAloudRefused(readAloudExperimentalOff, messageExperimentalOff), nil
	}
	guid, refused, err := readAloudTrackGUID(svc, chapterID)
	if err != nil {
		return ReadAloudRecording{}, err
	}
	if refused != nil {
		return *refused, nil
	}
	armed, err := recorder.ArmOnly(ctx, guid)
	if err != nil {
		return readAloudRecordRefusal(err), nil
	}
	disarmed, changed := armed.Disarmed, armed.Changed
	return ReadAloudRecording{Outcome: "armed", TrackGUID: armed.TrackGUID, Disarmed: &disarmed, Changed: &changed}, nil
}

func (h *Host) ReadAloudArmOnly(chapterID string) (string, error) {
	svc := h.services()
	return encodeBinding(readAloudArmOnlyIn(context.Background(), svc, recorderFrom(svc), chapterID))
}

// readAloudRecordStartIn asks REAPER to record on chapterID's linked track, which must already be the one armed
// track (arm it first with ArmOnly), and waits for ctx's deadline for REAPER to confirm. Sent only from Play with the
// Record in REAPER toggle on (ReadingControlBar.tsx); TeleprompterStart follows only once this answers "started".
func readAloudRecordStartIn(ctx context.Context, svc hostServices, recorder dawport.Recorder, chapterID string) (ReadAloudRecording, error) {
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return readAloudRefused(status.Connection, readAloudConnectionMessage(status.Connection)), nil
	}
	if recorder == nil {
		return readAloudRefused(readAloudExperimentalOff, messageExperimentalOff), nil
	}
	guid, refused, err := readAloudTrackGUID(svc, chapterID)
	if err != nil {
		return ReadAloudRecording{}, err
	}
	if refused != nil {
		return *refused, nil
	}
	started, err := recorder.RecordStart(ctx, guid)
	if err != nil {
		return readAloudRecordRefusal(err), nil
	}
	position := started.Position
	return ReadAloudRecording{Outcome: "started", TrackGUID: started.TrackGUID, Position: &position}, nil
}

func (h *Host) ReadAloudRecordStart(chapterID string) (string, error) {
	svc := h.services()
	recorder := recorderFrom(svc)
	ctx, cancel := context.WithTimeout(context.Background(), readAloudRecordStartTimeout)
	defer cancel()
	result, err := readAloudRecordStartIn(ctx, svc, recorder, chapterID)
	if err == nil && result.Outcome == "started" {
		h.setReadAloudRecording(chapterID, recorder)
	}
	return encodeBinding(result, err)
}

// readAloudRecordStopIn stops the recording this app started (Stop, or the dialog closing while reading and
// recording), and puts the narrator's own arms back. A recording this app did not start is left alone
// (ErrNotOurRecording).
func readAloudRecordStopIn(ctx context.Context, recorder dawport.Recorder) (ReadAloudRecording, error) {
	if recorder == nil {
		return readAloudRefused(readAloudExperimentalOff, messageExperimentalOff), nil
	}
	stopped, err := recorder.RecordStop(ctx)
	if err != nil {
		return readAloudRecordRefusal(err), nil
	}
	restored, kept := stopped.Restored, stopped.Kept
	return ReadAloudRecording{Outcome: "stopped", Restored: &restored, Kept: &kept}, nil
}

func (h *Host) ReadAloudRecordStop() (string, error) {
	svc := h.services()
	result, err := readAloudRecordStopIn(context.Background(), recorderFrom(svc))
	h.clearReadAloudRecording()
	return encodeBinding(result, err)
}

// setReadAloudRecording remembers that this app started a recording for chapterID, so ServiceShutdown can stop it if
// the app quits first, and registers the handler for a recording REAPER's own Stop button ends without
// ReadAloudRecordStop (the narrator's arms still come back; the bar picks up the change on its next ask).
func (h *Host) setReadAloudRecording(chapterID string, recorder dawport.Recorder) {
	h.mu.Lock()
	h.readAloudRecordingChapter = chapterID
	h.mu.Unlock()
	recorder.OnRecordEnded(func(bridge.RecordEnded) { h.clearReadAloudRecording() })
}

func (h *Host) clearReadAloudRecording() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.readAloudRecordingChapter = ""
}

// stopReadAloudRecordingOnShutdown is ServiceShutdown's best-effort recording stop (threat-model row 5j: the host
// stops a recording it started when the app shuts down, rather than leaving REAPER recording with no app open to
// stop it). It never blocks shutdown on REAPER answering.
func (h *Host) stopReadAloudRecordingOnShutdown() {
	h.mu.Lock()
	chapterID := h.readAloudRecordingChapter
	h.mu.Unlock()
	if chapterID == "" {
		return
	}
	if recorder := recorderFrom(h.services()); recorder != nil {
		ctx, cancel := context.WithTimeout(context.Background(), readAloudRecordStartTimeout)
		defer cancel()
		_, _ = recorder.RecordStop(ctx)
	}
	h.clearReadAloudRecording()
}
