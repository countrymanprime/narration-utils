package tracks

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// audioSourceKinds are the REAPER <SOURCE ...> kinds this package resolves
// to a playable media file. Anything else (MIDI, RPP_PROJECT for embedded
// subprojects, VIDEO, etc.) is recorded but marked unsupported rather than
// dropped, so the narrator sees the track exists without the app claiming
// it can play something it can't.
var audioSourceKinds = map[string]bool{
	"WAVE": true, "MP3": true, "FLAC": true, "OGG": true, "AIFF": true, "WAVPACK": true,
}

// Parse reads one .rpp file and returns its tracks, resolving each item's
// source media against the project folder (the directory containing path).
// A track or item REAPER doesn't expect this parser to fully understand
// (e.g. a MIDI item, or an unresolved source) is still returned - callers
// treat it as a reviewable "unsupported"/"unavailable" state, not an error.
func Parse(path string) (Project, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Project{}, err
	}
	root := parseChunks(string(raw))
	reaperProject := root.firstChild("REAPER_PROJECT")
	if reaperProject == nil {
		return Project{}, fmt.Errorf("%s does not look like a REAPER project file", filepath.Base(path))
	}
	projectFolder := filepath.Dir(path)
	var trackList []Track
	for index, trackNode := range reaperProject.childrenTagged("TRACK") {
		trackList = append(trackList, parseTrack(trackNode, index, projectFolder))
	}
	return Project{Path: path, Tracks: trackList}, nil
}

func parseTrack(n *node, index int, projectFolder string) Track {
	guid := n.attr0("TRACKID")
	if guid == "" && len(n.params) > 0 {
		guid = n.params[0]
	}
	muted, soloed := false, false
	if ms := n.attrs["MUTESOLO"]; len(ms) >= 2 {
		muted = ms[0] != "0"
		soloed = ms[1] != "0"
	}
	var itemList []Item
	for _, itemNode := range n.childrenTagged("ITEM") {
		itemList = append(itemList, parseItem(itemNode, projectFolder))
	}
	return Track{
		GUID:       guid,
		Index:      index,
		Name:       n.attr0("NAME"),
		Color:      decodeColor(n.attr0("PEAKCOL")),
		Muted:      muted,
		Soloed:     soloed,
		Items:      itemList,
		HasFXChain: n.firstChild("FXCHAIN") != nil,
	}
}

// parseItem reads an <ITEM> chunk's own scalars (POSITION, LENGTH, MUTE,
// IGUID), each of which appears at most once and so is read via the
// ordinary first-occurrence attrs map, then splits the rest into takes.
// Every take-scoped scalar this parser reads (NAME, SOFFS, PLAYRATE, GUID,
// SM) repeats once per take and is read from n.sequence by splitTakes.
func parseItem(n *node, projectFolder string) Item {
	position, _ := strconv.ParseFloat(n.attr0("POSITION"), 64)
	length, _ := strconv.ParseFloat(n.attr0("LENGTH"), 64)
	muted := false
	if m := n.attrs["MUTE"]; len(m) > 0 {
		muted = m[0] != "0"
	}
	guid := n.attr0("IGUID")
	if guid == "" {
		// The hand-written legacy fixture (testdata/basic.rpp) predates
		// REAPER 7's IGUID and has exactly one GUID line, at the item's
		// position, for its one take.
		guid = n.attr0("GUID")
	}

	takes, itemExt := splitTakes(n, projectFolder)
	activeIndex := 0
	for index, take := range takes {
		if take.Active {
			activeIndex = index
		}
	}

	item := Item{
		GUID:       guid,
		Position:   position,
		Length:     length,
		Muted:      muted,
		ActiveTake: activeIndex,
		Takes:      takes,
		Ext:        itemExt,
	}
	active := item.Active()
	item.Name = active.Name
	item.SourceKind = active.SourceKind
	item.SourceFile = active.SourceFile
	item.SourceAvailable = active.SourceAvailable
	item.Supported = active.Supported
	return item
}

