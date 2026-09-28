package audacitybridge

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

// The typed commands the adapter uses, one method per scripting command (the spec note, "Commands"). Each builds its command
// through Command's guarded setters, so a value the syntax cannot carry is refused before anything is written to the pipe.

// pingText is what Ping asks Audacity to echo back.
const pingText = "narration-utils ping"

// Ping asks Audacity to echo a fixed text (Message: Text=...) and checks the echo, which proves the pipe is in step. It changes
// nothing in the project.
func (c *Client) Ping(ctx context.Context) error {
	reply, err := c.Do(ctx, NewCommand("Message").String("Text", pingText))
	if err != nil {
		return err
	}
	if len(reply.Lines) != 1 || reply.Lines[0] != pingText {
		return &ProtocolError{fmt.Sprintf("Message echoed %q, want %q", reply.Text(), pingText)}
	}
	return nil
}

func getInfo(kind string) *Command {
	return NewCommand("GetInfo").Choice("Type", kind).Choice("Format", "JSON")
}

// Labels reads every label in the open project (GetInfo: Type=Labels Format=JSON). Times come back with about six significant
// digits (audacity/audacity#4220), so a caller matches a label by the identity in its text, never by an exact time.
func (c *Client) Labels(ctx context.Context) ([]LabelInfo, error) {
	reply, err := c.Do(ctx, getInfo("Labels"))
	if err != nil {
		return nil, err
	}
	return parseLabels(reply)
}

// Tracks reads the open project's tracks (GetInfo: Type=Tracks Format=JSON).
func (c *Client) Tracks(ctx context.Context) ([]TrackInfo, error) {
	reply, err := c.Do(ctx, getInfo("Tracks"))
	if err != nil {
		return nil, err
	}
	return parseTracks(reply)
}

// Clips reads the open project's audio clips (GetInfo: Type=Clips Format=JSON).
func (c *Client) Clips(ctx context.Context) ([]ClipInfo, error) {
	reply, err := c.Do(ctx, getInfo("Clips"))
	if err != nil {
		return nil, err
	}
	return parseClips(reply)
}

// SelectTime sets the time selection to [start, end] in project seconds; start == end puts the cursor at start
// (SelectTime: Start End RelativeTo=ProjectStart). Audacity has no SetCursor command.
func (c *Client) SelectTime(ctx context.Context, start, end float64) error {
	if start < 0 || end < start {
		return fmt.Errorf("%w: a selection from %v to %v", ErrInvalidValue, start, end)
	}
	_, err := c.Do(ctx, NewCommand("SelectTime").Float("Start", start).Float("End", end).Choice("RelativeTo", "ProjectStart"))
	return err
}

// SelectTracks makes exactly count tracks from first (0-based) the selected ones (SelectTracks: Track TrackCount Mode=Set).
func (c *Client) SelectTracks(ctx context.Context, first, count int) error {
	if first < 0 || count < 1 {
		return fmt.Errorf("%w: tracks %d to %d", ErrInvalidValue, first, first+count-1)
	}
	_, err := c.Do(ctx, NewCommand("SelectTracks").Int("Track", first).Int("TrackCount", count).Choice("Mode", "Set"))
	return err
}

// SelectNone clears the time selection and deselects every track (SelectNone:), so the next AddLabel makes a new label track
// rather than adding to one the narrator had selected.
func (c *Client) SelectNone(ctx context.Context) error {
	_, err := c.Do(ctx, NewCommand("SelectNone"))
	return err
}

// AddLabel adds an empty label at the selection, on the selected label track, or on a new label track when none is selected
// (AddLabel:, which takes no parameters). Find it afterwards with Labels and name it with SetLabel.
func (c *Client) AddLabel(ctx context.Context) error {
	_, err := c.Do(ctx, NewCommand("AddLabel"))
	return err
}

// LabelEdit is what SetLabel changes; a nil field is left as it is.
type LabelEdit struct {
	Text       *string
	Start, End *float64
}

