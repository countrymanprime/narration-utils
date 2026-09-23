package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/cleanuptools"
)

// The Phase 23 (cleanup launchers) bindings for the reaper-automation-follow-through PRD, ADR 0146. h.emitCleanupTools
// (app.go) relays every state change as the "cleanuptools:state" live event. The wire-contract schema, golden payloads
// and mock live in apps/ui/src/api.

// CleanupToolsLaunch asks REAPER to open an allow-listed cleanup tool (cleanuptools.Tools: "repair_pops_clicks" or
// "magnolius_declick") on the selected items. It changes nothing itself; the dialog it opens is the narrator's.
func (h *Host) CleanupToolsLaunch(tool string) (string, error) {
	service := h.services().cleanupTools
	if service == nil {
		return "", fmt.Errorf("the cleanup launcher is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Launch(tool))
}

// CleanupToolsState answers the last launch's state (idle before any).
func (h *Host) CleanupToolsState() (string, error) {
	if service := h.services().cleanupTools; service != nil {
		return encodeBinding(service.Snapshot(), nil)
	}
	return encodeBinding(cleanuptools.Idle(), nil)
}
