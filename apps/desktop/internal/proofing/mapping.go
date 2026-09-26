package proofing

import (
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// chapterTrack is the chapter's one confirmed track in the saved project (D5:
// v1 is one track per chapter, and an unconfirmed fuzzy match is never used),
// or the unknown status that says why there is none. Compare's own title match
// (compare.py) is not trusted as a mapping.
func chapterTrack(chapter stages.ChapterContext, view stages.EvidenceView) (tracks.Track, *RunStatus) {
	if view.ProjectErr != nil {
		return tracks.Track{}, &RunStatus{State: RunUnknown, Cause: stages.CauseProjectUnreadable, Reason: "The saved REAPER project could not be read: " + view.ProjectErr.Error() + "."}
	}
	if view.Mapping == nil {
		return tracks.Track{}, &RunStatus{State: RunUnknown, Cause: stages.CauseUnmappedTrack, Reason: "Link this chapter to the REAPER track it is recorded on."}
	}
	links, err := view.Mapping.List(chapter.DocumentID)
	if err != nil {
		return tracks.Track{}, &RunStatus{State: RunUnknown, Cause: stages.CauseUnmappedTrack, Reason: "The chapter-to-track links could not be read: " + err.Error() + "."}
	}
	var guids []string
	for _, link := range links {
		if link.ChapterID == chapter.ChapterID {
			guids = append(guids, link.TrackGUID)
		}
	}
	switch len(guids) {
	case 0:
		return tracks.Track{}, &RunStatus{State: RunUnknown, Cause: stages.CauseUnmappedTrack, Reason: "Link this chapter to the REAPER track it is recorded on."}
	case 1:
	default:
		return tracks.Track{}, &RunStatus{State: RunUnknown, Cause: stages.CauseMultipleTracks, Reason: "This chapter is linked to more than one REAPER track. Keep one link."}
	}
	for _, track := range view.Project.Tracks {
		if track.GUID == guids[0] {
			return track, nil
		}
	}
	return tracks.Track{}, &RunStatus{State: RunUnknown, Cause: stages.CauseUnmappedTrack, Reason: "The track this chapter is linked to is no longer in the saved project. Link it again."}
}

// playedItems are the items of track that play: supported audio, not muted,
// with a source, on a playing lane when the track uses fixed lanes. They are
// what a comparison must have covered.
func playedItems(track tracks.Track) []tracks.Item {
	var played []tracks.Item
	for _, item := range track.Items {
		if item.Muted || !item.Supported || item.Active().SourceFile == "" {
			continue
		}
		if track.FixedLanes && !track.LanePlays(item.Lane) {
			continue
		}
		played = append(played, item)
	}
	return played
}
