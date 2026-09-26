// Package port is the vocabulary every port shares: how far a provider supports a capability (Level), whether it can be used now and
// why not (Support, Reason), and the refusal a caller gets (NotSupportedError). The DAW port (internal/dawport) aliases these types,
// and the provider ports reuse them, so a narrator-facing refusal reads the same wherever it comes from. It is a leaf: it imports no
// other package of this module.
package port

import "errors"

// Level is how far an engine or provider supports a capability, least to most capable, so `level >= Experimental` means it has an
// implementation.
type Level int

const (
	// Unsupported: the engine cannot do this at all (Audacity has no punch-and-roll).
	Unsupported Level = iota
	// NotYetAvailable: the engine can, but this app cannot drive it yet (Audacity until its pipe client lands).
	NotYetAvailable
	// Experimental: built, but not yet through the owner's verification pass. Off unless the narrator turns it on.
	Experimental
	// Supported: verified, and on unless the narrator turns it off.
	Supported
)

func (l Level) String() string {
	switch l {
	case NotYetAvailable:
		return "not_yet_available"
	case Experimental:
		return "experimental"
	case Supported:
		return "supported"
	default:
		return "unsupported"
	}
}

// Reason is why a capability is unavailable now. The values are the wire enum the UI already switches on (standalone, not_running,
// experimental_off, failed), extended; the payload carries a Message beside it, so the UI never words a refusal itself.
type Reason string

const (
	ReasonStandalone      Reason = "standalone"       // no bridge at all: the app was opened on its own
	ReasonNotRunning      Reason = "not_running"      // a bridge, but the DAW's heartbeat has gone quiet
	ReasonExperimentalOff Reason = "experimental_off" // Experimental and left on auto while experimental actions are off
	ReasonFailed          Reason = "failed"           // the request was made and failed; never the resolver's answer, only a call's
	ReasonTurnedOff       Reason = "turned_off"       // the narrator switched this capability off
	ReasonNotYet          Reason = "not_yet"          // declared NotYetAvailable
	ReasonUnsupported     Reason = "unsupported"      // declared Unsupported, or not declared at all
)

// Support is a resolver's answer for one capability: the declared Level, whether it can be used now, and when it cannot, why
// (Reason) in the narrator's words (Message). An available capability has neither.
type Support struct {
	Level     Level
	Available bool
	Reason    Reason
	Message   string
}

// ErrNotSupported matches every *NotSupportedError under errors.Is.
var ErrNotSupported = errors.New("port: capability not available")

// NotSupportedError is a port's refusal. Its Error is Support.Message, a whole sentence for the narrator.
type NotSupportedError struct {
	Capability string
	Support    Support
}

func (e *NotSupportedError) Error() string { return e.Support.Message }

// Is matches ErrNotSupported.
func (e *NotSupportedError) Is(target error) bool { return target == ErrNotSupported }
