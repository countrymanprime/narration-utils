package audacitybridge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// LabelInfo is one label as GetInfo: Type=Labels reports it. Index is the number SetLabel's Label parameter takes: labels are
// counted across every label track, in track order, each track's labels in time order (the spec note, "SetLabel").
type LabelInfo struct {
	Index      int
	Track      int
	Start, End float64
	Text       string
}

// TrackInfo is one track as GetInfo: Type=Tracks reports it. Start and End are only reported for audio tracks.
type TrackInfo struct {
	Index             int
	Name, Kind        string
	Selected, Focused bool
	Start, End        float64
	Channels          int
	HasRange          bool
}

// ClipInfo is one audio clip as GetInfo: Type=Clips reports it.
type ClipInfo struct {
	Track      int
	Start, End float64
	Name       string
}

// GetInfo's JSON is not always valid JSON: Audacity escapes only the double quote in a string (CommandMessageTarget::Escaped), so a
// backslash or a control character a narrator typed into a label comes out raw, and it writes booleans as the strings "true" and
// "false" (the spec note, "GetInfo JSON caveats"). repairJSON makes such text parseable without changing any valid JSON: inside a
// string, a backslash that does not start a valid escape becomes an escaped backslash and a raw control character becomes \u00XX.
func repairJSON(raw []byte) []byte {
	var out bytes.Buffer
	out.Grow(len(raw))
	inString := false
	for i := 0; i < len(raw); i++ {
		b := raw[i]
		if !inString {
			if b == '"' {
				inString = true
			}
			out.WriteByte(b)
			continue
		}
		switch {
		case b == '"':
			inString = false
			out.WriteByte(b)
		case b == '\\':
			if i+1 < len(raw) && isEscape(raw, i+1) {
				out.WriteByte(b)
				out.WriteByte(raw[i+1])
				i++
			} else {
				out.WriteString(`\\`)
			}
		case b < 0x20:
			fmt.Fprintf(&out, `\u%04x`, b)
		default:
			out.WriteByte(b)
		}
	}
	return out.Bytes()
}

func isEscape(raw []byte, i int) bool {
	switch raw[i] {
	case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
		return true
	case 'u':
		if i+4 >= len(raw) {
			return false
		}
		for _, h := range raw[i+1 : i+5] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", rune(h)) {
				return false
			}
		}
		return true
	}
	return false
}

func decodeInfo(reply Reply, into any) error {
	body := []byte(strings.Join(reply.Lines, "\n"))
	if err := json.Unmarshal(repairJSON(body), into); err != nil {
		return &ProtocolError{fmt.Sprintf("GetInfo's JSON did not parse: %v", err)}
	}
	return nil
}

// flexBool reads a boolean written as true/false, "true"/"false", or 0/1.
type flexBool bool

func (f *flexBool) UnmarshalJSON(b []byte) error {
	switch strings.Trim(string(b), `"`) {
	case "true", "1":
		*f = true
	case "false", "0", "null", "":
		*f = false
	default:
		return fmt.Errorf("not a boolean: %s", b)
	}
	return nil
}

// flexNumber reads a number written bare or as a string.
type flexNumber float64

func (f *flexNumber) UnmarshalJSON(b []byte) error {
	v, err := strconv.ParseFloat(strings.Trim(string(b), `"`), 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return fmt.Errorf("not a finite number: %s", b)
	}
	*f = flexNumber(v)
	return nil
}

// parseLabels reads GetInfo: Type=Labels Format=JSON, `[[trackIndex, [[start, end, "text"], ...]], ...]`, strictly: every entry
// must have exactly that shape, and a label's end must not come before its start.
func parseLabels(reply Reply) ([]LabelInfo, error) {
	var tracks [][]json.RawMessage
	if err := decodeInfo(reply, &tracks); err != nil {
		return nil, err
	}
	var labels []LabelInfo
	for _, entry := range tracks {
		if len(entry) != 2 {
			return nil, &ProtocolError{fmt.Sprintf("a label track entry has %d elements, want 2", len(entry))}
		}
		var track flexNumber
		if err := json.Unmarshal(entry[0], &track); err != nil || track < 0 || track != flexNumber(math.Trunc(float64(track))) {
			return nil, &ProtocolError{fmt.Sprintf("a label track index is not a whole number: %s", entry[0])}
		}
		var rows [][]json.RawMessage
		if err := json.Unmarshal(entry[1], &rows); err != nil {
			return nil, &ProtocolError{fmt.Sprintf("a label track's labels are not a list: %v", err)}
		}
		for _, row := range rows {
			if len(row) != 3 {
				return nil, &ProtocolError{fmt.Sprintf("a label has %d elements, want 3", len(row))}
			}
			var start, end flexNumber
			var text string
			if json.Unmarshal(row[0], &start) != nil || json.Unmarshal(row[1], &end) != nil || json.Unmarshal(row[2], &text) != nil {
				return nil, &ProtocolError{"a label is not [start, end, text]"}
			}
			if end < start {
				return nil, &ProtocolError{fmt.Sprintf("a label ends (%v) before it starts (%v)", end, start)}
			}
			labels = append(labels, LabelInfo{Index: len(labels), Track: int(track), Start: float64(start), End: float64(end), Text: text})
		}
	}
	return labels, nil
}

type trackJSON struct {
	Name     *string     `json:"name"`
	Kind     *string     `json:"kind"`
	Selected flexBool    `json:"selected"`
	Focused  flexBool    `json:"focused"`
	Start    *flexNumber `json:"start"`
	End      *flexNumber `json:"end"`
	Channels *flexNumber `json:"channels"`
}

// parseTracks reads GetInfo: Type=Tracks Format=JSON: a list of objects, each with at least a name and a kind.
func parseTracks(reply Reply) ([]TrackInfo, error) {
	var rows []trackJSON
	if err := decodeInfo(reply, &rows); err != nil {
		return nil, err
	}
	tracks := make([]TrackInfo, 0, len(rows))
	for i, r := range rows {
		if r.Name == nil || r.Kind == nil {
			return nil, &ProtocolError{fmt.Sprintf("track %d has no name or kind", i)}
		}
		t := TrackInfo{Index: i, Name: *r.Name, Kind: *r.Kind, Selected: bool(r.Selected), Focused: bool(r.Focused)}
		if r.Start != nil && r.End != nil {
			t.Start, t.End, t.HasRange = float64(*r.Start), float64(*r.End), true
		}
		if r.Channels != nil {
			t.Channels = int(*r.Channels)
		}
		tracks = append(tracks, t)
	}
	return tracks, nil
}

type clipJSON struct {
	Track *flexNumber `json:"track"`
	Start *flexNumber `json:"start"`
	End   *flexNumber `json:"end"`
	Name  string      `json:"name"`
}

// parseClips reads GetInfo: Type=Clips Format=JSON: a list of objects with a track, a start and an end.
func parseClips(reply Reply) ([]ClipInfo, error) {
	var rows []clipJSON
	if err := decodeInfo(reply, &rows); err != nil {
		return nil, err
	}
	clips := make([]ClipInfo, 0, len(rows))
	for i, r := range rows {
		if r.Track == nil || r.Start == nil || r.End == nil {
			return nil, &ProtocolError{fmt.Sprintf("clip %d has no track, start or end", i)}
		}
		clips = append(clips, ClipInfo{Track: int(*r.Track), Start: float64(*r.Start), End: float64(*r.End), Name: r.Name})
	}
	return clips, nil
}
