package main

import (
	"fmt"
	"os"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
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
