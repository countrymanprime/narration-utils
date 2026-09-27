package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// The live half of the resume locate (read-aloud-resume-from-daw PRD Phase 4, ADR 0349): where the chapter's track is in
// REAPER now, read through the DAW port's Track state role (chapter_track_state, ADR 0231), preferred over the saved .rpp
// whenever REAPER can say. It only reads.

// Where the DAW place came from (TeleprompterLocate's dawSource) and which point of the track it is (dawAt, RD2).
const (
	dawSourceSaved = "saved" // the saved .rpp, "as of the project's last save"
	dawSourceLive  = "live"  // REAPER's answer, "in REAPER now"
	liveAtEnd      = "end"   // the end of the track's recorded audio
	liveAtCursor   = "cursor"
)

// liveTrackStateTimeout bounds the one chapter_track_state read; with no answer by then the saved project is used, never a
// guess (research doc 4.6). A var so a test can shorten it.
var liveTrackStateTimeout = 3 * time.Second

// liveSourceExtensions are the audio files the locate decodes, by extension: the live answer names a file, not the
// .rpp's <SOURCE kind> (tracks.audioSourceKinds), so a take the saved project does not know is judged by its name.
var liveSourceExtensions = map[string]bool{
	".wav": true, ".bwf": true, ".w64": true, ".mp3": true, ".flac": true, ".ogg": true, ".aif": true, ".aiff": true, ".wv": true,
}

// readLiveTrack asks REAPER for trackGUID's live state. It reports false, and the caller reads the saved project, when
// there is no reader (no DAW, REAPER not reachable, the capability switched off), when REAPER does not answer in time or
// refuses (a track that is gone, the experimental switch), or when REAPER has another project open than projectPath: a
// live answer about a different project must never place a resume point in this one. Ending ctx ends the wait.
func readLiveTrack(ctx context.Context, reader trackStateReader, projectPath, trackGUID string) (dawport.TrackState, bool) {
	if reader == nil || projectPath == "" || trackGUID == "" {
		return dawport.TrackState{}, false
	}
	ctx, cancel := context.WithTimeout(ctx, liveTrackStateTimeout)
	defer cancel()
	state, err := reader.ChapterTrackState(ctx, trackGUID)
	if err != nil || state.Unsaved || state.ProjectPath == "" {
		return dawport.TrackState{}, false
	}
	if !strings.EqualFold(filepath.Clean(state.ProjectPath), filepath.Clean(projectPath)) {
		return dawport.TrackState{}, false
	}
	return state, true
}

// recordingOn reports whether REAPER is recording onto the chapter's track: its take's file is still growing, so no
// locate runs. Recording another track leaves this one's items final.
func recordingOn(state dawport.TrackState) bool {
	return state.Recording && state.TrackArmed
}

// liveRecordedEnd is RD2's DAW place: the edit cursor when it lies on the track's recorded audio (an item that plays,
// cursor after its start and no later than its end; the item that starts last when several overlap, as it plays on top),
// else the end of the item that ends last. It is the saved project's tracks.RecordedEnd computed from REAPER's live
// items, with at saying which point it is. saved is the same track in the saved project (nil when it is not there): it
// supplies what the live answer lacks (a take's section start, stretch markers and source kind, and an item's mute from
// a bridge script too old to say). within limits the items to a chapter region's span, as the saved reading does. It
// reports false when no item plays.
func liveRecordedEnd(state dawport.TrackState, saved *tracks.Track, within *tracks.Span, projectFolder string) (tracks.RecordedEnd, string, bool) {
	var under, last *dawport.TrackItem
	for i := range state.Items {
		item := &state.Items[i]
		if item.TakeGUID == "" || item.SourceFile == "" || liveMuted(*item, saved) || item.Length <= 0 {
			continue
		}
		if within != nil && (item.Position >= within.End || item.Position+item.Length <= within.Start) {
			continue
		}
		if last == nil || item.Position+item.Length > last.Position+last.Length {
			last = item
		}
		if state.EditCursor > item.Position && state.EditCursor <= item.Position+item.Length && (under == nil || item.Position >= under.Position) {
			under = item
		}
	}
	switch {
	case under != nil:
		return liveEndAt(*under, state.EditCursor, saved, projectFolder), liveAtCursor, true
	case last != nil:
		return liveEndAt(*last, last.Position+last.Length, saved, projectFolder), liveAtEnd, true
	}
	return tracks.RecordedEnd{}, "", false
}

// liveEndAt maps project time t on item to its take's source file.
func liveEndAt(item dawport.TrackItem, t float64, saved *tracks.Track, projectFolder string) tracks.RecordedEnd {
	rate := item.PlayRate
	if rate <= 0 {
		rate = 1
	}
	file := item.SourceFile
	if !filepath.IsAbs(file) {
		file = filepath.Join(projectFolder, file)
	}
	end := tracks.RecordedEnd{ProjectTime: t, ItemGUID: item.ItemGUID, TakeGUID: item.TakeGUID, SourceFile: file}
	sectionStart := 0.0
	end.Supported = liveSourceExtensions[strings.ToLower(filepath.Ext(file))]
	if take, ok := savedTake(saved, item.TakeGUID); ok {
		if take.Section != nil {
			sectionStart = take.Section.StartPos
			played := item.SourceOffset + item.Length*rate
			end.Approximate = take.Section.Length > 0 && played > take.Section.Length
		}
		end.Approximate = end.Approximate || take.StretchMarkerCount > 0
		if take.SourceKind != "" {
			end.Supported = take.Supported
		}
	}
	end.SourceStart = sectionStart + item.SourceOffset
	end.SourceTime = end.SourceStart + (t-item.Position)*rate
	if info, err := os.Stat(file); err == nil && !info.IsDir() {
		end.SourceAvailable = true
	}
	return end
}

// liveMuted is REAPER's own mute flag, or the saved project's for an item it knows when the bridge script is too old to
// report one.
func liveMuted(item dawport.TrackItem, saved *tracks.Track) bool {
	if item.Muted != nil {
		return *item.Muted
	}
	if saved != nil {
		for _, known := range saved.Items {
			if strings.EqualFold(known.GUID, item.ItemGUID) {
				return known.Muted
			}
		}
	}
	return false
}

func savedTake(saved *tracks.Track, takeGUID string) (tracks.Take, bool) {
	if saved == nil || takeGUID == "" {
		return tracks.Take{}, false
	}
	for _, item := range saved.Items {
		for _, take := range item.Takes {
			if strings.EqualFold(take.GUID, takeGUID) {
				return take, true
			}
		}
	}
	return tracks.Take{}, false
}
