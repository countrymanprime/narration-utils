package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// Whether REAPER is ready to record a chapter with reading (read-aloud-control-bar PRD Phase 6, ADR 0249): one read-only
// chapter_track_state of the chapter's linked track, compared with REAPER's arms. It is asked on demand (the dialog
// opening, the REAPER toggle, before Play, a Refresh), never on a timer (ADR 0122), and changes nothing in REAPER.

// The statuses ReadAloudReaperState answers.
const (
	readAloudReady              = "ready"               // the chapter's track is the one track armed
	readAloudNotArmed           = "not_armed"           // nothing is armed
	readAloudOtherArmed         = "other_armed"         // one track is armed, not the chapter's
	readAloudSeveralArmed       = "several_armed"       // more than one track is armed
	readAloudNoLink             = "no_link"             // the chapter has no single linked track in REAPER
	readAloudRecordingElsewhere = "recording_elsewhere" // REAPER is already recording
	readAloudUnavailable        = "unavailable"         // REAPER could not be asked
)

// The reasons that go with no_link and unavailable (unavailable also uses reaperStandalone, reaperNotRunning and
// refusedFailed).
const (
	readAloudUnlinked        = "unlinked"
	readAloudSeveralLinks    = "several_links"
	readAloudTrackMissing    = "track_missing"
	readAloudExperimentalOff = "experimental_off"
)

// readAloudReaperState is the answer: Status, a Reason for no_link and unavailable, and a Message in the narrator's words.
// TrackGUID is the linked track REAPER was asked about; ArmedCount, Playing and Recording are what REAPER said, present
// only once it answered.
type readAloudReaperState struct {
	Status     string `json:"status"`
	Reason     string `json:"reason,omitempty"`
	Message    string `json:"message"`
	TrackGUID  string `json:"trackGuid,omitempty"`
	ArmedCount *int   `json:"armedCount,omitempty"`
	Playing    bool   `json:"playing"`
	Recording  bool   `json:"recording"`
}

const (
	messageReaperOff       = "REAPER is not connected to this app. To record with reading, open this app from the Narration Utils action in REAPER."
	messageExperimentalOff = "Reading REAPER's tracks is an experimental action. Turn on Experimental REAPER actions in Settings to use it."
)

// trackStateReader is bridge.Actions' read of chapter_track_state, as the binding needs it (a fake in tests).
type trackStateReader interface {
	ChapterTrackState(ctx context.Context, trackGUID string) (bridge.TrackState, error)
}

// ReadAloudReaperState answers whether REAPER is ready to record chapterID with reading
// (read-aloud-control-bar.prd.md Phase 6): its linked track the one track armed, and REAPER not already recording. A
// chapter with no link, a REAPER that is not there and the experimental switch being off are answers, not errors; only
// a chapter the manuscript does not have is an error. It reads, and changes nothing in REAPER.
func (h *Host) ReadAloudReaperState(chapterID string) (string, error) {
	svc := h.services()
	var reader trackStateReader
	if svc.actions != nil {
		reader = svc.actions
	}
	return encodeBinding(readAloudReaperStateIn(context.Background(), svc, reader, chapterID))
}

func readAloudReaperStateIn(ctx context.Context, svc hostServices, reader trackStateReader, chapterID string) (readAloudReaperState, error) {
	title, links, err := chapterLinksFor(svc, chapterID)
	if err != nil {
		return readAloudReaperState{}, err
	}
	switch {
	case len(links) == 0:
		return readAloudReaperState{Status: readAloudNoLink, Reason: readAloudUnlinked,
			Message: fmt.Sprintf("%q has no linked track. Link it to its REAPER track on the Tracks page.", title)}, nil
	case len(links) > 1:
		return readAloudReaperState{Status: readAloudNoLink, Reason: readAloudSeveralLinks,
			Message: fmt.Sprintf("%q is linked to %d tracks. Keep the one to record on, on the Tracks page.", title, len(links))}, nil
	}
	guid := links[0]
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return unavailable(status.Connection, readAloudConnectionMessage(status.Connection)), nil
	}
	if reader == nil {
		return unavailable(reaperStandalone, messageReaperOff), nil
	}
	state, err := reader.ChapterTrackState(ctx, guid)
	if err != nil {
		return readAloudRefusal(err, title, guid), nil
	}
	return classifyReadAloud(state, title, guid), nil
}

