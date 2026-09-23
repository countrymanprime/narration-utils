package main

// The measurement bindings (diagnostics-delivery-and-cleanup-tools.prd.md Phase 1, ADR 0156). The job is in
// measure_job.go; the wire-contract schema, golden payloads and mock are in apps/ui/src/api. None of them reads a
// project service, so a project switch does not touch them.

// MeasurePickFiles opens the operating system's picker for the audio files to measure and answers the chosen paths
// (none when the narrator closes it). Only paths chosen here can be measured.
func (h *Host) MeasurePickFiles() (string, error) {
	return encodeBinding(h.pickMeasureFiles())
}

// MeasureAnalyze measures picked files as a job and answers it; it refuses a path that was not picked, more than
// maxMeasureFiles files, or a second measurement while one runs.
func (h *Host) MeasureAnalyze(paths []string) (string, error) {
	return encodeBinding(h.startMeasure(paths))
}

// MeasureState answers the measurement job: idle, running with real progress, or how it ended with every file's result.
func (h *Host) MeasureState() (string, error) {
	return encodeBinding(h.measureState(), nil)
}

// MeasureCancel stops a running measurement; files already measured keep their results. With none running it changes
// nothing.
func (h *Host) MeasureCancel() (string, error) {
	return encodeBinding(h.cancelMeasure(), nil)
}
