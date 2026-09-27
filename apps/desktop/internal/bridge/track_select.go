package bridge

import (
	"context"
	"fmt"
)

// SelectedTrack is what select_track answers: the track REAPER now has selected, and only it.
type SelectedTrack struct{ TrackGUID string }

// SelectTrack deselects every other track in REAPER and selects trackGUID (chapter-track-link-control PRD Phase 4,
// "Select in REAPER"). It changes nothing else: no undo block, no scroll. A track that is gone is a *TrackStaleError,
// the same error ChapterTrackState reports for a stale GUID.
func (a *Actions) SelectTrack(ctx context.Context, trackGUID string) (SelectedTrack, error) {
	events, err := a.request(ctx, "select_track", []string{"TRACK_SELECTED", "TRACK_STALE"}, trackGUID)
	if err != nil {
		return SelectedTrack{}, err
	}
	for _, event := range events {
		switch event.Tag {
		case "TRACK_STALE":
			return SelectedTrack{}, &TrackStaleError{GUID: event.Fields[2]}
		case "TRACK_SELECTED":
			return SelectedTrack{TrackGUID: event.Fields[2]}, nil
		}
	}
	return SelectedTrack{}, fmt.Errorf("REAPER ended select_track without answering it")
}
