package masteringport

import (
	"context"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/mastering"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Builtin is the built-in chain's row name, the default.
const Builtin = "builtin"

func init() {
	Rows.Register(port.Entry[Mastering]{
		Name:       Builtin,
		Descriptor: port.Descriptor{Label: "Built-in chain (EQ, limiter, gain)", Modes: []string{ModeWAV}},
		New:        func() Mastering { return builtinChain{} },
	})
}

// builtinChain is internal/mastering's chain behind the port, unchanged: the row calls mastering.Master and reports its answer.
// mastering re-measures its written file with internal/measure and judges it with internal/deliveryprofile, which is Judge.
type builtinChain struct{}

var _ Mastering = builtinChain{}

func (builtinChain) Name() string { return Builtin }

func (builtinChain) Capabilities() Capabilities {
	return Capabilities{Level: port.Supported, Chain: []Step{
		{Name: "EQ", Detail: fmt.Sprintf("High-pass at %d Hz", mastering.HighPassHz)},
		{Name: "Limiter", Detail: fmt.Sprintf("Peaks held %.1f dB under the profile's peak limit", mastering.CeilingMargin)},
		{Name: "Gain", Detail: "Toward the profile's RMS target"},
	}}
}

func (builtinChain) Master(ctx context.Context, req Request) (Result, error) {
	res, err := mastering.Master(ctx, mastering.Request{Source: req.Source, Destination: req.Destination, Profile: req.Profile},
		mastering.Options{Progress: mastering.Progress(req.Progress)})
	if err != nil {
		return Result{}, err
	}
	before := res.Before
	return Result{
		Provider:    Builtin,
		Source:      res.Source,
		Destination: res.Destination,
		Profile:     res.Profile,
		Chain: []Step{
			{Name: "EQ", Detail: fmt.Sprintf("High-pass at %.0f Hz", res.HighPassHz)},
			{Name: "Limiter", Detail: fmt.Sprintf("Peaks held at %.1f dBFS", res.Targets.Ceiling)},
			{Name: "Gain", Detail: fmt.Sprintf("%+.1f dB, toward %.1f dBFS RMS", res.GainDB, res.Targets.RMS)},
		},
		Before:    &before,
		After:     res.After,
		Judgement: res.Judgement,
	}, nil
}
