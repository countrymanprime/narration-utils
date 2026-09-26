package main

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/update"
)

// copyDiagnosticsWindow is the "last 30 minutes" scope (docs/prds/tool-run-logging.prd.md phase 7, Q5).
const copyDiagnosticsWindow = 30 * time.Minute

// SystemOpenLogFolder shows the run log's folder (logs/run.jsonl, host.log and logs/runs/) in the file manager, the
// way TeleprompterStop's sibling bindings already do for the update cache (update_install.go's showDownloadedUpdate).
func (h *Host) SystemOpenLogFolder() (string, error) {
	dir := filepath.Dir(h.runLog.Path())
	if h.openFolder != nil {
		return encodeBinding(nil, h.openFolder(dir))
	}
	return encodeBinding(nil, update.OpenFolder(dir))
}

// CopyDiagnosticsScope is the choice Settings offers (PRD Q5): the last run's own host and sidecar records, or
// everything from the last 30 minutes.
type CopyDiagnosticsScope string

const (
	CopyDiagnosticsLastRun   CopyDiagnosticsScope = "last_run"
	CopyDiagnosticsLast30Min CopyDiagnosticsScope = "last_30_minutes"
)

// SystemCopyDiagnostics saves scope's records as one .jsonl file in a folder the narrator chooses, and answers its
// path (the UI copies it to the clipboard, Q5). "last_run" with no run yet logged is refused rather than saving an
// empty file with nothing to show for it.
func (h *Host) SystemCopyDiagnostics(scope string) (string, error) {
	path, err := h.copyDiagnostics(CopyDiagnosticsScope(scope))
	return encodeBinding(map[string]any{"path": path}, err)
}

func (h *Host) copyDiagnostics(scope CopyDiagnosticsScope) (string, error) {
	runLogScope, err := h.diagnosticsRunlogScope(scope)
	if err != nil {
		return "", err
	}
	pick := h.pickDiagnosticsFolder
	if pick == nil {
		pick = func() (string, error) { return pickFolder("Save diagnostics to") }
	}
	folder, err := pick()
	if err != nil {
		return "", err
	}
	if folder == "" {
		return "", nil
	}
	now := time.Now
	if h.diagnosticsNow != nil {
		now = h.diagnosticsNow
	}
	dest := filepath.Join(folder, fmt.Sprintf("diagnostics-%s.jsonl", now().UTC().Format("20060102T150405")))
	if _, err := h.runLog.ExportDiagnostics(runLogScope, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func (h *Host) diagnosticsRunlogScope(scope CopyDiagnosticsScope) (runlog.DiagnosticsScope, error) {
	switch scope {
	case CopyDiagnosticsLastRun:
		runID, err := h.runLog.LastRunID()
		if err != nil {
			return runlog.DiagnosticsScope{}, err
		}
		if runID == "" {
			return runlog.DiagnosticsScope{}, fmt.Errorf("no tool has run yet in this session")
		}
		return runlog.DiagnosticsScope{RunID: runID}, nil
	case CopyDiagnosticsLast30Min:
		return runlog.DiagnosticsScope{Since: copyDiagnosticsWindow}, nil
	default:
		return runlog.DiagnosticsScope{}, fmt.Errorf("unsupported diagnostics scope %q", scope)
	}
}
