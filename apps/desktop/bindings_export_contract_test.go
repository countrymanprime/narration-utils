package main

import (
	"errors"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/mastering"
	"github.com/countrymanprime/narration-utils/shell/internal/packager"
)

// What ExportPickFiles, ExportState, PackageState and their siblings send (render-encode-master.prd.md Phase 5): the
// idle job, one mid-run, one that finished with a mastered and encoded file, one with a failed file, and a built
// package. The reports are built here rather than run through real audio or a real package folder, so the files do
// not depend on floating point or the host's own paths; their shape is exportJob's and packageJobState's own.

var contractExportPaths = []string{"C:/Renders/Chapter 01.wav", "C:/Renders/Chapter 02.wav"}

func contractExportJob() *exportJob {
	job := &exportJob{id: "export-1", phase: "running", started: time.Now(), cancel: func() {}, master: true, format: "mp3", message: "Preparing 2 files."}
	job.logs = []string{job.message}
	for i, path := range contractExportPaths {
		job.files = append(job.files, ExportFileResult{Kind: string(packager.KindChapter), Title: []string{"Chapter 01", "Chapter 02"}[i], Path: path, Status: exportFilePending})
		job.weights = append(job.weights, 1000)
		job.totalWeight += 1000
	}
	return job
}

func pinExportJob(t *testing.T, name string, job ExportJob) {
	t.Helper()
	job.Elapsed = 3.5
	contractfile.Check(t, name, job)
}

func TestContractExportBindings(t *testing.T) {
	contractfile.Check(t, "export-pick", MeasurePickResult{Paths: contractExportPaths})
	pinExportJob(t, "export-idle", NewHost().exportState())

	running := contractExportJob()
	running.begin(0, exportFileMastering)
	running.progress(0, 500, 1000)
	pinExportJob(t, "export-running", running.snapshot())

	finished := contractExportJob()
	value := func(v float64) *float64 { return &v }
	masteredPath := "C:/Project/narration-utils/render-encode-master/mastered/01-chapter.wav"
	summary := &MasteringSummary{
		Targets: mastering.Targets{RMS: -20.5, Ceiling: -3}, HighPassHz: 80, GainDB: 2.3,
		BeforeRMSdBFS: value(-22.8), AfterRMSdBFS: value(-20.5), AfterPeakDBFS: value(-3.4),
	}
	finished.succeed(0, masteredPath, summary, "C:/Project/narration-utils/render-encode-master/encoded/01-chapter.mp3")
	finished.fail(1, errors.New("the encoder rejected this file: unsupported sample format"))
	finished.finish(false, nil)
	pinExportJob(t, "export-error", finished.snapshot())

	cancelled := contractExportJob()
	cancelled.succeed(0, masteredPath, summary, "C:/Project/narration-utils/render-encode-master/encoded/01-chapter.mp3")
	cancelled.finish(true, nil)
	pinExportJob(t, "export-cancelled", cancelled.snapshot())
}

func contractPackageJob() *packageJobState {
	return &packageJobState{
		id: "package-1", phase: "success", started: time.Now(), cancel: func() {}, profile: "acx", outputDir: `C:\Users\Narrator\Desktop\Wonderland ACX`,
		files: []PackageManifestFile{
			{Kind: string(packager.KindChapter), Name: "01 - Chapter One.mp3", DestPath: `C:\Users\Narrator\Desktop\Wonderland ACX\01 - Chapter One.mp3`},
			{Kind: string(packager.KindCreditsOpening), Name: "Credits, Opening.mp3", DestPath: `C:\Users\Narrator\Desktop\Wonderland ACX\Credits, Opening.mp3`},
		},
		checklist: []PackageChecklistItem{
			{RuleID: "acx.credits", Label: "Opening and closing credits", Status: string(packager.ChecklistIncluded), Detail: "Opening and closing credits included as separate files."},
			{RuleID: "acx.retail_sample", Label: "Retail sample", Status: string(packager.ChecklistMissing), Detail: "Needs a retail sample file."},
		},
		message: "Built the acx package with 2 files.",
	}
}

