package main

import (
	"context"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Live DAW position for the resume prompt (read-aloud-resume-from-daw PRD Phase 4, RD2): where REAPER is right now,
// preferred over the saved .rpp's recorded end (Phases 1-3's own path, unchanged) whenever it can be trusted. It
// reuses readaloudreaper.go's chapter_track_state read (ADR 0231, ADR 0249) at the same trust level Read Aloud
// Control Bar already gives it: reachable, the experimental switch on, connected through bridge.Actions. Nothing
// here changes REAPER; it only reads.

// recordedEndFor is where candidate's track's recorded audio ends: reader's live answer when it can be trusted
// (connection is reaperConnected and candidate holds no region - a live answer carries no region bounds, so a track
// shared by several chapters always reads the saved project), the saved project's own RecordedEnd otherwise. live is
// true only when a live answer was used. recording is true while REAPER reports the track recording: the file
// underneath is still growing, so there is nothing to locate yet, and end is zero.
func recordedEndFor(ctx context.Context, reader trackStateReader, connection string, project tracks.Project, candidate chaptermatch.Candidate) (end tracks.RecordedEnd, live, recording, ok bool) {
	if reader != nil && connection == reaperConnected && candidate.Region == nil {
		if state, err := reader.ChapterTrackState(ctx, candidate.TrackGUID); err == nil {
			if state.Recording {
				return tracks.RecordedEnd{}, true, true, false
			}
			if found, has := liveRecordedEnd(state); has {
				return found, true, false, true
			}
		}
		// Any refusal - unreachable, experimental off, a stale track, no live items - reads as "no live answer": the
		// saved project is always a fallback, never an error the narrator has to clear.
	}
	end, ok = chaptermatch.RecordedEnd(project, candidate)
	return end, false, false, ok
}

// liveRecordedEnd is RD2's "where the track was": the live edit cursor, when it lies within a played item on the
// track, else the live end of the track's last item (the cursor parked at 0, past the end, or anywhere off the
// track's audio). ok is false only when the track carries no items at all.
func liveRecordedEnd(state bridge.TrackState) (tracks.RecordedEnd, bool) {
	if len(state.Items) == 0 {
		return tracks.RecordedEnd{}, false
	}
	for _, item := range state.Items {
		if state.EditCursor >= item.Position && state.EditCursor <= item.Position+item.Length {
			return recordedEndAt(item, state.EditCursor), true
		}
	}
	last := state.Items[0]
	for _, item := range state.Items[1:] {
		if item.Position+item.Length > last.Position+last.Length {
			last = item
		}
	}
	return recordedEndAt(last, last.Position+last.Length), true
}

// recordedEndAt maps projectTime (inside item, or at its end) into item's source file: the live counterpart of
// tracks.Track.RecordedEnd (internal/tracks/recorded.go). A live item carries no section or stretch-marker facts
// (ADR 0231's TRACK_ITEM has none), so Approximate always stays false. Supported is optimistic - true whenever the
// item names a source file - because the bridge does not report the source's kind live; an unplayable file still
// fails, in the sidecar's own refusal, the same class of error a corrupt saved-project source already raises.
func recordedEndAt(item bridge.TrackItem, projectTime float64) tracks.RecordedEnd {
	rate := item.PlayRate
	if rate == 0 {
		rate = 1
	}
	sourceTime := item.SourceOffset + (projectTime-item.Position)*rate
	available := item.SourceFile != ""
	return tracks.RecordedEnd{
		ProjectTime:     projectTime,
		ItemGUID:        item.ItemGUID,
		TakeGUID:        item.TakeGUID,
		SourceFile:      item.SourceFile,
		SourceStart:     item.SourceOffset,
		SourceTime:      sourceTime,
		SourceAvailable: available,
		Supported:       available,
	}
}
