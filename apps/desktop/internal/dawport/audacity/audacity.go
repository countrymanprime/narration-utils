// Package audacity is the DAW port's Audacity adapter (ADR 0300, DAW port PRD P2) as a declaration only: until the Audacity pipe
// client exists (audacity-integration PRD P4, gated on the owner's mod-script-pipe spike), every capability is NotYetAvailable,
// no role is implemented, and every refusal is ADR 0144's sentence. The pipe client's phase moves each capability it implements to
// Experimental here and returns its role; no caller changes.
//
// Importing the package registers its factory for dawport.KindAudacity.
package audacity

import (
	"maps"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

func init() { dawport.Register(dawport.KindAudacity, Factory) }

// NotAvailableError is a DAW the suite recognises but cannot drive yet. Its text is a whole sentence for the narrator (the review
// workflow shows it as the run's message), which is why it is a type rather than an errors.New lower-case fragment.
type NotAvailableError string

func (e NotAvailableError) Error() string { return string(e) }

// ErrNotAvailable is what every request answers on an Audacity launch until the Audacity pipe client exists (audacity-integration
// PRD Phase 4, gated on the owner's mod-script-pipe spike S-A1). ADR 0144.
const ErrNotAvailable = NotAvailableError("Audacity support is not available yet. This version can't read audio from Audacity or add labels to it, so open the project from REAPER to compare it.")

// UnavailableReview is the review workflow's role on an Audacity launch until the pipe client exists: every request refuses with
// ErrNotAvailable, and it never has an event to deliver.
func UnavailableReview() dawport.ReviewSession { return unavailableReview{} }

type unavailableReview struct{}

var _ dawport.ReviewSession = unavailableReview{}

func (unavailableReview) Subscribe(dawport.Subscription) (unsubscribe func()) { return func() {} }
func (unavailableReview) Dispatch() error                                     { return nil }
func (unavailableReview) PrepareReview(string, string) error                  { return ErrNotAvailable }
func (unavailableReview) InspectFindings(string, string) error                { return ErrNotAvailable }
func (unavailableReview) NavigateToFinding(string, string) error              { return ErrNotAvailable }
func (unavailableReview) ExportFindings(string, string, dawport.MarkerColors) error {
	return ErrNotAvailable
}

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
	return string(ErrNotAvailable)
}
