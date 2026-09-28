package masteringport

import (
	"context"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// DAW is the row that masters with the project's own track and master FX, in the DAW.
const DAW = "daw"

const dawLabel = "Your DAW's FX chain"

func init() {
	Rows.Register(port.Entry[Mastering]{
		Name:       DAW,
		Descriptor: port.Descriptor{Label: dawLabel, Modes: []string{ModeDAWRegion}},
		New:        func() Mastering { return dawChain{} },
	})
}

// dawChain is the DAW row, declared and not yet built (ADR 0306). When the REAPER phase builds it, Master will: ask the DAW port's
// resolver for the launch's render_with_fx role; make an empty folder for the run inside the app's project folder; ask the engine to
// render req.Region through its FX there, carrying req.Approved; wait for the rendered file; and move it to req.Destination as the
// built-in chain does. It then answers Judge's verdict on that file, never a level the DAW reports. master_chain_read lets the UI
// show the chain before the narrator approves it.
type dawChain struct{}

var _ Mastering = dawChain{}

func (dawChain) Name() string { return DAW }

func (dawChain) Capabilities() Capabilities {
	return Capabilities{
		Level:         port.NotYetAvailable,
		NeedsApproval: true,
		Needs:         []dawport.Capability{dawport.CapRenderWithFX, dawport.CapMasterChainRead},
	}
}

func (dawChain) Master(context.Context, Request) (Result, error) {
	return Result{}, NotYetAvailable(DAW, dawLabel)
}
