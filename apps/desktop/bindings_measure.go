package main

// The measurement bindings (diagnostics-delivery-and-cleanup-tools.prd.md Phase 1, ADR 0156). The job is in
// measure_job.go; the wire-contract schema, golden payloads and mock are in apps/ui/src/api. The job reads no project
// service; each answer is judged against the current project's Delivery limits when it is read (judgeMeasure, Phase 7).

// MeasurePickFiles opens the operating system's picker for the audio files to measure and answers the chosen paths
// (none when the narrator closes it). Only paths chosen here can be measured.
func (h *Host) MeasurePickFiles() (string, error) {
	return encodeBinding(h.pickMeasureFiles())
}

// MeasureAnalyze measures picked files as a job and answers it; it refuses a path that was not picked, more than
// maxMeasureFiles files, or a second measurement while one runs.
func (h *Host) MeasureAnalyze(paths []string) (string, error) {
	job, err := h.startMeasure(paths)
	if err != nil {
		return "", err
	}
	return encodeBinding(h.judgeMeasure(job), nil)
}

// MeasureState answers the measurement job: idle, running with real progress, or how it ended with every file's result,
// each measured file judged against the narrator's limits as they are now.
func (h *Host) MeasureState() (string, error) {
	return encodeBinding(h.judgeMeasure(h.measureState()), nil)
}

// MeasureCancel stops a running measurement; files already measured keep their results. With none running it changes
// nothing.
func (h *Host) MeasureCancel() (string, error) {
	return encodeBinding(h.judgeMeasure(h.cancelMeasure()), nil)
}

// DeliveryExportReport writes the report of the last measurement and diagnostics check (Phase 7) as an HTML and a JSON
// file in the project's narration-utils/delivery folder, and answers where. includePaths is the narrator's choice to
// write each file's full path; off, only file names are written. It refuses without a project, while a measurement or a
// check runs, or when nothing has been measured or checked.
func (h *Host) DeliveryExportReport(includePaths bool) (string, error) {
	return encodeBinding(h.exportDeliveryReport(includePaths))
}
