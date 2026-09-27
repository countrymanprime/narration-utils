package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// "Select in REAPER" (chapter-track-link-control.prd.md Phase 4, Could): from the chapter track slide-over's Link
// section, brings the narrator's attention to a track without changing anything else. The Lua and bridge half
// (select_track in narration_track_select.lua and bridge.Actions.SelectTrack, DAW port PRD's Track select role) is
// already built and harness-tested; this file is the remaining caller. Sent only from a click, with the track GUID
// the slide-over already has (a linked or candidate track's guid, never a path, threat-model row 5j).

// TrackSelectResult is what a select did, in the shape the slide-over reads. Outcome is "selected" or "refused"
// (Reason and Message say why; nothing in REAPER changed for a refusal), mirroring ReadAloudRecording.
type TrackSelectResult struct {
	Outcome   string `json:"outcome"`
	Reason    string `json:"reason,omitempty"`
	Message   string `json:"message,omitempty"`
	TrackGUID string `json:"trackGuid,omitempty"`
}

func trackSelectRefused(reason, message string) TrackSelectResult {
	return TrackSelectResult{Outcome: "refused", Reason: reason, Message: message}
}

// Worded for this action specifically, rather than reused: readaloudreaper.go's standalone and experimental-off
// messages read "To record with reading..." and "Reading REAPER's tracks...", which describe chapter_track_state, not
// select_track. messageNotRunning (bindings_navigation.go) is already feature-neutral, so that one is reused as is.
const (
	messageTrackSelectExperimentalOff = "Selecting a track in REAPER is an experimental action. Turn on Experimental REAPER actions in Settings to use it."
	messageTrackSelectStandalone      = "REAPER is not connected to this app. To select a track in REAPER, open this app from the Narration Utils action in REAPER."
)

// trackSelectConnectionMessage words a connection refusal for this action, mirroring readAloudConnectionMessage's shape.
func trackSelectConnectionMessage(connection string) string {
	if connection == reaperNotRunning {
		return messageNotRunning
	}
	return messageTrackSelectStandalone
}

// trackSelectorFrom asks svc's DAW port resolver for the Track select role (DAW port PRD P5a, ADR 0300), the same
// seam trackStateReaderFrom uses: nil when there is no resolver, no adapter, the capability is toggled off, or
// REAPER is not reachable right now.
func trackSelectorFrom(svc hostServices) dawport.TrackSelector {
	if svc.dawPortResolver == nil {
		return nil
	}
	selector, err := dawport.Role[dawport.TrackSelector](svc.dawPortResolver, dawport.CapTrackSelect)
	if err != nil {
		return nil
	}
	return selector
}

// trackSelectRefusal turns what SelectTrack answered into the reason and words the slide-over shows. Connection-level
// refusals (REAPER not there, not answering) are already handled by reaperStatus before this is called; only a stale
// track or an unexpected error reach here.
func trackSelectRefusal(err error) TrackSelectResult {
	var stale *bridge.TrackStaleError
	if errors.As(err, &stale) {
		return trackSelectRefused(readAloudTrackMissing, "This track is no longer in the REAPER project. Link it again on the Tracks page.")
	}
	return trackSelectRefused(refusedFailed, "REAPER could not do that: "+err.Error()+".")
}

// trackSelectInReaperIn selects trackGUID in REAPER. selector is nil exactly when trackSelectorFrom would answer nil
// (no resolver, the capability off, or REAPER not reachable).
func trackSelectInReaperIn(ctx context.Context, svc hostServices, selector dawport.TrackSelector, trackGUID string) (TrackSelectResult, error) {
	if trackGUID == "" {
		return TrackSelectResult{}, fmt.Errorf("choose a track before selecting it in REAPER")
	}
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return trackSelectRefused(status.Connection, trackSelectConnectionMessage(status.Connection)), nil
	}
	if selector == nil {
		return trackSelectRefused(readAloudExperimentalOff, messageTrackSelectExperimentalOff), nil
	}
	selected, err := selector.SelectTrack(ctx, trackGUID)
	if err != nil {
		return trackSelectRefusal(err), nil
	}
	return TrackSelectResult{Outcome: "selected", TrackGUID: selected.TrackGUID}, nil
}

// TrackSelectInReaper is the slide-over's "Select in REAPER" binding.
func (h *Host) TrackSelectInReaper(trackGUID string) (string, error) {
	svc := h.services()
	result, err := trackSelectInReaperIn(context.Background(), svc, trackSelectorFrom(svc), trackGUID)
	return encodeBinding(result, err)
}
