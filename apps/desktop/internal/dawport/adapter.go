// Package dawport is the one way the host reaches an audio engine (ADR 0300, DAW port PRD). An adapter per engine declares a Level
// for each Capability and returns one small role interface for each capability it has; the Resolver alone decides what is
// available now, from that declaration, the runtime state and the narrator's per-capability settings; callers get a role through
// Role[T] and never hold an adapter. Every adapter passes the conformance suite in dawporttest.
package dawport

import "github.com/countrymanprime/narration-utils/shell/internal/dawadapter"

// Kind is which engine an adapter drives. It is dawadapter's until that package is retired (DAW port PRD P8).
type Kind = dawadapter.Kind

const (
	KindNone     = dawadapter.KindNone
	KindREAPER   = dawadapter.KindREAPER
	KindAudacity = dawadapter.KindAudacity
)

// Adapter is one engine. It only declares and implements: whether a capability can be used now is the Resolver's answer, never the
// adapter's.
type Adapter interface {
	Kind() Kind
	// Declares is the most this engine can do, per capability. It is static: the same map on every call. A capability left out is
	// Unsupported.
	Declares() map[Capability]Level
	// Role is the capability's role interface (its Spec.Role), non-nil for every capability declared Experimental or Supported,
	// and nil otherwise.
	Role(c Capability) any
}

// Explainer is an adapter that words its own refusals, for example Audacity's "not available yet" sentence (ADR 0144) or REAPER's
// "open this app from the Narration Utils action in REAPER". An empty answer falls back to the resolver's wording.
type Explainer interface {
	Explain(c Capability, r Reason) string
}