// splitTakes walks an <ITEM> chunk's sequence in file order and partitions
// it into takes. REAPER has no per-take chunk: a take is a run of scalar
// lines (NAME, SOFFS, PLAYRATE, GUID, SM) and child chunks (<SOURCE>,
// <TAKEFX>, <EXT>), and a second or later take is announced by a bare TAKE
// line (TAKE SEL for the active one). The first take has no such line, so
// any take-scope entry seen before one starts an implicit first take.
func splitTakes(n *node, projectFolder string) ([]Take, map[string]string) {
	var takes []Take
	var itemExt map[string]string
	var current *Take
	var currentSource *node

	finish := func() {
		if current == nil {
			return
		}
		resolveTakeSource(current, currentSource, projectFolder)
		takes = append(takes, *current)
		current, currentSource = nil, nil
	}
	start := func() {
		if current == nil {
			current = &Take{}
		}
	}

	for _, entry := range n.sequence {
		switch {
		case entry.child != nil && entry.child.tag == "EXTI":
			itemExt = extensionData(entry.child)
		case entry.key == "TAKE":
			finish()
			current = &Take{Active: len(entry.values) > 0 && entry.values[0] == "SEL"}
		case entry.child != nil && entry.child.tag == "SOURCE":
			start()
			currentSource = entry.child
		case entry.child != nil && entry.child.tag == "EXT":
			start()
			current.Ext = extensionData(entry.child)
		case entry.child != nil && entry.child.tag == "TAKEFX":
			start()
			current.HasFXChain = true
		case entry.child != nil:
			// An item- or take-level chunk this parser doesn't model yet
			// (e.g. the item's own <NOTES>).
		case entry.key == "NAME":
			start()
			current.Name = firstValue(entry.values)
		case entry.key == "SOFFS":
			start()
			current.SOFFS = parseFloatValue(entry.values)
		case entry.key == "PLAYRATE":
			start()
			current.PlayRate = parseFloatValue(entry.values)
		case entry.key == "GUID":
			start()
			current.GUID = firstValue(entry.values)
		case entry.key == "SM":
			start()
			current.StretchMarkerCount++
		default:
			// An item-level scalar (POSITION, LENGTH, MUTE, IGUID, SEL,
			// IID, VOLPAN, ...): read separately via n.attr0/n.attrs.
		}
	}
	finish()
	return takes, itemExt
}

func resolveTakeSource(take *Take, source *node, projectFolder string) {
	if source == nil {
		return
	}
	// A trimmed/offset region of a larger file wraps the real source one
	// level deeper as <SOURCE SECTION <SOURCE WAVE ...>>; unwrap it so the
	// playable file is still found, keeping the wrapper's own offsets.
	if len(source.params) > 0 && source.params[0] == "SECTION" {
		take.Section = &SectionOffsets{
			StartPos: parseFloat(source.attr0("STARTPOS")),
			Length:   parseFloat(source.attr0("LENGTH")),
			Overlap:  parseFloat(source.attr0("OVERLAP")),
		}
		if inner := source.firstChild("SOURCE"); inner != nil {
			source = inner
		}
	}
	if len(source.params) > 0 {
		take.SourceKind = source.params[0]
	}
	take.Supported = audioSourceKinds[take.SourceKind]
	if file := source.attr0("FILE"); file != "" {
		take.SourceFile = resolveSourcePath(projectFolder, file)
		if info, err := os.Stat(take.SourceFile); err == nil && !info.IsDir() {
			take.SourceAvailable = true
		}
	}
}

func firstValue(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func parseFloatValue(values []string) float64 {
	return parseFloat(firstValue(values))
}

func parseFloat(value string) float64 {
	f, _ := strconv.ParseFloat(value, 64)
	return f
}

func resolveSourcePath(projectFolder, file string) string {
	if filepath.IsAbs(file) {
		return filepath.Clean(file)
	}
	return filepath.Clean(filepath.Join(projectFolder, file))
}

// decodeColor reverses the encoding integrations/reaper/narration_bridge_core.lua's
// color() helper already uses (reaper.ColorToNative(r,g,b) + 0x1000000): a
// REAPER PEAKCOL/track color of 0, or without the 0x1000000 "custom color
// set" flag bit, means no narrator-assigned color. ColorToNative on Windows
// is the RGB() macro (COLORREF), which packs 0x00BBGGRR - red in the low
// byte, blue in the high byte.
func decodeColor(raw string) string {
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value == 0 || value&0x1000000 == 0 {
		return ""
	}
	red, green, blue := value&0xFF, (value>>8)&0xFF, (value>>16)&0xFF
	return strings.ToUpper(fmt.Sprintf("#%02x%02x%02x", red, green, blue))
}
