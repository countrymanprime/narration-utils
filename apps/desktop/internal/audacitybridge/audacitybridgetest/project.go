package audacitybridgetest

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Label is one label on a label track, in project seconds.
type Label struct {
	Start, End float64
	Text       string
}

// Track is one track. Kind is "wave" or "label"; only a label track has labels.
type Track struct {
	Name       string
	Kind       string
	Selected   bool
	Start, End float64
	Labels     []Label
}

// Export is one Export2 the fake took: the file and the selection it would have written.
type Export struct {
	Filename    string
	NumChannels int
	Start, End  float64
}

// Project is the fake's state. Tests read and set it through Server.With.
type Project struct {
	Tracks                    []Track
	SelStart, SelEnd          float64
	Playing, Looping          bool
	Exports                   []Export
	Imported                  []string
	MacrosApplied             []string
	Opened, Saved             string
	LoopStart, LoopEnd        float64
	RejectExportsWithoutAudio bool
	// NoProject makes every command answer as Audacity does with no project window open: a bare empty line.
	NoProject bool
}

// NewProject is an empty project.
func NewProject() *Project { return &Project{RejectExportsWithoutAudio: true} }

// AddWaveTrack adds an audio track spanning [start, end].
func (p *Project) AddWaveTrack(name string, start, end float64) {
	p.Tracks = append(p.Tracks, Track{Name: name, Kind: "wave", Start: start, End: end})
}

// AddLabelTrack adds a label track holding labels (kept sorted by start, as Audacity keeps them).
func (p *Project) AddLabelTrack(name string, labels ...Label) {
	t := Track{Name: name, Kind: "label", Labels: append([]Label(nil), labels...)}
	sortLabels(t.Labels)
	p.Tracks = append(p.Tracks, t)
}

// AllLabels is every label, in the order SetLabel numbers them: label tracks in track order, each sorted by time.
func (p *Project) AllLabels() []Label {
	var all []Label
	for _, t := range p.Tracks {
		all = append(all, t.Labels...)
	}
	return all
}

func sortLabels(ls []Label) {
	sort.SliceStable(ls, func(i, j int) bool { return ls[i].Start < ls[j].Start })
}

// handle runs one command line and returns the reply body and whether it succeeded.
func (p *Project) handle(line string) ([]string, bool) {
	cmd, err := ParseCommand(line)
	if err != nil {
		return strings.Split(err.Error(), "\n"), false
	}
	switch cmd.Name {
	case "Message":
		return []string{cmd.Params["Text"]}, true
	case "GetInfo":
		return p.getInfo(cmd)
	case "SelectTime":
		return p.selectTime(cmd)
	case "SelectTracks":
		return p.selectTracks(cmd)
	case "SelectNone":
		p.SelStart, p.SelEnd = 0, 0
		for i := range p.Tracks {
			p.Tracks[i].Selected = false
		}
		return nil, true
	case "AddLabel":
		return p.addLabel()
	case "SetLabel":
		return p.setLabel(cmd)
	case "Play":
		p.Playing = true
		return nil, true
	case "Stop":
		p.Playing, p.Looping = false, false
		return nil, true
	case "PlayAtSpeedLooped":
		p.Playing, p.Looping = true, true
		p.LoopStart, p.LoopEnd = p.SelStart, p.SelEnd
		return nil, true
	case "SetTrackStatus":
		index, err := number(cmd, "Track", 0)
		if err != nil || int(index) >= len(p.Tracks) {
			return []string{"Track is out of range."}, false
		}
		if name, ok := cmd.Params["Name"]; ok {
			p.Tracks[int(index)].Name = name
		}
		return nil, true
	case "Export2":
		return p.export(cmd)
	case "Import2":
		name := cmd.Params["Filename"]
		if name == "" {
			return []string{"Import2 needs a Filename."}, false
		}
		p.Imported = append(p.Imported, name)
		p.AddWaveTrack(strings.TrimSuffix(filepath.Base(name), filepath.Ext(name)), 0, 1)
		return nil, true
	case "ApplyMacro":
		name := cmd.Params["MacroName"]
		if name == "" {
			return []string{"ApplyMacro needs a MacroName."}, false
		}
		p.MacrosApplied = append(p.MacrosApplied, name)
		return nil, true
	case "OpenProject2":
		p.Opened = cmd.Params["Filename"]
		return nil, true
	case "SaveProject2":
		p.Saved = cmd.Params["Filename"]
		return nil, true
	default:
		return []string{fmt.Sprintf("Your batch command of %s was not recognized.", cmd.Name)}, false
	}
}

func number(cmd Parsed, key string, fallback float64) (float64, error) {
	v, ok := cmd.Params[key]
	if !ok {
		return fallback, nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, audacityText(fmt.Sprintf("Could not parse %s=%s", key, v))
	}
	return f, nil
}

