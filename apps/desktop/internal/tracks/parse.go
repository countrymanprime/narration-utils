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
		GUID:   guid,
		Index:  index,
		Name:   n.attr0("NAME"),
		Color:  decodeColor(n.attr0("PEAKCOL")),
		Muted:  muted,
		Soloed: soloed,
		Items:  itemList,
	}
}

func parseItem(n *node, projectFolder string) Item {
	position, _ := strconv.ParseFloat(n.attr0("POSITION"), 64)
	length, _ := strconv.ParseFloat(n.attr0("LENGTH"), 64)
	item := Item{Position: position, Length: length, Name: n.attr0("NAME")}

	source := n.firstChild("SOURCE")
	if source == nil {
		return item
	}
	// A trimmed/offset region of a larger file wraps the real source one
	// level deeper as <SOURCE SECTION <SOURCE WAVE ...>>; unwrap it so the
	// playable file is still found.
	if len(source.params) > 0 && source.params[0] == "SECTION" {
		if inner := source.firstChild("SOURCE"); inner != nil {
			source = inner
		}
	}
	if len(source.params) > 0 {
		item.SourceKind = source.params[0]
	}
	item.Supported = audioSourceKinds[item.SourceKind]
	if file := source.attr0("FILE"); file != "" {
		item.SourceFile = resolveSourcePath(projectFolder, file)
		if info, err := os.Stat(item.SourceFile); err == nil && !info.IsDir() {
			item.SourceAvailable = true
		}
	}
	return item
}

func resolveSourcePath(projectFolder, file string) string {
	if filepath.IsAbs(file) {
		return filepath.Clean(file)
	}
	return filepath.Clean(filepath.Join(projectFolder, file))
}

// decodeColor reverses the encoding integrations/reaper/narration_ui_bridge.lua's
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
