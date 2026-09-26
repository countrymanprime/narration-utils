package dawport

import (
	"errors"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// The shared vocabulary below (Level, Reason, Support, NotSupportedError) is the part of the port the provider ports reuse. The PRD
// places it in internal/port; until that package exists it lives here, and moving it is a type alias in this file, with no caller
// change (see the PR for DAW port P1).

// Level is how far an engine supports a capability, least to most capable, so `level >= Experimental` means the adapter has a role
// for it.
type Level int

const (
	// Unsupported: the engine cannot do this at all (Audacity has no punch-and-roll).
	Unsupported Level = iota
	// NotYetAvailable: the engine can, but this app cannot drive it yet (Audacity until its pipe client lands).
	NotYetAvailable
	// Experimental: built, but not yet through the owner's REAPER verification pass. Off unless the narrator turns it on.
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
type Support struct {
	Level     Level
	Available bool
	Reason    Reason
	Message   string
}

// ErrNotSupported matches every *NotSupportedError under errors.Is.
var ErrNotSupported = errors.New("dawport: capability not available")

// NotSupportedError is Role's refusal. Its Error is Support.Message, a whole sentence for the narrator.
type NotSupportedError struct {
	Capability Capability
	Support    Support
}

func (e *NotSupportedError) Error() string { return e.Support.Message }

// Is matches ErrNotSupported and, for an experimental_off refusal, bridge.ErrExperimentalOff: today's consumers map that error to
// their "experimental_off" reason, and must keep doing so when their role comes from the resolver instead of bridge.Actions.
func (e *NotSupportedError) Is(target error) bool {
	return target == ErrNotSupported || (e.Support.Reason == ReasonExperimentalOff && target == bridge.ErrExperimentalOff)
}
