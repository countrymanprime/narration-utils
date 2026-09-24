package main

import "github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"

// The measurement bindings (diagnostics-delivery-and-cleanup-tools.prd.md Phase 1, ADR 0156). The job is in
// measure_job.go; the wire-contract schema, golden payloads and mock are in apps/ui/src/api. The job reads no project
// service; each answer is judged against the current project's delivery profile when it is read (judgeMeasure, ADR 0179).

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
// each measured file judged against the project's delivery profile as it is now.
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

// DeliveryProfiles answers every delivery profile the narrator can choose (the built-ins first, then their custom
// profiles), the Global default, the current project's own choice and the profile it is judged against
// (delivery-platform-profiles.prd.md Phase 2, ADR 0179).
func (h *Host) DeliveryProfiles() (string, error) {
	return encodeBinding(h.deliveryProfilesState())
}

// DeliverySelectProfile saves a choice of profile and answers the profiles again: scope "global" sets the Global
// default, scope "project" the current project's own choice (an empty id clears it, so the Global default judges it).
// A built-in is chosen at its version; a custom profile always judges with its latest revision.
func (h *Host) DeliverySelectProfile(scope, id, version string) (string, error) {
	return encodeBinding(h.selectDeliveryProfile(scope, id, version))
}

// DeliveryDuplicateProfile copies a profile (a built-in at version, or a custom one) into a new custom profile and
// answers it (Phase 4).
func (h *Host) DeliveryDuplicateProfile(id, version string) (string, error) {
	return encodeBinding(h.profileStore().Duplicate(deliveryprofile.Ref{ID: id, Version: version}))
}

// DeliverySaveProfile saves a custom profile's name, numbers and rules turned off (Phase 4), from the editor's JSON
// ({id, name, rules: [{id, off, min, max}]}), and answers it with its revision bumped. A built-in is never written.
func (h *Host) DeliverySaveProfile(edit string) (string, error) {
	return encodeBinding(h.saveDeliveryProfile(edit))
}

// DeliveryDeleteProfile deletes a custom profile and answers the profiles again; a project that chose it is judged
// against the Global default from then on, with a notice.
func (h *Host) DeliveryDeleteProfile(id string) (string, error) {
	if err := h.profileStore().Delete(id); err != nil {
		return "", err
	}
	return encodeBinding(h.deliveryProfilesState())
}
