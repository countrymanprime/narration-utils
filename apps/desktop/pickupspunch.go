package main

import (
	"context"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// Punch and roll for the pickup list (booth-actions-enablement PRD Phase 3): unlike a teleprompter flag, a pickup
// marker's project time is already known (PickupsMoment.position, imported from the proofer's CSV or read back from
// REAPER), so there is no word-to-time resolution here - just the same dawport.Puncher role (CapPunch) "Punch from
// here" uses in the reader rail, so a narrator can cue REAPER up before re-recording a pickup.

// PickupsPunchResult is PickupsPunch's answer: Outcome "punched" (Cursor is where REAPER's edit cursor landed) or
// "refused" (Message says why; nothing moved).
type PickupsPunchResult struct {
	Outcome string   `json:"outcome"`
	Cursor  *float64 `json:"cursor,omitempty"`
	Message string   `json:"message,omitempty"`
}

// PickupsPunch moves REAPER's edit cursor to position minus the Teleprompter.punch_preroll_seconds setting.
func (h *Host) PickupsPunch(position float64) (string, error) {
	svc := h.services()
	if svc.dawPortResolver == nil {
		return encodeBinding(PickupsPunchResult{Outcome: "refused", Message: errNoDawConnection.Error()}, nil)
	}
	puncher, err := dawport.Role[dawport.Puncher](svc.dawPortResolver, dawport.CapPunch)
	if err != nil {
		return encodeBinding(PickupsPunchResult{Outcome: "refused", Message: err.Error()}, nil)
	}
	cursor, err := puncher.PunchTo(context.Background(), position, punchPreRoll(svc))
	if err != nil {
		return encodeBinding(PickupsPunchResult{Outcome: "refused", Message: err.Error()}, nil)
	}
	return encodeBinding(PickupsPunchResult{Outcome: "punched", Cursor: &cursor}, nil)
}
