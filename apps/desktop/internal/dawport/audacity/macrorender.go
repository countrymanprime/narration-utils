package audacity

import (
	"context"
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// ErrNoApproval: a macro render was asked without the narrator's approval for this one render (the mastering port's Audacity row,
// ADR 0306, ADR 0460, mirroring the REAPER daw row's render_with_fx).
var ErrNoApproval = errors.New("this render needs your approval")

// ErrNoMacro: a macro render was asked with no macro name.
var ErrNoMacro = errors.New("name the macro to apply")

// macroRender is the macro_render role: it imports req.Source as a new track (never touching whatever else is open in the
// narrator's project), selects only that track, applies the narrator's chosen macro to it, and exports the result. Audacity's
// scripting reference has no command that reads a macro's own steps back, so the row that calls this names its own words for the
// narrator's report; this role only runs what was approved.
type macroRender struct{ client *audacitybridge.Client }

var _ dawport.MacroRenderer = macroRender{}

func (m macroRender) RenderWithMacro(ctx context.Context, req dawport.MacroRender) (dawport.MacroRendered, error) {
	if req.Approval == "" {
		return dawport.MacroRendered{}, ErrNoApproval
	}
	if req.Macro == "" {
		return dawport.MacroRendered{}, ErrNoMacro
	}
	if err := m.client.Import(ctx, req.Source); err != nil {
		return dawport.MacroRendered{}, err
	}
	tracks, err := m.client.Tracks(ctx)
	if err != nil {
		return dawport.MacroRendered{}, err
	}
	if len(tracks) == 0 {
		return dawport.MacroRendered{}, fmt.Errorf("audacity reports no tracks after importing %q", req.Source)
	}
	imported := tracks[len(tracks)-1]
	if err := m.client.SelectTracks(ctx, imported.Index, 1); err != nil {
		return dawport.MacroRendered{}, err
	}
	if err := m.client.ApplyMacro(ctx, req.Macro); err != nil {
		return dawport.MacroRendered{}, err
	}
	channels := imported.Channels
	if channels < 1 {
		channels = 1
	}
	if err := m.client.Export(ctx, req.OutputPath, channels); err != nil {
		return dawport.MacroRendered{}, err
	}
	return dawport.MacroRendered{Path: req.OutputPath}, nil
}