func TestContractPackageBindings(t *testing.T) {
	contractfile.Check(t, "package-idle", NewHost().packageState())

	built := contractPackageJob()
	job := built.snapshot()
	job.Elapsed = 4.2
	contractfile.Check(t, "package-success", job)

	failed := contractPackageJob()
	failed.phase, failed.errorText, failed.message = "error", "packager: a required delivery item is missing: retail sample (Needs a retail sample file.)", "The package could not be built: packager: a required delivery item is missing: retail sample (Needs a retail sample file.)"
	failed.files, failed.checklist = nil, contractPackageJob().checklist
	failedSnapshot := failed.snapshot()
	failedSnapshot.Elapsed = 1.1
	contractfile.Check(t, "package-error", failedSnapshot)
}

// What PackageStartMulti, PackageMultiState and PackageMultiCancel send (render-encode-master.prd.md Phase 6): the
// idle job, one mid-run, one that finished with a mix of a reused-format package and a re-encoded-format package,
// and one where one profile's package failed while another succeeded.

func contractMultiPackageJob() *multiPackageJobState {
	return &multiPackageJobState{
		id: "package-multi-1", phase: "success", started: time.Now(), cancel: func() {}, outputDir: `C:\Users\Narrator\Desktop\Wonderland`,
		results: []MultiPackageResult{
			{
				Profile: "acx", Platform: "ACX", Phase: "success", Message: "Built 2 files.", OutputDir: `C:\Users\Narrator\Desktop\Wonderland\ACX (September 2026)`,
				Files: []PackageManifestFile{
					{Kind: string(packager.KindChapter), Name: "01 - Chapter One.mp3", DestPath: `C:\Users\Narrator\Desktop\Wonderland\ACX (September 2026)\01 - Chapter One.mp3`},
					{Kind: string(packager.KindRetailSample), Name: "Retail Sample.mp3", DestPath: `C:\Users\Narrator\Desktop\Wonderland\ACX (September 2026)\Retail Sample.mp3`},
				},
				Checklist: []PackageChecklistItem{
					{RuleID: "acx.retail_sample", Label: "Retail sample", Status: string(packager.ChecklistIncluded), Detail: "A retail sample is included."},
				},
			},
			{
				Profile: "kobo", Platform: "Kobo (M4B)", Phase: "success", Message: "Built 1 file.", OutputDir: `C:\Users\Narrator\Desktop\Wonderland\Kobo (M4B)`,
				Files: []PackageManifestFile{
					{Kind: string(packager.KindChapter), Name: "01 - Chapter One.m4b", DestPath: `C:\Users\Narrator\Desktop\Wonderland\Kobo (M4B)\01 - Chapter One.m4b`},
				},
				Checklist: []PackageChecklistItem{},
			},
		},
		message: "Built 2 packages.",
	}
}

func TestContractMultiPackageBindings(t *testing.T) {
	contractfile.Check(t, "multi-package-idle", NewHost().multiPackageState())

	running := contractMultiPackageJob()
	running.phase = "running"
	running.results[1].Phase, running.results[1].Files, running.results[1].Checklist = "running", nil, nil
	running.message = "Building the Kobo (M4B) package (2 of 2)."
	runningSnapshot := running.snapshot()
	runningSnapshot.Elapsed = 6.4
	contractfile.Check(t, "multi-package-running", runningSnapshot)

	success := contractMultiPackageJob()
	successSnapshot := success.snapshot()
	successSnapshot.Elapsed = 8.1
	contractfile.Check(t, "multi-package-success", successSnapshot)

	failed := contractMultiPackageJob()
	failed.phase, failed.message = "error", "1 of 2 packages could not be built; the rest are ready."
	failed.results[1].Phase, failed.results[1].Message, failed.results[1].Error = "error",
		"The package could not be built: packager: a required delivery item is missing: retail sample (Needs a retail sample file.)",
		"packager: a required delivery item is missing: retail sample (Needs a retail sample file.)"
	failed.results[1].OutputDir, failed.results[1].Files, failed.results[1].Checklist = "", nil, nil
	failedSnapshot := failed.snapshot()
	failedSnapshot.Elapsed = 7.3
	contractfile.Check(t, "multi-package-error", failedSnapshot)
}
