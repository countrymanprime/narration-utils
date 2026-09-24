package main

// The diagnostics bindings (diagnostics-delivery-and-cleanup-tools.prd.md Phase 6): the Delivery page's Diagnostics tab
// runs the windowed analyzers (ADR 0158) over files picked with MeasurePickFiles. The job is in diagnostics_job.go; the
// wire-contract schema, golden payloads and mock are in apps/ui/src/api. None of them reads a project service, so a
// project switch does not touch them.

// DiagnosticsAnalyze checks picked files as a job and answers it. sourceKind is raw_recording or processed_render, as
// the narrator says; it refuses anything else, a path that was not picked, more than maxMeasureFiles files, or a second
// check while one runs.
func (h *Host) DiagnosticsAnalyze(paths []string, sourceKind string) (string, error) {
	return encodeBinding(h.startDiagnostics(paths, sourceKind))
}

// DiagnosticsState answers the check: idle with the thresholds it would use, running with real progress, or how it
// ended with every file's summary and findings.
func (h *Host) DiagnosticsState() (string, error) {
	return encodeBinding(h.diagnosticsState(), nil)
}

// DiagnosticsCancel stops a running check; files already checked keep their results. With none running it changes
// nothing.
func (h *Host) DiagnosticsCancel() (string, error) {
	return encodeBinding(h.cancelDiagnostics(), nil)
}
