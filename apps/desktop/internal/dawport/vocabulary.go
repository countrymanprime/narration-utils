package dawport

import (
	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// The shared vocabulary (Level, Reason, Support and the refusal) lives in internal/port, which the provider ports reuse. The names
// below are aliases of it, so dawport's callers and the port's other users see one set of types and values.

// Level is how far an engine supports a capability, least to most capable, so `level >= Experimental` means the adapter has a role
// for it.
type Level = port.Level

const (
	Unsupported     = port.Unsupported     // the engine cannot do this at all (Audacity has no punch-and-roll)
	NotYetAvailable = port.NotYetAvailable // the engine can, but this app cannot drive it yet (Audacity until its pipe client lands)
	Experimental    = port.Experimental    // built, not yet through the owner's REAPER verification pass; off unless turned on
	Supported       = port.Supported       // verified, and on unless the narrator turns it off
)

// Reason is why a capability is unavailable now: the wire enum the UI switches on. See port.Reason for each value.
type Reason = port.Reason

const (
	ReasonStandalone      = port.ReasonStandalone
	ReasonNotRunning      = port.ReasonNotRunning
	ReasonExperimentalOff = port.ReasonExperimentalOff
	ReasonFailed          = port.ReasonFailed
	ReasonTurnedOff       = port.ReasonTurnedOff
	ReasonNotYet          = port.ReasonNotYet
	ReasonUnsupported     = port.ReasonUnsupported
)

// Toggle is the narrator's per-capability setting, DAW.capability.<name>.
type Toggle string

const (
	// ToggleAuto (and any value this build does not know, including empty): on when Supported; when Experimental, on only while
	// the old "Experimental REAPER actions" switch is on.
	ToggleAuto Toggle = "auto"
	ToggleOn   Toggle = "on"
	ToggleOff  Toggle = "off"
)

// Support is the resolver's answer for one capability: the declared Level, whether it can be used now, and when it cannot, why
// (Reason) in the narrator's words (Message). An available capability has neither.
type Support = port.Support

// ErrNotSupported matches every *NotSupportedError, and every *port.NotSupportedError, under errors.Is.
var ErrNotSupported = port.ErrNotSupported

// NotSupportedError is Role's refusal. Its Error is Support.Message, a whole sentence for the narrator. It is dawport's own type, not
// an alias of port.NotSupportedError, for two reasons: its Capability is a dawport.Capability, and its Is also matches
// bridge.ErrExperimentalOff, which port (a leaf shared with the provider ports) must not import. It unwraps to the
// port.NotSupportedError, so errors.As and errors.Is work with either package's names.
type NotSupportedError struct {
	Capability Capability
	Support    Support
}

func (e *NotSupportedError) Error() string { return e.Support.Message }

// Unwrap is the same refusal in port's vocabulary.
func (e *NotSupportedError) Unwrap() error {
	return &port.NotSupportedError{Capability: string(e.Capability), Support: e.Support}
}

// Is matches, for an experimental_off refusal, bridge.ErrExperimentalOff: today's consumers map that error to their
// "experimental_off" reason, and must keep doing so when their role comes from the resolver instead of bridge.Actions. It matches
// ErrNotSupported through Unwrap.
func (e *NotSupportedError) Is(target error) bool {
	return e.Support.Reason == ReasonExperimentalOff && target == bridge.ErrExperimentalOff
}
