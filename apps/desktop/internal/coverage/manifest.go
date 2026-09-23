package coverage

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// manifestSchemaVersion is the sidecar's manifest version (coverage_mode.MANIFEST_SCHEMA_VERSION).
const manifestSchemaVersion = 1

// overlapTolerance is how far one item may run into the next before it counts
// as an overlap (float rounding in REAPER's saved positions).
const overlapTolerance = 0.001

// Manifest is the JSON the sidecar's --manifest reads (ADR 0127).
type Manifest struct {
	SchemaVersion int            `json:"schemaVersion"`
	Items         []ManifestItem `json:"items"`
}

// ManifestItem is one item's active take: its played range in source seconds,
// as prepare_compare's "index|source_file|startoffs|length*rate"
// (narration_ui_bridge.lua), plus the words file named inside --words-dir.
type ManifestItem struct {
	Index       int     `json:"index"`
	ItemGUID    string  `json:"itemGuid"`
	SourceFile  string  `json:"sourceFile"`
	StartOffset float64 `json:"startOffset"`
	Length      float64 `json:"length"`
	WordsFile   string  `json:"wordsFile"`
	Muted       bool    `json:"muted"`
}

// plannedItem is a manifest item with what the host needs to move its words in
// and out of the analysis evidence cache.
type plannedItem struct {
	ManifestItem
	identity evidence.SourceIdentity
	played   evidence.PlayedRange
}

// plan is everything a run needs from the saved project, gathered before the
// sidecar starts.
type plan struct {
	trackGUID   string
	items       []plannedItem
	fingerprint evidence.LedgerFingerprint
	overlapping int
	mutedLeft   int // muted items not listed because they have no playable source
}

// buildPlan reads the confirmed track's items out of the parsed saved project,
// in position order (Q9: many items on one track, concatenated in play order),
// and turns each into a manifest item. The active take is the one read (Q5); a
// muted item is listed as muted and never transcribed (Q10). An unmuted item
// that cannot be played - not audio, a source that is gone, an empty range - is
// an UnknownError: the chapter as heard cannot be measured, so the run is
// refused instead of reporting the missing item's text as unread.
func buildPlan(project tracks.Project, trackGUID string, identify evidence.SourceIdentifier) (plan, error) {
	track, ok := findTrack(project, trackGUID)
	if !ok {
		return plan{}, unknown(ReasonMappedTrackMissing, "the chapter's confirmed track is not in the saved REAPER project")
	}
	items := append([]tracks.Item(nil), track.Items...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].Position < items[j].Position })

	result := plan{trackGUID: trackGUID}
	var lastEnd float64
	haveLast := false
	for _, item := range items {
		planned, err := planItem(item, len(result.items), identify)
		if err != nil {
			if item.Muted {
				result.mutedLeft++
				continue
			}
			return plan{}, err
		}
		if !item.Muted {
			if haveLast && item.Position < lastEnd-overlapTolerance {
				result.overlapping++
			}
			if end := item.Position + item.Length; !haveLast || end > lastEnd {
				lastEnd = end
			}
			haveLast = true
		}
		result.items = append(result.items, planned)
	}
	if !haveLast {
		return plan{}, unknown(ReasonNoItems, "the chapter's track has no unmuted audio items in the saved REAPER project")
	}
	result.fingerprint, _ = evidence.ComputeChapterFingerprint(items, identify)
	return result, nil
}

