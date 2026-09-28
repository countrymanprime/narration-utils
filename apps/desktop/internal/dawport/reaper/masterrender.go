package reaper

import (
	"context"
	"errors"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// The mastering port's DAW row (ADR 0306, render-encode-master PRD Phase 9): render_with_fx and master_chain_read
// (integrations/reaper/narration_master_render.lua).

var (
	// ErrNoApproval: a render with FX was asked for without the narrator's approval, so nothing was sent.
	ErrNoApproval = errors.New("a render with FX needs your approval in the app")
	// ErrBadRender: a render with FX named no folder, no region, or a region name the bridge cannot carry, so nothing was sent.
	ErrBadRender = errors.New("a render with FX needs a folder and at least one region, each on one line")
)

// fxRenderer is the render_with_fx role: one command, answered later through the fan-out (FX_RENDER_FILE per region, then
// FX_RENDERED, or ERROR). The bridge checks the approval, the folder and the regions again, and refuses anything else.
type fxRenderer struct{ events }

func (r fxRenderer) RenderWithFX(runID string, render dawport.FXRender) error {
	if render.Approval == "" {
		return ErrNoApproval
	}
	if render.OutputFolder == "" || len(render.Regions) == 0 {
		return ErrBadRender
	}
	for _, region := range render.Regions {
		if region == "" || strings.ContainsAny(region, "\r\n") {
			return ErrBadRender
		}
	}
	return r.send("render_with_fx", runID, render.Approval, render.OutputFolder, strings.Join(render.Regions, "\n"))
}

// masterChainReader is the master_chain_read role over bridge.Actions (gated like its other experimental commands), in the DAW
// port's own shape.
type masterChainReader struct{ actions *bridge.Actions }

func (m masterChainReader) ReadMasterChain(ctx context.Context) (dawport.MasterChain, error) {
	chain, err := m.actions.ReadMasterChain(ctx)
	if err != nil {
		return dawport.MasterChain{}, err
	}
	out := dawport.MasterChain{Tracks: make([]dawport.TrackFX, 0, len(chain.Tracks)), Master: slots(chain.Master)}
	for _, track := range chain.Tracks {
		out.Tracks = append(out.Tracks, dawport.TrackFX{TrackGUID: track.TrackGUID, Name: track.Name, FX: slots(track.FX)})
	}
	return out, nil
}

func slots(in []bridge.FXSlot) []dawport.FXSlot {
	out := make([]dawport.FXSlot, 0, len(in))
	for _, slot := range in {
		out = append(out, dawport.FXSlot{Name: slot.Name, Enabled: slot.Enabled})
	}
	return out
}
