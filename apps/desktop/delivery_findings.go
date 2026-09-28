package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// Delivery findings on the Review page (delivery-platform-profiles.prd.md Phase 9, P12). Each file a measurement
// measured is judged against the project's delivery profile and its missed and unmeasurable rules are saved into the
// project's findings store, one scope per file (deliveryprofile.ReviewFindings), so the Review page lists and decides
// them through the same four bindings as every other category. A change of profile re-judges the last measurement and
// saves again, so the Review page never shows findings of a profile the project is no longer judged against.

// saveDeliveryFindings saves the review findings of every file job measured. A file that failed or was cancelled keeps
// what it had, since nothing new is known about it. Nothing is saved while the job runs, without a project's findings
// store, or when the job was started in another project than the one open now.
func (h *Host) saveDeliveryFindings(job *measureJob) {
	if job == nil || job.running() {
		return
	}
	h.saveFinishedDeliveryFindings(job)
}

// saveFinishedDeliveryFindings does the save without checking the job's own running() flag: runMeasure calls it on a
// job it knows has truly finished (its measuring loop has returned), but before job.finish() sets the job's phase to a
// terminal one. Doing the save first, before that phase flip is visible, is what keeps a reader who learns the
// measurement stopped (measureState, an ended-job event) from ever seeing that before the findings it produced are on
// disk — otherwise a poll landing between the two steps finds some files' findings missing (delivery_findings_test.go).
func (h *Host) saveFinishedDeliveryFindings(job *measureJob) {
	h.deliveryFindingsMu.Lock()
	defer h.deliveryFindingsMu.Unlock()
	svc := h.services()
	if svc.findings == nil || svc.config.projectFolder == "" || job.project != svc.config.projectFolder {
		return
	}
	profile, _, _ := h.selectedDeliveryProfile(svc)
	project := findings.Project{Path: svc.config.projectFolder}
	for _, file := range job.snapshot().Files {
		if file.Status != measureFileMeasured || file.Report == nil {
			continue
		}
		fingerprint := ""
		if file.Fingerprint != nil {
			fingerprint = file.Fingerprint.SHA256
		}
		fresh := []findings.Finding{}
		for _, f := range deliveryprofile.ReviewFindings(*file.Report, fingerprint, profile, project) {
			if err := f.Validate(); err != nil {
				h.persist.Warn("findings_invalid", fmt.Sprintf("A delivery finding on %s was invalid and skipped: %v", file.Name, err))
				continue
			}
			fresh = append(fresh, f)
		}
		// Saved even when empty: an empty set is how every rule this file missed before resolves once it is met.
		if _, err := svc.findings.SaveAnalyzerFindings(deliveryprofile.ReviewAnalyzer, deliveryprofile.ReviewScope(file.Report.File), fresh); err != nil {
			h.persist.Warn("findings_save_failed", fmt.Sprintf("The delivery findings of %s were not saved for Proof: %v", file.Name, err))
		}
	}
}

// resaveDeliveryFindings re-judges the last measurement after the project's profile may have changed.
func (h *Host) resaveDeliveryFindings() {
	h.mu.RLock()
	job := h.measureJob
	h.mu.RUnlock()
	h.saveDeliveryFindings(job)
}
