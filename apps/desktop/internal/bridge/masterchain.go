package bridge

import (
	"context"
	"errors"
)

// The mastering port's DAW row (ADR 0306, render-encode-master PRD Phase 9) reads the chain a render with FX would run before the
// narrator approves it: master_chain_read (integrations/reaper/narration_master_render.lua). The render itself, render_with_fx,
// answers later through the client's fan-out (FX_RENDER_FILE, FX_RENDERED), so it is not one of Actions' requests.

// MasterTrackGUID is how master_chain_read names the master track in MASTER_CHAIN_FX.
const MasterTrackGUID = "master"

// ErrChainTooLong: REAPER listed only part of the project's FX, so the chain cannot be shown whole before a render is approved.
var ErrChainTooLong = errors.New("this project has more FX than this app can list, so it cannot show you the whole chain before a render")

// MasterChain is the FX a render with FX runs, in chain order: every track that has FX, then the master track's.
type MasterChain struct {
	Tracks []TrackFX
	Master []FXSlot
}

// TrackFX is one track's FX chain.
type TrackFX struct {
	TrackGUID string
	Name      string
	FX        []FXSlot
}

// FXSlot is one plug-in in a chain, as REAPER names it, and whether it is switched on.
type FXSlot struct {
	Name    string
	Enabled bool
}

// ReadMasterChain lists every track's FX and the master track's. It changes nothing. A list REAPER cut short is ErrChainTooLong.
func (a *Actions) ReadMasterChain(ctx context.Context) (MasterChain, error) {
	events, err := a.request(ctx, "master_chain_read", []string{"MASTER_CHAIN_READ"})
	if err != nil {
		return MasterChain{}, err
	}
	chain := MasterChain{Tracks: []TrackFX{}, Master: []FXSlot{}}
	for _, event := range events {
		switch event.Tag {
		case "MASTER_CHAIN_FX":
			guid, name := event.Fields[2], event.Fields[3]
			slot := FXSlot{Name: event.Fields[4], Enabled: event.Fields[5] == "1"}
			switch {
			case guid == MasterTrackGUID:
				chain.Master = append(chain.Master, slot)
			case len(chain.Tracks) > 0 && chain.Tracks[len(chain.Tracks)-1].TrackGUID == guid:
				last := &chain.Tracks[len(chain.Tracks)-1]
				last.FX = append(last.FX, slot)
			default:
				chain.Tracks = append(chain.Tracks, TrackFX{TrackGUID: guid, Name: name, FX: []FXSlot{slot}})
			}
		case "MASTER_CHAIN_READ":
			if event.Fields[3] == "1" {
				return MasterChain{}, ErrChainTooLong
			}
		}
	}
	return chain, nil
}
