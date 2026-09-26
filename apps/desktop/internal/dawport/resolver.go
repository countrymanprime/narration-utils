package dawport

import (
	"fmt"
	"reflect"
)

// Runtime is the engine's live state, read by the Resolver on every call.
type Runtime struct {
	// Bridge is whether there is a connection to an engine at all; false on a standalone launch.
	Bridge bool
	// Reachable is whether the engine is answering (a fresh heartbeat).
	Reachable bool
}

// ResolverConfig is the Resolver's three inputs. Each is read on every call, never cached, so a heartbeat, a settings save or a
// project switch is reflected in the next answer. Every field may be nil.
type ResolverConfig struct {
	// Adapter is the launch's engine; nil is a standalone launch with no engine, where every capability is unavailable.
	Adapter Adapter
	// Runtime is the engine's live state; nil reads as Runtime{} (no bridge).
	Runtime func() Runtime
	// Toggle is the narrator's DAW.capability.<name> setting; nil reads as ToggleAuto for every capability.
	Toggle func(Capability) Toggle
	// Experimental is the old DAW.experimental_reaper_actions switch: while it is on, every Experimental capability left on
	// ToggleAuto is on. nil reads as off.
	Experimental func() bool
}

// Resolver combines an adapter's declaration, the runtime state and the per-capability toggles into what is available now. It holds
// no state of its own, so it is safe for concurrent use as long as its inputs are.
type Resolver struct{ cfg ResolverConfig }

// NewResolver builds a resolver over cfg.
func NewResolver(cfg ResolverConfig) *Resolver { return &Resolver{cfg: cfg} }

// Kind is the adapter's engine, or KindNone with no adapter.
func (r *Resolver) Kind() Kind {
	if r.cfg.Adapter == nil {
		return KindNone
	}
	return r.cfg.Adapter.Kind()
}

// All is Support for every capability in the catalog.
func (r *Resolver) All() map[Capability]Support {
	all := make(map[Capability]Support, len(specs))
	for _, s := range specs {
		all[s.Capability] = r.Support(s.Capability)
	}
	return all
}

// Support is whether c can be used now and, when not, why. The checks run in a fixed order, so the narrator is told the first thing
// to change: what the engine declares, then the settings (as bridge.Actions.allowed refuses an experimental command before checking
// the connection), then the runtime.
func (r *Resolver) Support(c Capability) Support {
	if r.cfg.Adapter == nil {
		return r.refuse(c, Unsupported, ReasonStandalone)
	}
	spec, known := SpecOf(c)
	level := Unsupported
	if known {
		level = r.cfg.Adapter.Declares()[c]
	}
	switch level {
	case Supported, Experimental:
	case NotYetAvailable:
		return r.refuse(c, level, ReasonNotYet)
	default:
		return r.refuse(c, Unsupported, ReasonUnsupported)
	}

	switch r.toggle(c) {
	case ToggleOff:
		return r.refuse(c, level, ReasonTurnedOff)
	case ToggleOn:
	default:
		if level == Experimental && (r.cfg.Experimental == nil || !r.cfg.Experimental()) {
			return r.refuse(c, level, ReasonExperimentalOff)
		}
	}

	var rt Runtime
	if r.cfg.Runtime != nil {
		rt = r.cfg.Runtime()
	}
	if spec.Needs != NeedsNothing && !rt.Bridge {
		return r.refuse(c, level, ReasonStandalone)
	}
	if spec.Needs == NeedsRunning && !rt.Reachable {
		return r.refuse(c, level, ReasonNotRunning)
	}
	return Support{Level: level, Available: true}
}

func (r *Resolver) toggle(c Capability) Toggle {
	if r.cfg.Toggle == nil {
		return ToggleAuto
	}
	return r.cfg.Toggle(c)
}

func (r *Resolver) refuse(c Capability, level Level, reason Reason) Support {
	return Support{Level: level, Reason: reason, Message: r.message(c, reason)}
}

// The resolver's own wording, used when the adapter has none. Each is a whole sentence for the narrator.
const (
	messageTurnedOff       = "Turned off in Settings."
	messageExperimentalOff = "Experimental: switched off in Settings."
	messageNoEngine        = "No DAW is connected to this app. Open this app from your DAW to use it."
)

func (r *Resolver) message(c Capability, reason Reason) string {
	if e, ok := r.cfg.Adapter.(Explainer); ok {
		if m := e.Explain(c, reason); m != "" {
			return m
		}
	}
	label := string(c)
	if spec, ok := SpecOf(c); ok {
		label = spec.Label
	}
	daw := r.Kind().String()
	switch reason {
	case ReasonTurnedOff:
		return messageTurnedOff
	case ReasonExperimentalOff:
		return messageExperimentalOff
	case ReasonStandalone:
		if r.cfg.Adapter == nil {
			return messageNoEngine
		}
		return fmt.Sprintf("%s is not connected to this app. Open this app from %s to use it.", daw, daw)
	case ReasonNotRunning:
		return fmt.Sprintf("%s is not answering. Check that %s is open, then try again.", daw, daw)
	case ReasonNotYet:
		return fmt.Sprintf("%s is not available with %s yet.", label, daw)
	default:
		return fmt.Sprintf("%s is not something %s can do.", label, daw)
	}
}

// RoleError is an adapter breaking its own declaration: it declared a capability usable but returned no role for it, or a value
// that is not the role asked for. It is a bug, never a refusal to show the narrator, so it does not match ErrNotSupported.
type RoleError struct {
	Capability Capability
	Kind       Kind
	Got        any
	Want       reflect.Type
}

func (e *RoleError) Error() string {
	return fmt.Sprintf("dawport: the %s adapter's %s role is %T, not %v", e.Kind, e.Capability, e.Got, e.Want)
}

// Role returns c's role as T when c is available now, a *NotSupportedError when it is not, and a *RoleError when the adapter does
// not hold to its declaration. It is the port's only type assertion.
func Role[T any](r *Resolver, c Capability) (T, error) {
	var zero T
	support := r.Support(c)
	if !support.Available {
		return zero, &NotSupportedError{Capability: c, Support: support}
	}
	got := r.cfg.Adapter.Role(c)
	role, ok := got.(T)
	if !ok || got == nil {
		return zero, &RoleError{Capability: c, Kind: r.Kind(), Got: got, Want: reflect.TypeFor[T]()}
	}
	return role, nil
}
