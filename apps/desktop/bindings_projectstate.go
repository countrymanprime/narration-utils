package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/projectstate"
)

// The Phase 13 (reaper-automation-follow-through PRD, "Change-driven re-compare indicator") bindings: a
// Could-tier, on-demand check of REAPER's own live edit counter (analysis-evidence-ledger PRD Open Question 12,
// answered (B)). h.emitProjectState (app.go) relays every state change as the "projectstate:state" live event,
// the way h.emitRenderConfig does. The UI side (apps/ui/src/api/schemas/projectstate.ts, the mock and the
// wireContracts.test.ts rows) is wired for the "changed since comparison" label: a comparison records its baseline
// (TranscriptState.projectChangeCount, from prepare_compare) and the Transcript page compares a later check with it.

// ProjectStateCheck asks REAPER (when it is open from this app) for its live change count and the current
// project's saved-file path. The result (ProjectStateState's changeCount, projectFile and savedModifiedAt) comes
// back once REAPER answers; with no bridge it fails immediately, so a caller can fall back to a saved-file-mtime
// basis without waiting.
func (h *Host) ProjectStateCheck() (string, error) {
	service := h.services().projectState
	if service == nil {
		return "", fmt.Errorf("the project-state service is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Check())
}

// ProjectStateChangedSince reports whether current differs from baseline (REAPER's edit counter only ever
// increases while a project stays open): a pure comparison, so a caller with its own baseline never needs a
// fresh Check just to compare two counts it already has.
func (h *Host) ProjectStateChangedSince(current, baseline int) (string, error) {
	return encodeBinding(map[string]any{"changed": projectstate.ChangedSince(current, baseline)}, nil)
}

func (h *Host) ProjectStateState() (string, error) {
	if service := h.services().projectState; service != nil {
		return encodeBinding(service.Snapshot(), nil)
	}
	return encodeBinding(map[string]any{
		"runId": nil, "phase": "idle", "message": "",
		"changeCount": nil, "projectFile": "", "savedModifiedAt": nil,
	}, nil)
}
