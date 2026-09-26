package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/retakelanes"
)

// The Phase 25 (retakes as fixed lanes) bindings for the reaper-automation-follow-through PRD, ADR 0147.
// h.emitRetakeLanes (app.go) relays every state change as the "retakelanes:state" live event. The wire-contract
// schemas, golden payloads and mock live in apps/ui/src/api.

// RetakeLanesList lists, from the saved REAPER project the Tracks page reads, every manuscript line whose retakes sit
// on more than one fixed lane of a track, and which lane plays.
func (h *Host) RetakeLanesList() (string, error) {
	project, err := h.tracksList()
	if err != nil {
		return "", err
	}
	return encodeBinding(retakelanes.Lines(project), nil)
}

// RetakeLanesPick asks REAPER to make the retake named by lineID and itemGUID the only lane playing on its track, in
// one undo step. Only a retake RetakeLanesList lists can be picked; nothing else in the project changes.
func (h *Host) RetakeLanesPick(lineID, itemGUID string) (string, error) {
	service := h.services().retakeLanes
	if service == nil {
		return "", fmt.Errorf("choosing a retake lane is unavailable")
	}
	project, err := h.tracksList()
	if err != nil {
		return "", err
	}
	run := h.runLog.Begin("retake_lane_pick", "line_id", lineID, "item_guid", itemGUID)
	err = service.Pick(project, lineID, itemGUID, run)
	if err != nil {
		run.End("error")
	} else {
		run.End("ok")
	}
	return encodeBinding(map[string]any{"status": "started"}, err)
}

// RetakeLanesState answers the last pick's state (idle before any).
func (h *Host) RetakeLanesState() (string, error) {
	if service := h.services().retakeLanes; service != nil {
		return encodeBinding(service.Snapshot(), nil)
	}
	return encodeBinding(retakelanes.Idle(), nil)
}
