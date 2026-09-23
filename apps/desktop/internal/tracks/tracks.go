// Package tracks reads REAPER project (.rpp) files directly from disk to
// list a project's tracks and the media each track's items reference. It
// does not depend on a running REAPER instance or the file-session Lua
// bridge (integrations/reaper/narration_ui_bridge.lua): that bridge only works
// while REAPER has NarrationUtils_Launcher.lua active for the current
// session, whereas a standalone-launched app (docs/architecture/
// standalone-launch.md) must be able to read tracks from a project folder
// on its own.
package tracks

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Item is REAPER's <ITEM> chunk, still with Position/Length/Name/SourceKind/
// SourceFile/SourceAvailable/Supported/GUID (the TracksList wire contract:
// tests/fixtures/contracts/tracks-project.json, apps/ui's Zod schema) always
// describing the item's active take, not necessarily its first one (Q10 of
// the analysis evidence ledger PRD). GUID joined the wire contract in the
// reaper-automation-follow-through PRD's Phase 7 (Line-identity UI): the
// "Link chapters" preview names, by GUID, exactly which item each stamp
// would write to (never a position or an index), and LineIdentityStamp's
// rows are keyed by item GUID. The remaining fields are the parser superset
// (EL Phase 1) added for that PRD and its siblings; they are not yet part of
// the wire contract (json:"-") because no UI or binding surface consumes
// them in this phase - a later phase (5, 6 or 7) decides how much of this an
// analyzer or the UI sees.
type Item struct {
	Position        float64 `json:"position"`
	Length          float64 `json:"length"`
	Name            string  `json:"name"`
	SourceKind      string  `json:"sourceKind"`
	SourceFile      string  `json:"sourceFile"`
	SourceAvailable bool    `json:"sourceAvailable"`
	Supported       bool    `json:"supported"`

	// GUID is the item's own GUID (REAPER 7.x's <ITEM IGUID ...>; the
	// hand-written legacy fixture predates IGUID and falls back to its
	// single item-position GUID line). It identifies the item across edits
	// that don't change its take content (a move, for example).
	GUID string `json:"guid"`
	// Muted is the item's own mute flag (MUTE, distinct from a take's own
	// state - REAPER has no per-take mute).
	Muted bool `json:"-"`
	// ActiveTake indexes Takes for the take REAPER currently plays (the one
	// marked TAKE SEL, or the only one when there is no TAKE line at all).
	ActiveTake int `json:"-"`
	// Takes holds every take, in file order; len(Takes) is 1 for a
	// non-multi-take item.
	Takes []Take `json:"-"`
	// Ext is the item's own extension data (<EXTI>, REAPER's P_EXT), nil
	// when the item carries none.
	Ext map[string]string `json:"-"`
}

// Active returns the item's active take (Takes[ActiveTake]) - the take
// Position/Length/Name/SourceKind/SourceFile/SourceAvailable/Supported
// above describe. It returns the zero Take for a malformed item with no
// takes at all, which should not occur for a source REAPER wrote.
func (item Item) Active() Take {
	if item.ActiveTake < 0 || item.ActiveTake >= len(item.Takes) {
		return Take{}
	}
	return item.Takes[item.ActiveTake]
}

// Take is one take of an <ITEM> chunk: its own source, played range and
// rate (SOFFS/PLAYRATE), GUID, evidence of FX and stretch markers, and its
// own extension data (<EXT>). REAPER's rpp format has no per-take chunk -
// a take is a run of scalar lines (NAME, SOFFS, PLAYRATE, GUID, ...) and
// child chunks (<SOURCE>, <TAKEFX>, <EXT>) delimited by a bare TAKE line
// (see apps/desktop/internal/tracks/testdata/reaper/README.md).
type Take struct {
	GUID            string
	Name            string
	SourceKind      string
	SourceFile      string
	SourceAvailable bool
	Supported       bool
	Active          bool
	SOFFS           float64
	PlayRate        float64
	// Section is non-nil when the take's source is a <SOURCE SECTION ...>
	// wrapper (a trimmed/offset region of a larger file): the offsets a
	// hash of the whole source file cannot see (D6 of the evidence ledger
	// PRD - non-destructive edits leave the source unchanged).
	Section *SectionOffsets
	// HasFXChain records whether the take carries a <TAKEFX> chain, not the
	// chain's contents (the PRD's "FX-chain presence, not full FX parsing").
	HasFXChain bool
	// StretchMarkerCount counts the take's SM lines, evidence rather than
	// full stretch-marker semantics.
	StretchMarkerCount int
	// Ext is the take's own extension data (<EXT>), nil when the take
	// carries none.
	Ext map[string]string
}

