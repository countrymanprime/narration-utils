package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/renderconfig"
)

// The Phase 11 (per-chapter render configuration) bindings for the reaper-automation-follow-through PRD: Open
// Question 7, answered (a) - configure only. h.emitRenderConfig (app.go) relays every state change as the
// "renderconfig:state" live event, the way h.emitPickups does. The wire-contract schema, golden payloads and
// mock live in apps/ui/src/api.

// RenderConfigConfigure asks REAPER to set the render bounds to all regions, the naming pattern to the region
// name, and the output folder to outputFolder. It never renders anything: the narrator presses Render themselves
// once the resulting file names (RenderConfigState's targets, once the run succeeds) look right.
func (h *Host) RenderConfigConfigure(outputFolder string) (string, error) {
	service := h.services().renderConfig
	if service == nil {
		return "", fmt.Errorf("the render configuration service is unavailable")
	}
	return encodeBinding(map[string]any{"status": "started"}, service.Configure(outputFolder))
}

// RenderConfigSuggestFolder answers a default output folder (a "renders" subfolder of the project) for the UI to
// prefill; the narrator can change it before configuring.
func (h *Host) RenderConfigSuggestFolder() (string, error) {
	svc := h.services()
	return encodeBinding(map[string]any{"folder": renderconfig.SuggestedFolder(svc.config.projectFolder)}, nil)
}

func (h *Host) RenderConfigState() (string, error) {
	if service := h.services().renderConfig; service != nil {
		return encodeBinding(service.Snapshot(), nil)
	}
	return encodeBinding(map[string]any{
		"runId": nil, "phase": "idle", "message": "",
		"folder": "", "targets": []string{}, "count": 0,
	}, nil)
}
