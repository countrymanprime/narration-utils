package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/lineidentity"
)

// The Phase 6 (Go client) bindings for manuscript line identity (reaper-automation-follow-through PRD). They
// are deliberately not yet wired into apps/ui: Phase 7 owns the UI trigger, the chapter-to-track matcher
// that supplies real rows, and the wire-contract schema, golden payload and mock these results will need
// once the frontend actually calls them (docs/architecture/wire-contracts.md). Until then these three
// methods exist on Host (and bump hostAPIVersion, since they are new bindings) with no frontend caller.

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
