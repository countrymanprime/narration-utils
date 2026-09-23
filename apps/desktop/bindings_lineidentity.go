package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/lineidentity"
)

// The Phase 6 (Go client) bindings for manuscript line identity (reaper-automation-follow-through PRD). Phase 7
// wires them into apps/ui (the "Link chapters" flow): the wire-contract schema, golden payload, mock and
// wireContracts.test.ts row live in apps/ui/src/api (docs/architecture/wire-contracts.md), and h.emitLineIdentity
// (app.go) relays every state change as the "lineidentity:state" live event, the way h.emitTranscript does for
// Transcript Compare. Phase 7 also does not have a chapter-to-track matcher to call (that PRD phase, from
// teleprompter-manuscript-integration.prd.md Phase 8, does not exist yet): the UI collects a narrator-confirmed
// chapter-to-track mapping instead and supplies the rows itself; see reaper-automation-follow-through.prd.md's
// Phase 7 row.

// LineIdentityStampRow is one row of LineIdentityStamp's input: an item GUID, the manuscript entity ID it
// should carry (a paragraph or chapter ID), and that entity's current text.
type LineIdentityStampRow struct {
	ItemGUID string `json:"itemGuid"`
	LineID   string `json:"lineId"`
	Text     string `json:"text"`
}

func (h *Host) LineIdentityStamp(rows []LineIdentityStampRow, overwrite bool) (string, error) {
	service := h.services().lineIdentity
	if service == nil {
		return "", fmt.Errorf("the line-identity service is unavailable")
	}
	converted := make([]lineidentity.Row, 0, len(rows))
	for _, row := range rows {
		converted = append(converted, lineidentity.Row{ItemGUID: row.ItemGUID, LineID: row.LineID, Text: row.Text})
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Stamp(converted, overwrite))
}

func (h *Host) LineIdentityRead() (string, error) {
	service := h.services().lineIdentity
	if service == nil {
		return "", fmt.Errorf("the line-identity service is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Read())
}

func (h *Host) LineIdentityState() (string, error) {
	if service := h.services().lineIdentity; service != nil {
		return encodeBinding(service.Snapshot(), nil)
	}
	return encodeBinding(map[string]any{
		"runId": nil, "phase": "idle", "message": "",
		"stamp": map[string]any{"applied": 0, "unchanged": 0, "missingCount": 0, "conflictsCount": 0, "missing": []string{}, "conflicts": []string{}},
		"lines": []map[string]any{}, "linesRead": 0,
	}, nil)
}