// SetLabel changes the label numbered index (LabelInfo.Index) (SetLabel: Label Text Start End).
func (c *Client) SetLabel(ctx context.Context, index int, edit LabelEdit) error {
	if index < 0 {
		return fmt.Errorf("%w: label %d", ErrInvalidValue, index)
	}
	cmd := NewCommand("SetLabel").Int("Label", index)
	if edit.Text != nil {
		cmd.String("Text", *edit.Text)
	}
	if edit.Start != nil {
		cmd.Float("Start", *edit.Start)
	}
	if edit.End != nil {
		cmd.Float("End", *edit.End)
	}
	_, err := c.Do(ctx, cmd)
	return err
}

// SetTrackName renames one track (SetTrackStatus: Track Name).
func (c *Client) SetTrackName(ctx context.Context, track int, name string) error {
	if track < 0 {
		return fmt.Errorf("%w: track %d", ErrInvalidValue, track)
	}
	_, err := c.Do(ctx, NewCommand("SetTrackStatus").Int("Track", track).String("Name", name))
	return err
}

// Play starts playback from the cursor or the selection (Play:).
func (c *Client) Play(ctx context.Context) error {
	_, err := c.Do(ctx, NewCommand("Play"))
	return err
}

// Stop stops playback or recording (Stop:). Stopping when nothing plays is not an error.
func (c *Client) Stop(ctx context.Context) error {
	_, err := c.Do(ctx, NewCommand("Stop"))
	return err
}

// PlayLooped loops the current selection at the Play-at-Speed toolbar's speed (PlayAtSpeedLooped:, "Loop Play-at-Speed", the one
// loop command the scripting reference lists). It is chosen over TogglePlayRegion, which only flips a state the client cannot read
// and misbehaves when scripted (audacity/audacity#3326).
func (c *Client) PlayLooped(ctx context.Context) error {
	_, err := c.Do(ctx, NewCommand("PlayAtSpeedLooped"))
	return err
}

// ExportFormats are the extensions Export may write. Export2 picks the exporter from the file's extension, and one exporter,
// "(external program)" (ID CL), runs a command line from Audacity's preferences (the launcher feasibility note), so an extension
// outside this list is refused rather than handed to Audacity.
var ExportFormats = []string{".wav", ".flac", ".mp3", ".ogg", ".aiff", ".aif"}

// Export writes the selection (or the whole project when nothing is selected) to path, with channels channels
// (Export2: Filename NumChannels). Audacity may ask before overwriting a file, which would hold the answer back until the
// timeout, so the adapter always exports to a name that does not exist yet.
func (c *Client) Export(ctx context.Context, path string, channels int) error {
	if err := checkExtension(path, ExportFormats); err != nil {
		return err
	}
	if channels < 1 || channels > 2 {
		return fmt.Errorf("%w: %d channels", ErrInvalidValue, channels)
	}
	_, err := c.Do(ctx, NewCommand("Export2").Path("Filename", path).Int("NumChannels", channels))
	return err
}

// ImportFormats are the extensions Import may read: audio only. A label file has no scripting import (the spec note), so labels
// are added one at a time with AddLabel and SetLabel.
var ImportFormats = []string{".wav", ".flac", ".mp3", ".ogg", ".aiff", ".aif"}

// Import adds a file's audio to the project as new tracks (Import2: Filename).
func (c *Client) Import(ctx context.Context, path string) error {
	if err := checkExtension(path, ImportFormats); err != nil {
		return err
	}
	_, err := c.Do(ctx, NewCommand("Import2").Path("Filename", path))
	return err
}

// OpenProject opens an Audacity project file (OpenProject2: Filename AddToHistory=0). Only .aup3 is accepted.
func (c *Client) OpenProject(ctx context.Context, path string) error {
	if err := checkExtension(path, []string{".aup3"}); err != nil {
		return err
	}
	_, err := c.Do(ctx, NewCommand("OpenProject2").Path("Filename", path).Bool("AddToHistory", false))
	return err
}

func checkExtension(path string, allowed []string) error {
	ext := strings.ToLower(filepath.Ext(strings.ReplaceAll(path, `\`, "/")))
	for _, a := range allowed {
		if ext == a {
			return nil
		}
	}
	return fmt.Errorf("%w: %q is not one of %s", ErrInvalidValue, ext, strings.Join(allowed, ", "))
}
