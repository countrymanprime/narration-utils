// Package audacity is the DAW port's Audacity adapter (ADR 0300; audacity-integration PRD phases 4 and 6 to 8; ADR 0355). It drives
// Audacity over its scripting pipe (internal/audacitybridge), which only Audacity 3.x with mod-script-pipe enabled has: Audacity 4.0
// has no scripting interface, so there every request reports that Audacity is not reachable.
//
// It declares Experimental exactly what it builds, until the owner's verification pass confirms it
// (docs/operations/audacity-verification-pass.md): the port's navigate role (go to and loop a time), markers role (add a label),
// and macro_render role (the mastering port's Audacity row, ADR 0306, ADR 0460: import a rendered WAV as its own track, apply the
// narrator's chosen macro to it, export the result; macrorender.go). Session carries the Audacity-only operations the port has no
// capability for yet (import findings as labels, read them back, mark one reviewed, export a chapter, write a hand-off label
// file). Every other capability stays NotYetAvailable with ADR 0144's sentence; the review workflow's session on an Audacity
// launch still refuses every request with it (UnavailableReview).
//
// Importing the package registers its factory for dawport.KindAudacity.
package audacity

import (
	"maps"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

func init() { dawport.Register(dawport.KindAudacity, Factory) }

// NotAvailableError is a DAW the suite recognises but cannot drive yet. Its text is a whole sentence for the narrator (the review
// workflow shows it as the run's message), which is why it is a type rather than an errors.New lower-case fragment.
type NotAvailableError string

func (e NotAvailableError) Error() string { return string(e) }

// ErrNotAvailable is what every capability the adapter does not build answers (ADR 0144), and what the review workflow's session
// answers on an Audacity launch.
const ErrNotAvailable = NotAvailableError("Audacity support is not available yet. This version can't read audio from Audacity or add labels to it, so open the project from REAPER to compare it.")

// UnavailableReview is the review workflow's role on an Audacity launch: comparing a recording needs the recorded audio from the
// engine, which the Audacity adapter does not build, so every request refuses with ErrNotAvailable and it never has an event.
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

// declares is the adapter's static declaration. Promoting a capability once the owner's pass has confirmed it is moving it to
// Supported here, in the PR that records the pass (ADR 0355).
var declares = func() map[dawport.Capability]dawport.Level {
	d := map[dawport.Capability]dawport.Level{}
	for _, spec := range dawport.Capabilities() {
		d[spec.Capability] = dawport.NotYetAvailable
	}
	d[dawport.CapNavigate] = dawport.Experimental
	d[dawport.CapMarkers] = dawport.Experimental
	d[dawport.CapMacroRender] = dawport.Experimental
	return d
}()

// The sentences a refusal shows the narrator.
const (
	// messageNotConnected: the host does not open the pipe from any page yet (the dashboard is PRD Phase 9), so an Audacity
	// launch's resolver has no connection.
	messageNotConnected = "Audacity isn't connected to this app yet. This part of Audacity support is still being tested."
	// messageNotReachable: the pipe is not there or not answering.
	messageNotReachable = "Audacity is not answering. Open Audacity 3 with mod-script-pipe enabled in Preferences > Modules, then try again. Audacity 4.0 has no scripting pipe."
)

// Adapter is Audacity over one pipe client.
type Adapter struct {
	client  *audacitybridge.Client
	session *Session
}

var (
	_ dawport.Adapter   = (*Adapter)(nil)
	_ dawport.Explainer = (*Adapter)(nil)
)

// Factory is the registry's Audacity factory: the Windows scripting pipe, opened on the first request. It never touches REAPER's
// session directory, even when one is passed.
func Factory(dawport.Env) (dawport.Adapter, error) {
	return New(audacitybridge.New(audacitybridge.PipeTransport(), audacitybridge.Options{})), nil
}

// New is the adapter over client.
func New(client *audacitybridge.Client) *Adapter {
	return &Adapter{client: client, session: NewSession(client)}
}

func (a *Adapter) Kind() dawport.Kind { return dawport.KindAudacity }

// Declares returns a copy of the declaration, the same on every call.
func (a *Adapter) Declares() map[dawport.Capability]dawport.Level { return maps.Clone(declares) }

// Role is the session for navigate and markers, the macro renderer for macro_render, and nil for everything else.
func (a *Adapter) Role(c dawport.Capability) any {
	switch c {
	case dawport.CapNavigate, dawport.CapMarkers:
		return a.session
	case dawport.CapMacroRender:
		return macroRender{a.client}
	default:
		return nil
	}
}

// Session is the Audacity-only operations over the same client (ADR 0355 point 4).
func (a *Adapter) Session() *Session { return a.session }

// Runtime is the resolver's view: always a connection, answering while the last request got a complete reply.
func (a *Adapter) Runtime() dawport.Runtime {
	return dawport.Runtime{Bridge: true, Reachable: a.client.Reachable()}
}

// Explain words a pipe that is missing or silent, and ADR 0144's sentence for what is not built.
func (a *Adapter) Explain(_ dawport.Capability, r dawport.Reason) string {
	switch r {
	case dawport.ReasonNotYet:
		return string(ErrNotAvailable)
	case dawport.ReasonStandalone, dawport.ReasonNotRunning:
		return messageNotReachable
	default:
		return ""
	}
}

// Declaration is Audacity's declaration with no pipe behind it: an adapter whose Role is always nil, for the host to build a
// resolver from on an Audacity launch while no page opens the pipe. It is never registered and fails the conformance suite by
// design, as reaper.Declaration does.
func Declaration() dawport.Adapter { return declaration{} }

type declaration struct{}

func (declaration) Kind() dawport.Kind                             { return dawport.KindAudacity }
func (declaration) Declares() map[dawport.Capability]dawport.Level { return maps.Clone(declares) }
func (declaration) Role(dawport.Capability) any                    { return nil }
func (declaration) Explain(_ dawport.Capability, r dawport.Reason) string {
	switch r {
	case dawport.ReasonNotYet:
		return string(ErrNotAvailable)
	case dawport.ReasonStandalone, dawport.ReasonNotRunning:
		return messageNotConnected
	default:
		return ""
	}
}
