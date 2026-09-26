package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
)

// comparisonRecorder is the transcript service's run recorder (proofing-readiness-signals.prd.md Phase 2): every
// finished comparison becomes one analysis evidence ledger record, with its chapter resolved from the run's chapter
// title through the manuscript, the manuscript's documentId, the compared set read from the run's manifest and the
// saved project file's time at completion. A record that cannot be written is logged and never fails the comparison
// the narrator is looking at.
func comparisonRecorder(folder string, text *manuscript.Service, store *settings.Store, reporter *persist.Reporter) func(transcript.CompletedRun) {
	recorder := &proofing.ComparisonRecorder{
		Ledger: evidence.NewLedgerStore(folder), Lookup: text, ProjectFolder: folder,
		DocumentID:  func() string { return manuscriptDocumentID(text) },
		ProjectFile: func() (evidence.LedgerProjectFile, error) { return savedProjectFile(folder, store) },
	}
	return func(run transcript.CompletedRun) {
		err := recorder.Record(proofing.ComparisonRun{
			RunID: run.RunID, Outcome: run.Outcome, ManifestPath: run.ManifestPath, ChapterTitle: run.ChapterTitle,
			Model: run.Model, TrackGUID: run.TrackGUID, FindingCount: run.FindingCount,
			StartedAt: run.StartedAt, CompletedAt: run.CompletedAt,
		})
		if err != nil {
			reporter.Warn("comparison_record_failed", fmt.Sprintf("The Transcript Compare run was not recorded for the proofing check: %v", err))
		}
	}
}

// renderMeasurementRecorder is the measurement job's per-file hook (proofing-readiness-signals.prd.md Phase 4): a
// measured file that is some chapter's chosen render becomes one ledger record per such chapter, keyed by the render's
// fingerprint, with its Report (or failed, with the error). Nil without a project or a manuscript. A record that cannot
// be written is logged; the measurement the narrator is looking at is unaffected.
func renderMeasurementRecorder(folder string, text *manuscript.Service, reporter *persist.Reporter) measuredFileFunc {
	if folder == "" || text == nil {
		return nil
	}
	ledger, renders := evidence.NewLedgerStore(folder), proofing.NewRenderStore(folder)
	return func(path string, measured measure.FileMeasurement, measureErr error, began time.Time) {
		_, err := proofing.RecordRenderMeasurements(ledger, renders, manuscriptDocumentID(text), folder, path,
			measured.Report, measured.Fingerprint.SHA256, measureErr, began, time.Now().UTC())
		if err != nil {
			reporter.Warn("render_measurement_record_failed", fmt.Sprintf("The measurement of %s was not recorded for the proofing check: %v", filepath.Base(path), err))
		}
	}
}

// proofingProfile is the delivery profile the open project is judged against now, for the proofing delivery checks
// (proofing-readiness-signals.prd.md Phase 5). It takes a services() snapshot, so it must not be called with h.mu held:
// configureLocked passes it as a value and the stages service calls it at evaluation time.
func (h *Host) proofingProfile() deliveryprofile.Profile {
	profile, _, _ := h.selectedDeliveryProfile(h.services())
	return profile
}

// manuscriptDocumentID is the imported manuscript's documentId, "" before an import.
func manuscriptDocumentID(text *manuscript.Service) string {
	data, err := text.Load()
	if err != nil {
		return ""
	}
	id, _ := data["documentId"].(string)
	return id
}

// savedProjectFile is the narrator's chosen saved .rpp with its modified time now.
func savedProjectFile(folder string, store *settings.Store) (evidence.LedgerProjectFile, error) {
	path, err := selectedProjectFile(folder, store)
	if err != nil {
		return evidence.LedgerProjectFile{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return evidence.LedgerProjectFile{}, err
	}
	return evidence.LedgerProjectFile{Path: path, ModTime: info.ModTime().UTC()}, nil
}