func (p *Project) getInfo(cmd Parsed) ([]string, bool) {
	if f := cmd.Params["Format"]; f != "" && f != "JSON" {
		return []string{"The fake only answers Format=JSON."}, false
	}
	var v any
	switch cmd.Params["Type"] {
	case "Labels":
		// [[trackIndex, [[start, end, "text"], ...]], ...]: one entry per label track, numbered among all tracks.
		out := []any{}
		for i, t := range p.Tracks {
			if t.Kind != "label" {
				continue
			}
			ls := []any{}
			for _, l := range t.Labels {
				ls = append(ls, []any{l.Start, l.End, l.Text})
			}
			out = append(out, []any{i, ls})
		}
		v = out
	case "Tracks":
		out := []map[string]any{}
		for _, t := range p.Tracks {
			row := map[string]any{"name": t.Name, "focused": 0, "selected": boolInt(t.Selected), "kind": t.Kind}
			if t.Kind == "wave" {
				row["start"], row["end"], row["pan"], row["gain"], row["channels"], row["solo"], row["mute"] = t.Start, t.End, 0, 1, 1, 0, 0
			}
			out = append(out, row)
		}
		v = out
	case "Clips":
		out := []map[string]any{}
		for i, t := range p.Tracks {
			if t.Kind == "wave" {
				out = append(out, map[string]any{"track": i, "start": t.Start, "end": t.End, "color": 0, "name": t.Name})
			}
		}
		v = out
	default:
		return []string{fmt.Sprintf("The fake does not answer GetInfo Type=%s.", cmd.Params["Type"])}, false
	}
	b, _ := json.MarshalIndent(v, "", " ")
	return strings.Split(string(b), "\n"), true
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (p *Project) selectTime(cmd Parsed) ([]string, bool) {
	if rel := cmd.Params["RelativeTo"]; rel != "" && rel != "ProjectStart" {
		return []string{"The fake only selects RelativeTo=ProjectStart."}, false
	}
	start, err := number(cmd, "Start", p.SelStart)
	if err != nil {
		return []string{err.Error()}, false
	}
	end, err := number(cmd, "End", p.SelEnd)
	if err != nil {
		return []string{err.Error()}, false
	}
	if end < start {
		start, end = end, start
	}
	p.SelStart, p.SelEnd = start, end
	return nil, true
}

func (p *Project) selectTracks(cmd Parsed) ([]string, bool) {
	first, err := number(cmd, "Track", 0)
	if err != nil {
		return []string{err.Error()}, false
	}
	count, err := number(cmd, "TrackCount", 1)
	if err != nil {
		return []string{err.Error()}, false
	}
	mode := cmd.Params["Mode"]
	if mode == "" {
		mode = "Set"
	}
	for i := range p.Tracks {
		in := float64(i) >= first && float64(i) < first+count
		switch mode {
		case "Set":
			p.Tracks[i].Selected = in
		case "Add":
			p.Tracks[i].Selected = p.Tracks[i].Selected || in
		case "Remove":
			p.Tracks[i].Selected = p.Tracks[i].Selected && !in
		default:
			return []string{"Unknown Mode " + mode}, false
		}
	}
	return nil, true
}

// addLabel adds an empty label at the selection to the first selected label track, creating a label track when none is selected,
// as Edit > Labels > Add Label at Selection does.
func (p *Project) addLabel() ([]string, bool) {
	target := -1
	for i, t := range p.Tracks {
		if t.Kind == "label" && t.Selected {
			target = i
			break
		}
	}
	if target < 0 {
		p.Tracks = append(p.Tracks, Track{Name: "Label", Kind: "label", Selected: true})
		target = len(p.Tracks) - 1
	}
	t := &p.Tracks[target]
	t.Labels = append(t.Labels, Label{Start: p.SelStart, End: p.SelEnd})
	sortLabels(t.Labels)
	return nil, true
}

func (p *Project) setLabel(cmd Parsed) ([]string, bool) {
	index, err := number(cmd, "Label", 0)
	if err != nil {
		return []string{err.Error()}, false
	}
	n := int(index)
	for ti := range p.Tracks {
		t := &p.Tracks[ti]
		if n < len(t.Labels) {
			l := &t.Labels[n]
			if text, ok := cmd.Params["Text"]; ok {
				l.Text = text
			}
			if l.Start, err = number(cmd, "Start", l.Start); err != nil {
				return []string{err.Error()}, false
			}
			if l.End, err = number(cmd, "End", l.End); err != nil {
				return []string{err.Error()}, false
			}
			sortLabels(t.Labels)
			return nil, true
		}
		n -= len(t.Labels)
	}
	return []string{fmt.Sprintf("LabelIndex %d is out of range.", int(index))}, false
}

func (p *Project) export(cmd Parsed) ([]string, bool) {
	name := cmd.Params["Filename"]
	if name == "" {
		return []string{"Export2 needs a Filename."}, false
	}
	channels, err := number(cmd, "NumChannels", 1)
	if err != nil {
		return []string{err.Error()}, false
	}
	hasAudio := false
	for _, t := range p.Tracks {
		if t.Kind == "wave" {
			hasAudio = true
		}
	}
	if !hasAudio && p.RejectExportsWithoutAudio {
		return []string{"There is no audio to export."}, false
	}
	p.Exports = append(p.Exports, Export{Filename: name, NumChannels: int(channels), Start: p.SelStart, End: p.SelEnd})
	return nil, true
}