func planItem(item tracks.Item, index int, identify evidence.SourceIdentifier) (plannedItem, error) {
	take := item.Active()
	switch {
	case item.GUID == "":
		return plannedItem{}, unknown(ReasonItemUnreadable, "an item on the chapter's track has no GUID in the saved project")
	case !take.Supported:
		return plannedItem{}, unknownf(ReasonUnsupportedItem, "item %s is not an audio item", item.GUID)
	case take.SourceFile == "":
		return plannedItem{}, unknownf(ReasonSourceMissing, "item %s has no source file", item.GUID)
	}
	identity, err := identify(take.SourceFile)
	if err != nil {
		return plannedItem{}, unknownf(ReasonSourceMissing, "the audio of item %s could not be read: %v", item.GUID, err)
	}
	played := evidence.ItemPlayedRange(item)
	if !(played.End > played.Start) || played.Start < 0 {
		return plannedItem{}, unknownf(ReasonItemUnreadable, "item %s has no played range in the saved project", item.GUID)
	}
	return plannedItem{
		ManifestItem: ManifestItem{
			Index:       index,
			ItemGUID:    item.GUID,
			SourceFile:  take.SourceFile,
			StartOffset: played.Start,
			Length:      played.End - played.Start,
			WordsFile:   wordsFileName(identity, played),
			Muted:       item.Muted,
		},
		identity: identity,
		played:   played,
	}, nil
}

// wordsFileName names an item's words file inside the run's --words-dir by
// its source and played range: two items that play the same range share one
// file (the sidecar transcribes it once), and the name is always a plain file
// name the sidecar accepts ([A-Za-z0-9][A-Za-z0-9._-]*), never a path.
func wordsFileName(identity evidence.SourceIdentity, played evidence.PlayedRange) string {
	sum := sha256.Sum256([]byte(hashParts(identity.Path, fmt.Sprint(identity.Size), identity.PartialHash,
		fmt.Sprintf("%.6f", played.Start), fmt.Sprintf("%.6f", played.End))))
	return "w-" + hex.EncodeToString(sum[:16]) + ".json"
}

func (p plan) manifest() Manifest {
	items := make([]ManifestItem, 0, len(p.items))
	for _, item := range p.items {
		items = append(items, item.ManifestItem)
	}
	return Manifest{SchemaVersion: manifestSchemaVersion, Items: items}
}

func (p plan) itemGUIDs() []string {
	guids := make([]string, 0, len(p.items))
	for _, item := range p.items {
		guids = append(guids, item.ItemGUID)
	}
	return guids
}

func findTrack(project tracks.Project, trackGUID string) (tracks.Track, bool) {
	for _, track := range project.Tracks {
		if track.GUID == trackGUID {
			return track, true
		}
	}
	return tracks.Track{}, false
}

// confirmedTrack is the chapter's one narrator-confirmed track (D5). No link
// is unmapped and two or more is a multi-track chapter: both are unknown, and
// an unconfirmed suggestion is never used.
func confirmedTrack(mapping *evidence.MappingStore, documentID, chapterID string) (string, error) {
	links, err := mapping.List(documentID)
	if err != nil {
		return "", err
	}
	var trackGUID string
	count := 0
	for _, link := range links {
		if link.ChapterID == chapterID {
			trackGUID = link.TrackGUID
			count++
		}
	}
	switch count {
	case 0:
		return "", unknown(ReasonUnmapped, "confirm which REAPER track holds this chapter first")
	case 1:
		return trackGUID, nil
	default:
		return "", unknown(ReasonMultipleTracks, "this chapter is linked to more than one track; coverage reads one track per chapter")
	}
}

// memoIdentify identifies each source file once per run, relative to the
// project folder (evidence.Identify), so the fingerprint, the cache keys and
// the manifest agree on the same identity.
func memoIdentify(projectFolder string) evidence.SourceIdentifier {
	seen := map[string]evidence.SourceIdentity{}
	return func(path string) (evidence.SourceIdentity, error) {
		if identity, ok := seen[path]; ok {
			return identity, nil
		}
		identity, err := evidence.Identify(path, projectFolder)
		if err != nil {
			return evidence.SourceIdentity{}, err
		}
		seen[path] = identity
		return identity, nil
	}
}

// projectFileFact is the saved project file a run read: its path and the
// modified time the basis label names (ADR 0100, D6).
func projectFileFact(path string, modTime time.Time) evidence.LedgerProjectFile {
	return evidence.LedgerProjectFile{Path: path, ModTime: modTime.UTC()}
}
