package main

import (
	"encoding/json"

	"github.com/countrymanprime/narration-utils/shell/internal/dawadapter"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/audacity"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/reaper"
)

// DawCapabilities and its live event daw_capabilities_changed (DAW port PRD P4, ADR 0300) are the UI's one picture of what the
// launch's DAW can do right now: the adapter's declaration, the bridge's reachability, and the narrator's DAW.capability.<name>
// toggles, combined by a dawport.Resolver the same way h.actions' gate already is (P3). The wire schema, golden payloads,
// wireContracts row and mock live in apps/ui/src/api (docs/architecture/wire-contracts.md).
//
// This binding builds its own resolver rather than share h.actions' (configureLocked): that one has no Runtime input, since
// bridge.Actions never needed a reachability check (it fails on its own when REAPER is not answering, resolver.go). The
// capabilities payload does need Runtime, to report "REAPER is not answering" instead of claiming a command would work.
// P5a's registry adapters give every consumer, this one included, the same resolver; until then each caller builds its own
// over the same declaration-only adapters.

// DawCapabilities answers the launch's DAW, whether it is reachable, and every capability's level, availability and (when
// unavailable) reason and message.
func (h *Host) DawCapabilities() (string, error) {
	resolver, runtime := h.dawResolver()
	return encodeBinding(dawCapabilitiesPayload(resolver, runtime), nil)
}

// dawResolver is a fresh resolver over the launch's declaration-only adapter, the current bridge and heartbeat, and the
// settings store, built from one services() snapshot so a project switch mid-call cannot mix two projects' state. A
// dawport.Resolver holds no state of its own, so building one per call is cheap; runtime is returned alongside it so a caller
// can report the same "reachable" fact the resolver used, without a second read of the (possibly swapped) services.
func (h *Host) dawResolver() (*dawport.Resolver, dawport.Runtime) {
	return dawResolverFor(h.services())
}

// dawResolverFor is dawResolver over a snapshot the caller already holds, so a caller that also reads another service
// (bindings_daw_transport.go reads the heartbeat) sees the same project's state in both.
func dawResolverFor(svc hostServices) (*dawport.Resolver, dawport.Runtime) {
	kind := dawadapter.Classify(svc.config.daw)
	client, reach, store := svc.bridge, svc.reachability, svc.settings
	runtime := dawport.Runtime{Bridge: client != nil, Reachable: reach != nil && reach.Reachable()}
	resolver := dawport.NewResolver(dawport.ResolverConfig{
		Adapter:      dawDeclarationFor(kind),
		Runtime:      func() dawport.Runtime { return runtime },
		Toggle:       dawport.SettingsToggles(store.Effective),
		Experimental: dawport.SettingsExperimental(store.Effective),
	})
	return resolver, runtime
}

// dawDeclarationFor is the launch's adapter, declaration only: reaper.Declaration() and audacity.New() hold no transport of
// their own (the registry's live adapters do, DAW port PRD P2), and a standalone launch (KindNone) has no adapter at all,
// which the resolver reports as every capability unsupported.
func dawDeclarationFor(kind dawadapter.Kind) dawport.Adapter {
	switch kind {
	case dawadapter.KindREAPER:
		return reaper.Declaration()
	case dawadapter.KindAudacity:
		return audacity.New()
	default:
		return nil
	}
}

// dawCapabilitiesPayload is DawCapabilities' and daw_capabilities_changed's shared shape: {daw, reachable, capabilities:
// {<name>: {level, available, reason?, message?}}} (apps/ui/src/api/schemas/daw.ts).
func dawCapabilitiesPayload(resolver *dawport.Resolver, runtime dawport.Runtime) map[string]any {
	all := resolver.All()
	capabilities := make(map[string]any, len(all))
	for _, spec := range dawport.Capabilities() {
		support := all[spec.Capability]
		entry := map[string]any{"level": support.Level.String(), "available": support.Available}
		if support.Reason != "" {
			entry["reason"] = string(support.Reason)
		}
		if support.Message != "" {
			entry["message"] = support.Message
		}
		capabilities[string(spec.Capability)] = entry
	}
	return map[string]any{
		"daw":          resolver.Kind().String(),
		"reachable":    runtime.Reachable,
		"capabilities": capabilities,
	}
}

// pollDawCapabilities is one tick of transcriptLoop (app.go): it emits daw_capabilities_changed only when the resolver's
// answer actually changed since the last tick, never on every tick (DAW port PRD P4's risk table: "Resolver recomputed on
// every heartbeat is noisy" / "the event is emitted only when the computed map changes"). saveSettings also calls it
// directly right after a DAW settings save, so a toggle takes effect on the wire without waiting for the next tick.
func (h *Host) pollDawCapabilities() {
	resolver, runtime := h.dawResolver()
	payload := dawCapabilitiesPayload(resolver, runtime)
	encodedBytes, err := json.Marshal(payload)
	if err != nil {
		return
	}
	encoded := string(encodedBytes)
	h.mu.Lock()
	changed := encoded != h.dawCapabilitiesSnapshot
	h.dawCapabilitiesSnapshot = encoded
	ctx := h.ctx
	h.mu.Unlock()
	if changed && ctx != nil {
		emitEvent("daw_capabilities_changed", payload)
	}
}
