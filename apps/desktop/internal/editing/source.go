// Package editing is Phase 2 of docs/prds/editing-readiness-analysis.prd.md
// (ER): a read-only editing-chore scan for one chapter's confirmed track.
// This file is Phase 2's own scope: turning a parsed tracks.Item into an
// analysis Source (its active take's file and played range, EL Phase 2's
// evidence.ItemPlayedRange) or a stable typed reason it cannot be analyzed at
// all - never a guess, never a silent skip that would later read as a false
// "done" (Problem Statement: "the analysis must prefer to say unknown or not
// done whenever it cannot be sure"). Importers/callers: decode.go (Phase 2),
// the empty-space composition (Phase 3, empty_space.go) and the scan job
// (Phase 5, service.go).
package editing

import (
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// UnknownReason is a stable, typed reason one item's audio could not be
// analyzed (Architecture Notes: "Every other item that cannot be analyzed
// gets a stable typed reason, and each reason becomes unknown"). It is never
// set on an Excluded item: a muted or non-audio item is left out of the
// analysis entirely, not refused, so it never makes the chapter's signal
// unknown by itself.
type UnknownReason string

const (
	// ReasonPlayRateNotOne: the played take's rate is not 1 (Q1's WAV-only
	// decoder and this analyzer's timeline math both assume playback at the
	// source's own rate; Success Metrics lists "playrate-not-1" as a case
	// that must always read unknown).
	ReasonPlayRateNotOne UnknownReason = "playrate_not_one"
	// ReasonStretchMarkers: the take has one or more stretch markers, which
	// bend the mapping from source time to timeline time in a way this
	// analyzer does not model (tracks.Take.StretchMarkerCount is evidence
	// only, per its own doc comment - "not full stretch-marker semantics").
	ReasonStretchMarkers UnknownReason = "stretch_markers"
	// ReasonUnsupportedFormat: the source is not a WAV (Q1 option A for v1 -
	// MP3, FLAC, OGG, AIFF and WavPack are all "Supported" by the tracks
	// parser but none of them decodes through measure.NewWAVReader).
	ReasonUnsupportedFormat UnknownReason = "format_not_analyzable"
	// ReasonMultiChannel: the source has more than two channels; measure's
	// WAV reader refuses it (wav.go: "only mono and stereo are supported").
	ReasonMultiChannel UnknownReason = "multi_channel"
	// ReasonMissingFile: the take's source file is not available on disk
	// (tracks.Take.SourceAvailable is false, or the path is empty).
	ReasonMissingFile UnknownReason = "missing_file"
	// ReasonUnreadable: the source file could not be decoded for a reason
	// other than the ones above (a truncated or corrupt WAV header, for
	// example) - measure.NewWAVReader's own error, quoted in the evidence.
	ReasonUnreadable UnknownReason = "unreadable"
	// ReasonNoPlayedRange: the item's played range is empty or negative (a
	// zero-length item, or a malformed SOFFS/LENGTH pairing) - nothing to
	// decode.
	ReasonNoPlayedRange UnknownReason = "no_played_range"

	// ReasonReversedSource documents a known, undetected gap rather than a
	// real case Resolve ever returns (see its own doc comment below); it is
	// exported so a caller and this package's tests can name the gap by a
	// stable identifier instead of a magic string, without implying this
	// analyzer can tell a reversed take apart from a forward one.
	//
	// tracks.Item and tracks.Take carry no "reversed" or play-direction
	// field as of this writing (apps/desktop/internal/tracks/tracks.go
	// grepped for "revers" turns up nothing) - a documented gap this PRD's
	// Architecture Notes calls out explicitly ("There does not appear to be
	// a reversed source field anywhere in this package"). A take REAPER
	// plays backwards is therefore analyzed forwards, silently: its silence
	// runs and click/breath candidates are still reported, just against the
	// wrong direction of playback. This is a real, un-mitigated limitation,
	// not a rounding error, and is called out again in this package's tests
	// and in the Phase 2 commit message rather than being hidden behind a
	// reason that implies detection.
	ReasonReversedSource UnknownReason = "reversed_source_undetected"
)

// reasonText is a short, stable, human string for each reason. SR's evidence
// and the findings this package writes show it verbatim, so it stays plain
// and specific rather than a generic "could not analyze".
var reasonText = map[UnknownReason]string{
	ReasonPlayRateNotOne:    "the item plays at a rate other than 1",
	ReasonStretchMarkers:    "the take has stretch markers",
	ReasonUnsupportedFormat: "the source format is not analyzable (WAV only)",
	ReasonMultiChannel:      "the source has more than two channels",
	ReasonMissingFile:       "the source file is missing",
	ReasonUnreadable:        "the source file could not be read",
	ReasonNoPlayedRange:     "the item plays no audio",
}

// Text is r's short human string, or r itself when it has none (a defensive
// fallback; every constant above has an entry, kept in sync by
// TestEveryReasonHasText).
func (r UnknownReason) Text() string {
	if text, ok := reasonText[r]; ok {
		return text
	}
	return string(r)
}

// Source is one item's audio input to the editing analysis: its active
// take's file and played range (evidence.ItemPlayedRange, EL Phase 2),
// SourceStart already folding in a <SOURCE SECTION> wrapper's own offset
// (tracks.Take.SourceStart), plus the evidence Architecture Notes ask for
// (take or track FX-chain presence, stretch marker count).
type Source struct {
	ItemGUID           string
	TakeGUID           string
	File               string
	PlayedRange        evidence.PlayedRange
	HasFXChain         bool
	StretchMarkerCount int
}

// Resolution is what Resolve decided about one item: Excluded (a muted or
// non-audio item, never reported unknown), or a Source ready to decode, or -
// when neither - a stable Reason naming why it cannot be analyzed. Exactly
// one of Excluded, a usable Source, or Reason applies to a given Resolution.
type Resolution struct {
	Item     tracks.Item
	Excluded bool
	Source   Source
	Reason   UnknownReason // "" exactly when the item is analyzable
}

// Analyzable reports whether r can be decoded: neither excluded from the
// analysis nor refused for a typed reason.
func (r Resolution) Analyzable() bool { return !r.Excluded && r.Reason == "" }

// Resolve turns one parsed item into a Resolution. trackHasFXChain is the
// item's own track's <FXCHAIN> presence (tracks.Track.HasFXChain); it is
// folded into Source.HasFXChain alongside the take's own <TAKEFX>, since
// either can gate source dead air or mask a source click (Architecture
// Notes' processed-audio caveat) whether or not the narrator has looked at
// the chain. A muted item, or one the tracks parser could not resolve to a
// playable audio kind (Item.Supported false - MIDI, an unresolved source
// kind), is Excluded: it never contributes and never makes the chapter's
// signal read unknown by itself (Architecture Notes: "excluded from the
// analysis, not refused"). Every other item is analyzable unless it hits one
// of the typed reasons above, checked in the order a narrator would find
// cheapest to fix first: the play rate and stretch markers are read straight
// off the take without touching the file system; the format, file presence
// and played range need only the parsed fields, still no disk access; the
// file itself is opened only by Decode (decode.go).
func Resolve(item tracks.Item, trackHasFXChain bool) Resolution {
	if item.Muted || !item.Supported {
		return Resolution{Item: item, Excluded: true}
	}
	take := item.Active()
	switch {
	case take.Rate() != 1:
		return Resolution{Item: item, Reason: ReasonPlayRateNotOne}
	case take.StretchMarkerCount > 0:
		return Resolution{Item: item, Reason: ReasonStretchMarkers}
	case take.SourceKind != "WAVE":
		return Resolution{Item: item, Reason: ReasonUnsupportedFormat}
	case !take.SourceAvailable || take.SourceFile == "":
		return Resolution{Item: item, Reason: ReasonMissingFile}
	}
	played := evidence.ItemPlayedRange(item)
	if played.End <= played.Start {
		return Resolution{Item: item, Reason: ReasonNoPlayedRange}
	}
	return Resolution{
		Item: item,
		Source: Source{
			ItemGUID: item.GUID, TakeGUID: take.GUID, File: take.SourceFile, PlayedRange: played,
			HasFXChain: take.HasFXChain || trackHasFXChain, StretchMarkerCount: take.StretchMarkerCount,
		},
	}
}

// ResolveTrack resolves every item of one track (Architecture Notes: "unmuted
// audio items on the chapter's confirmed track"), in item order.
func ResolveTrack(track tracks.Track) []Resolution {
	resolutions := make([]Resolution, len(track.Items))
	for i, item := range track.Items {
		resolutions[i] = Resolve(item, track.HasFXChain)
	}
	return resolutions
}
