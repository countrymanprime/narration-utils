// Package cleanupmap maps a silence-cleanup candidate onto the REAPER items that can host it (diagnostics-delivery-
// and-cleanup-tools PRD Phase 10, ADR 0251). measure.Diagnostics.CleanupFindings (ADR 0238) knows only the measured
// file and a cut range in that file's own seconds - it never imports REAPER - so before a candidate can become a
// preview marker or a trim, something has to say which live item plays that file, and whether the mapping from file
// seconds to project time can be trusted for it. This package only reads the parsed .rpp (internal/tracks); it never
// talks to REAPER and never changes anything.
package cleanupmap

import (
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Candidate is one item whose active take plays sourceFile across the whole requested cut range.
type Candidate struct {
	TrackGUID string
	ItemGUID  string
	TakeGUID  string
}

// Refusal explains why an item that plays sourceFile cannot host the candidate.
type Refusal struct {
	TrackGUID, ItemGUID string
	Reason              RefusalReason
}

type RefusalReason string

const (
	// ReasonOutsidePlayedRange: the item plays sourceFile, but not the requested cut range (it plays a different
	// part of the file, or a shorter clip of it).
	ReasonOutsidePlayedRange RefusalReason = "outside-played-range"
	// ReasonUnreliableMapping: the take has stretch markers, or its source is a trimmed section wrapper, either of
	// which breaks the constant-rate file-seconds-to-project-seconds mapping every bridge command relies on
	// (narration_navigation.lua's own project_time, and narration_cleanup_preview.lua's copy of it).
	ReasonUnreliableMapping RefusalReason = "unreliable-mapping"
)

// ForFile finds every item in project whose active take's source file is sourceFile (matched like
// internal/takecompare's own file identity check: case-insensitive, after Clean, since a rendered chapter path on
// disk and the .rpp's own copy of it are not always byte-identical) and reports, for each, whether its active take
// plays cutStartSeconds..cutEndSeconds of that file (both ends inclusive of the take's own played range) as a
// Candidate, or why not as a Refusal. No match at all (sourceFile is not any item's source) answers two empty slices:
// that is not a refusal, since nothing here was even a candidate to refuse.
func ForFile(project tracks.Project, sourceFile string, cutStartSeconds, cutEndSeconds float64) ([]Candidate, []Refusal) {
	var candidates []Candidate
	var refusals []Refusal
	for _, track := range project.Tracks {
		for _, item := range track.Items {
			take := item.Active()
			if !samePath(take.SourceFile, sourceFile) {
				continue
			}
			if take.Section != nil || take.StretchMarkerCount > 0 {
				refusals = append(refusals, Refusal{TrackGUID: track.GUID, ItemGUID: item.GUID, Reason: ReasonUnreliableMapping})
				continue
			}
			playedStart := take.SourceStart()
			playedEnd := playedStart + item.Length*take.Rate()
			if cutStartSeconds < playedStart || cutEndSeconds > playedEnd {
				refusals = append(refusals, Refusal{TrackGUID: track.GUID, ItemGUID: item.GUID, Reason: ReasonOutsidePlayedRange})
				continue
			}
			candidates = append(candidates, Candidate{TrackGUID: track.GUID, ItemGUID: item.GUID, TakeGUID: item.TakeGUID})
		}
	}
	return candidates, refusals
}

func samePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}
