package main

import (
	"encoding/json"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// daw_transport_changed (DAW port PRD Phase 9, ADR 0305) tells the UI whether the DAW is playing or recording, read from the
// Heartbeat role the resolver hands out, so a consumer (input commands and pedals P10's quiet booth) no longer needs the
// click-refreshed ReadAloudReaperState.recording (ADR 0249). It is pushed only, like daw_capabilities_changed: there is no
// binding to read it, and the first tick after launch pushes the current value. The wire schema, golden payloads,
// wireContracts row and mock live in apps/ui/src/api (docs/architecture/wire-contracts.md).

// dawTransport is the payload {playing, recording, position?}: position (project seconds, as of the last heartbeat) only
// while playing or recording. With no transport to read (no DAW, the heartbeat capability unavailable or turned off, a DAW
// not answering, or an older bridge script), it is neither playing nor recording.
func (h *Host) dawTransport() map[string]any {
	svc := h.services()
	resolver, _ := dawResolverFor(svc)
	var heartbeat dawport.Heartbeat
	if svc.reachability != nil {
		heartbeat = svc.reachability
	}
	return dawTransportPayload(resolver, heartbeat)
}

func dawTransportPayload(resolver *dawport.Resolver, heartbeat dawport.Heartbeat) map[string]any {
	payload := map[string]any{"playing": false, "recording": false}
	if heartbeat == nil || !resolver.Support(dawport.CapHeartbeat).Available {
		return payload
	}
	transport, ok := heartbeat.Transport()
	if !ok {
		return payload
	}
	payload["playing"], payload["recording"] = transport.Playing, transport.Recording
	if transport.Playing || transport.Recording {
		payload["position"] = transport.Position
	}
	return payload
}

// dawTransportChanged computes the payload and reports whether it differs from the last one it saw (a marshalled JSON
// comparison, as pollDawCapabilities does), recording it as the new last one.
func (h *Host) dawTransportChanged() (map[string]any, bool) {
	payload := h.dawTransport()
	encodedBytes, err := json.Marshal(payload)
	if err != nil {
		return payload, false
	}
	encoded := string(encodedBytes)
	h.mu.Lock()
	defer h.mu.Unlock()
	changed := encoded != h.dawTransportSnapshot
	h.dawTransportSnapshot = encoded
	return payload, changed
}

// pollDawTransport is one tick of transcriptLoop (app.go): it emits daw_transport_changed only when the transport changed
// since the last tick. The bridge script sends a heartbeat at once when REAPER starts or stops playing or recording, so a
// change reaches the UI within one tick of that heartbeat.
func (h *Host) pollDawTransport() {
	payload, changed := h.dawTransportChanged()
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if changed && ctx != nil {
		emitEvent("daw_transport_changed", payload)
	}
}
