package dawport

import (
	"fmt"
	"slices"
	"sync"
)

// Env is what the composition root hands an adapter factory for one launch. It names the engine's transport rather than holding
// it: the adapter a factory builds opens and owns its own connection, so no package outside the adapter holds one (ADR 0300,
// ADR 0303).
type Env struct {
	// SessionDir is REAPER's file bridge directory, made by NarrationUtils_Launcher.lua; empty when the launch has none.
	SessionDir string
	// Experimental is the old DAW.experimental_reaper_actions switch, which bridge.Actions still checks itself until the
	// per-capability toggles take over its gating (DAW port PRD P3). nil reads as off.
	Experimental func() bool
	// Log receives the transport's diagnostics (bridge.Client.SetLog); nil discards them.
	Log func(kind, message string)
}

// Factory builds an engine's adapter for one launch. An error means this launch cannot have that engine (a REAPER launch with no
// session directory, for example), and the composition root runs with no adapter, which the Resolver reports as standalone.
type Factory func(Env) (Adapter, error)

// Registry maps each engine's Kind to its adapter factory. The package-level Register, Lookup and Registered use the one the
// composition root reads; a test builds its own with NewRegistry.
type Registry struct {
	mu sync.RWMutex // guards factories
	// +checklocks:mu
	factories map[Kind]Factory
}

// NewRegistry is an empty registry.
func NewRegistry() *Registry { return &Registry{factories: map[Kind]Factory{}} }

var registry = NewRegistry()

// Register makes kind's factory available to the composition root, which picks one by the launch's Kind. Each adapter package
// calls it once, from init. Registering KindNone, a nil factory or a kind twice is a programming error, so it panics.
func Register(kind Kind, factory Factory) { registry.Register(kind, factory) }

// Lookup returns kind's registered factory, or false when no adapter package registered one (always false for KindNone).
func Lookup(kind Kind) (Factory, bool) { return registry.Lookup(kind) }

// Registered is every kind with a registered factory, in Kind order. The slice is the caller's own.
func Registered() []Kind { return registry.Registered() }

// Register adds kind's factory; see the package-level Register.
func (r *Registry) Register(kind Kind, factory Factory) {
	if kind == KindNone {
		panic("dawport: Register of KindNone: a launch with no engine has no adapter")
	}
	if factory == nil {
		panic(fmt.Sprintf("dawport: Register of a nil factory for %v", kind))
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, taken := r.factories[kind]; taken {
		panic(fmt.Sprintf("dawport: Register called twice for %v", kind))
	}
	r.factories[kind] = factory
}

// Lookup returns kind's factory, or false when there is none.
func (r *Registry) Lookup(kind Kind) (Factory, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	factory, ok := r.factories[kind]
	return factory, ok
}

// Registered is every kind with a factory, in Kind order. The slice is the caller's own.
func (r *Registry) Registered() []Kind {
	r.mu.RLock()
	defer r.mu.RUnlock()
	kinds := make([]Kind, 0, len(r.factories))
	for kind := range r.factories {
		kinds = append(kinds, kind)
	}
	slices.Sort(kinds)
	return kinds
}