// SectionOffsets is a <SOURCE SECTION ...> wrapper's own offsets into the
// larger file its inner <SOURCE> names.
type SectionOffsets struct {
	StartPos float64
	Length   float64
	Overlap  float64
}

type Track struct {
	GUID   string `json:"guid"`
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Color  string `json:"color"`
	Muted  bool   `json:"muted"`
	Soloed bool   `json:"soloed"`
	Items  []Item `json:"items"`

	// HasFXChain records the track's own <FXCHAIN> presence (distinct from
	// a take's <TAKEFX>); not yet part of the wire contract (json:"-"), see
	// Item's doc comment.
	HasFXChain bool `json:"-"`

	// Selected and Armed are the track's selection (SEL 1) and record-arm (the
	// first REC field) as of the .rpp's last save. The chapter suggestion
	// (chaptermatch.Suggest, ADR 0113) reads them to find the track the
	// narrator is recording; not on the TracksList wire contract (json:"-").
	Selected bool `json:"-"`
	Armed    bool `json:"-"`
}

type Project struct {
	Path   string  `json:"path"`
	Tracks []Track `json:"tracks"`

	// Regions are the project's regions (not its plain markers), in file
	// order. The chapter-to-track matcher (internal/chaptermatch) reads their
	// names beside track names, for example the chapter regions
	// create_chapter_regions makes. Not on the TracksList wire contract
	// (json:"-"): no UI shows them yet.
	Regions []Region `json:"-"`
}

// Region is one REAPER region: two MARKER lines in the project chunk that
// share a number, the start (with the name, flags bit 1 set and the GUID) and
// the end (an empty name). Markers and regions are numbered separately.
type Region struct {
	Index int
	Name  string
	Start float64
	End   float64
	GUID  string
}

// ItemByGUID finds the item whose own GUID (Item.GUID, from <ITEM IGUID
// ...>, not a take's own GUID) equals guid, and the track that holds it. It
// is the take-review PRD's answer to Q6: a finding targets an item by its
// GUID rather than a manuscript line-identity stamp, so re-resolving that
// target against a freshly parsed project (immediately before a mutation,
// to refuse a stale identity) needs no stamped ids at all - only this
// lookup over the static model. It matches only Item.GUID: a take's own
// GUID never matches, since a take is not a valid mutation target on its
// own (Q4/Q5 - a candidate is added as a take *of* a target item).
func (project Project) ItemByGUID(guid string) (track Track, item Item, ok bool) {
	if guid == "" {
		return Track{}, Item{}, false
	}
	for _, candidateTrack := range project.Tracks {
		for _, candidateItem := range candidateTrack.Items {
			if candidateItem.GUID == guid {
				return candidateTrack, candidateItem, true
			}
		}
	}
	return Track{}, Item{}, false
}

// Discover returns every top-level *.rpp project file directly inside
// folder, sorted by filename. It deliberately does not recurse: REAPER
// writes backup copies into a "Backups" subfolder and autosave/render
// output elsewhere under the project folder, and a nested "*.rpp" there is
// not a project the narrator opened.
func Discover(folder string) ([]string, error) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, err
	}
	var found []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".rpp") {
			found = append(found, filepath.Join(folder, entry.Name()))
		}
	}
	sort.Strings(found)
	return found, nil
}