// chapterLinksFor is the chapter's display title and its confirmed track GUIDs, or an error for a chapter the manuscript
// does not have.
func chapterLinksFor(svc hostServices, chapterID string) (string, []string, error) {
	documentID, store, err := mappingContext(svc)
	if err != nil {
		return "", nil, err
	}
	chapters, err := svc.manuscript.ChaptersUnmeasured()
	if err != nil {
		return "", nil, err
	}
	title, found := "", false
	for _, chapter := range chapters {
		if id, _ := chapter["id"].(string); id == chapterID {
			raw, _ := chapter["title"].(string)
			title, found = displayTitle(raw), true
			break
		}
	}
	if !found {
		return "", nil, fmt.Errorf("that chapter is not part of the current manuscript")
	}
	mappings, err := store.List(documentID)
	if err != nil {
		return "", nil, err
	}
	var guids []string
	for _, mapping := range mappings {
		if mapping.ChapterID == chapterID {
			guids = append(guids, mapping.TrackGUID)
		}
	}
	return title, guids, nil
}

func unavailable(reason, message string) readAloudReaperState {
	return readAloudReaperState{Status: readAloudUnavailable, Reason: reason, Message: message}
}

func readAloudConnectionMessage(connection string) string {
	if connection == reaperNotRunning {
		return messageNotRunning
	}
	return messageReaperOff
}

func readAloudRefusal(err error, title, guid string) readAloudReaperState {
	switch {
	case errors.Is(err, bridge.ErrStale):
		return readAloudReaperState{Status: readAloudNoLink, Reason: readAloudTrackMissing, TrackGUID: guid,
			Message: fmt.Sprintf("The track linked to %q is no longer in the REAPER project. Link it again on the Tracks page.", title)}
	case errors.Is(err, bridge.ErrExperimentalOff):
		return unavailable(readAloudExperimentalOff, messageExperimentalOff)
	case errors.Is(err, bridge.ErrNoAnswer):
		return unavailable(reaperNotRunning, messageNotRunning)
	case errors.Is(err, bridge.ErrUnavailable):
		return unavailable(reaperStandalone, messageReaperOff)
	}
	return unavailable(refusedFailed, fmt.Sprintf("Could not read REAPER's tracks: %v", err))
}

// classifyReadAloud compares REAPER's arms with the chapter's track: ready only when it is the one track armed and
// REAPER is not recording.
func classifyReadAloud(state bridge.TrackState, title, guid string) readAloudReaperState {
	armed := state.ArmedCount
	answer := readAloudReaperState{TrackGUID: guid, ArmedCount: &armed, Playing: state.Playing, Recording: state.Recording}
	switch {
	case state.Recording:
		answer.Status, answer.Message = readAloudRecordingElsewhere, "REAPER is already recording. Stop it in REAPER before recording with reading."
	case armed == 0:
		answer.Status, answer.Message = readAloudNotArmed, fmt.Sprintf("The track for %q is not armed in REAPER.", title)
	case armed > 1:
		answer.Status, answer.Message = readAloudSeveralArmed, fmt.Sprintf("%d tracks are armed in REAPER. Only the track for %q should be.", armed, title)
	case !state.TrackArmed:
		answer.Status, answer.Message = readAloudOtherArmed, fmt.Sprintf("Another track is armed in REAPER, not the one for %q.", title)
	default:
		answer.Status, answer.Message = readAloudReady, fmt.Sprintf("The track for %q is armed and ready.", title)
	}
	return answer
}
