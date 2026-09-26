// Package audacity is the DAW port's Audacity adapter (ADR 0300, DAW port PRD P2) as a declaration only: until the Audacity pipe
// client exists (audacity-integration PRD P4, gated on the owner's mod-script-pipe spike), every capability is NotYetAvailable,
// no role is implemented, and every refusal is ADR 0144's sentence. The pipe client's phase moves each capability it implements to
// Experimental here and returns its role; no caller changes.
//
// Importing the package registers its factory for dawport.KindAudacity.
package audacity

import (
	"maps"

	"github.com/countrymanprime/narration-utils/shell/internal/dawadapter"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

func init() { dawport.Register(dawport.KindAudacity, Factory) }

// Adapter is Audacity, which this app cannot drive yet.
type Adapter struct {
	declares map[dawport.Capability]dawport.Level
}

var (
	_ dawport.Adapter   = (*Adapter)(nil)
	_ dawport.Explainer = (*Adapter)(nil)
)

// Factory is the registry's Audacity factory. It opens nothing: an Audacity launch never writes REAPER bridge commands, even when a
// session directory is passed.
func Factory(dawport.Env) (dawport.Adapter, error) { return New(), nil }

// New is the declaration-only adapter.
func New() *Adapter {
	declares := map[dawport.Capability]dawport.Level{}
	for _, spec := range dawport.Capabilities() {
		declares[spec.Capability] = dawport.NotYetAvailable
	}
	return &Adapter{declares: declares}
}

func (a *Adapter) Kind() dawport.Kind { return dawport.KindAudacity }

// Declares is every capability NotYetAvailable, a fresh copy on every call.
func (a *Adapter) Declares() map[dawport.Capability]dawport.Level {
	return maps.Clone(a.declares)
}

// Role is nil for everything: nothing is implemented yet.
func (a *Adapter) Role(dawport.Capability) any { return nil }

// Explain words every refusal as ADR 0144 does, the sentence an Audacity launch's review workflow already shows. The resolver
// refuses on the declaration first, so not_yet is the only reason it asks about.
func (a *Adapter) Explain(dawport.Capability, dawport.Reason) string {
	return string(dawadapter.ErrAudacityNotAvailable)
}
