package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/pickups"
)

// The Phase 9 (Go client and UI) bindings for the pickup list (reaper-automation-follow-through PRD): CSV parse
// and validation live in internal/pickups (never trust external data, ADR 0069's rule for anything that crosses
// into the UI applies just as much to what a narrator hands the app from disk), and h.emitPickups (app.go)
// relays every state change as the "pickups:state" live event, the way h.emitLineIdentity does for line
// identity. The wire-contract schema, golden payloads and mock live in apps/ui/src/api.

// PickupsImportResult is PickupsImport's answer: the run has started, plus every CSV row that could not be
// used (a report, never a silent drop - Phase 9's success signal).
type PickupsImportResult struct {
	Status    string   `json:"status"`
	RowErrors []string `json:"rowErrors"`
}

// PickupsImport parses and validates csvText (start,note,tag; a header row is optional) entirely in Go before
// anything is sent to REAPER. A row that cannot be used is reported, not dropped; when every row is unusable
// nothing is sent and the row report is the error.
func (h *Host) PickupsImport(csvText string) (string, error) {
	service := h.services().pickups
	if service == nil {
		return "", fmt.Errorf("the pickup list service is unavailable")
	}
	rows, issues := pickups.ParseCSV(csvText)
	rowErrors := make([]string, 0, len(issues))
	for _, issue := range issues {
		rowErrors = append(rowErrors, fmt.Sprintf("line %d: %s", issue.Line, issue.Message))
	}
	if len(rows) == 0 {
		message := "no valid pickups were found in the file"
		if len(rowErrors) > 0 {
			message += ": " + rowErrors[0]
		}
		return "", fmt.Errorf("%s", message)
	}
	return encodeBinding(PickupsImportResult{Status: "started", RowErrors: rowErrors}, service.Import(rows))
}

func (h *Host) PickupsExport() (string, error) {
	service := h.services().pickups
	if service == nil {
		return "", fmt.Errorf("the pickup list service is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Export())
}

func (h *Host) PickupsNext() (string, error) {
	service := h.services().pickups
	if service == nil {
		return "", fmt.Errorf("the pickup list service is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Next())
}

func (h *Host) PickupsResolve(position float64) (string, error) {
	service := h.services().pickups
	if service == nil {
		return "", fmt.Errorf("the pickup list service is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Resolve(position))
}

func (h *Host) PickupsCount() (string, error) {
	service := h.services().pickups
	if service == nil {
		return "", fmt.Errorf("the pickup list service is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Count())
}

func (h *Host) PickupsState() (string, error) {
	if service := h.services().pickups; service != nil {
		return encodeBinding(service.Snapshot(), nil)
	}
	return encodeBinding(map[string]any{
		"runId": nil, "phase": "idle", "message": "",
		"remaining": 0, "total": 0,
		"next": nil, "resolved": nil, "importReport": nil, "csv": "",
	}, nil)
}
