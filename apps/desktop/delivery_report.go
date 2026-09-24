package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryreport"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// The Delivery page's report export (diagnostics-delivery-and-cleanup-tools.prd.md Phase 7). The page sends only the
// narrator's one choice, whether to include full paths; the host builds the report from what it already holds (the last
// measurement and diagnostics check, the project's delivery profile, the project's review store, the installed assets) and writes
// an HTML and a JSON file into the project's narration-utils/delivery folder. It never writes next to the audio, never
// changes a source file, and never overwrites an earlier report.

// maxReportNameAttempts bounds the search for a free file name when reports are exported within the same second.
const maxReportNameAttempts = 100

// DeliveryReportExport is what one export wrote: the folder (relative to the project, slash-separated) and the two file
// names in it, with what the report counts.
type DeliveryReportExport struct {
	Folder        string `json:"folder"`
	HTMLFile      string `json:"htmlFile"`
	JSONFile      string `json:"jsonFile"`
	Files         int    `json:"files"`
	Findings      int    `json:"findings"`
	OpenFindings  int    `json:"openFindings"`
	PathsIncluded bool   `json:"pathsIncluded"`
}

// judgeMeasureJob adds the host's judgement of every measured file against the delivery profile in force
// (deliveryprofile.EvaluateFile, ADR 0179): each file's result per rule and its delivery_qc findings, with the IDs a
// report carries, and the book rules over every measured file. It judges on every read, so choosing another profile
// re-judges a measurement without measuring again.
func judgeMeasureJob(job MeasureJob, profile deliveryprofile.Profile, notice string) MeasureJob {
	job.Profile, job.ProfileNotice = &profile, notice
	files := make([]MeasureFileResult, len(job.Files))
	reports := []measure.Report{}
	for i, file := range job.Files {
		file.Findings, file.Rules = []findings.Finding{}, []deliveryprofile.Result{}
		if file.Status == measureFileMeasured && file.Report != nil {
			judgement := deliveryprofile.EvaluateFile(*file.Report, profile)
			file.Rules, file.Findings = judgement.Results, judgement.Findings
			reports = append(reports, *file.Report)
		}
		files[i] = file
	}
	job.Files = files
	job.BookRules = deliveryprofile.EvaluateBook(reports, profile)
	return job
}

// judgeMeasure judges job against the profile the current project is judged against.
func (h *Host) judgeMeasure(job MeasureJob) MeasureJob {
	profile, _, notice := h.selectedDeliveryProfile(h.services())
	return judgeMeasureJob(job, profile, notice)
}

// exportDeliveryReport writes the report of the last measurement and diagnostics check.
func (h *Host) exportDeliveryReport(includePaths bool) (DeliveryReportExport, error) {
	svc := h.services()
	project := svc.config.projectFolder
	if project == "" {
		return DeliveryReportExport{}, errors.New("open a project first; the report is kept in its narration-utils/delivery folder")
	}
	in, err := h.deliveryReportInput(svc, includePaths)
	if err != nil {
		return DeliveryReportExport{}, err
	}
	if svc.findings != nil {
		// One read of the whole store, not one per finding.
		stored, err := svc.findings.List(findings.Query{IncludeNotInLatestRun: true})
		if err != nil {
			return DeliveryReportExport{}, fmt.Errorf("the review decisions could not be read, so no report was written: %w", err)
		}
		decisions := make(map[string]findings.ReviewState, len(stored))
		for _, finding := range stored {
			decisions[finding.ID] = finding.Review
		}
		in.Review = func(id string) (findings.ReviewState, bool) {
			state, found := decisions[id]
			return state, found
		}
	} else {
		in.ReviewNote = "The project's review store could not be opened, so every finding is shown as unreviewed."
	}
	return writeDeliveryReport(project, in.GeneratedAt, deliveryreport.Build(in))
}

// deliveryReportInput gathers what the report is built from. It refuses while a measurement or a check runs, and when
// neither has any file yet.
func (h *Host) deliveryReportInput(svc hostServices, includePaths bool) (deliveryreport.Input, error) {
	h.mu.RLock()
	measured, checked := h.measureJob, h.diagnosticsJob
	h.mu.RUnlock()
	if (measured != nil && measured.running()) || (checked != nil && checked.running()) {
		return deliveryreport.Input{}, errors.New("wait for the measurement or the diagnostics check to finish, then export the report")
	}
	in := deliveryreport.Input{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339), AppVersion: h.version,
		Options:   deliveryreport.Options{IncludePaths: includePaths},
		CheckNote: "No diagnostics check has run in this session, so the files were not checked for clipping, level shifts or room-tone changes.",
	}
	in.Profile, _, in.ProfileNotice = h.selectedDeliveryProfile(svc)
	if measured != nil {
		for _, file := range measured.snapshot().Files {
			in.Measured = append(in.Measured, deliveryreport.MeasuredFile{
				Path: file.Path, Name: file.Name, Status: file.Status, Error: file.Error, Report: file.Report, Fingerprint: file.Fingerprint,
			})
		}
	}
	if checked != nil {
		job := checked.snapshot()
		in.SourceKind, in.Thresholds = job.SourceKind, &job.Thresholds
		for _, file := range job.Files {
			in.Checked = append(in.Checked, deliveryreport.CheckedFile{
				Path: file.Path, Name: file.Name, Status: file.Status, Error: file.Error, Summary: file.Summary, Findings: file.Findings,
			})
		}
	}
	if len(in.Measured) == 0 && len(in.Checked) == 0 {
		return deliveryreport.Input{}, errors.New("nothing has been measured or checked in this session yet")
	}
	in.Assets, in.AssetsNote = h.installedAssets()
	return in, nil
}

// installedAssets lists every installed asset by kind, id and version, or says why the list is not available.
func (h *Host) installedAssets() ([]deliveryreport.Asset, string) {
	registry := h.registry()
	if len(registry.providers) == 0 {
		if registry.unavailable != "" {
			return nil, "The installed assets could not be listed: " + registry.unavailable
		}
		return nil, "The installed assets could not be listed: the approved asset catalog is unavailable."
	}
	assets := []deliveryreport.Asset{}
	for _, provider := range registry.providers {
		for _, item := range provider.items() {
			if provider.state(item.id) != "installed" {
				continue
			}
			assets = append(assets, deliveryreport.Asset{
				Kind: item.kind, ID: item.id, Name: item.displayName, Version: item.version, Publisher: item.publisher,
				ProvenanceURL: item.provenanceURL, Path: item.dir,
			})
		}
	}
	return assets, ""
}

// writeDeliveryReport writes the two files under a name no earlier report has, each through a temporary file.
func writeDeliveryReport(project, generatedAt string, report deliveryreport.Report) (DeliveryReportExport, error) {
	encoded, err := report.JSON()
	if err != nil {
		return DeliveryReportExport{}, err
	}
	page, err := report.HTML()
	if err != nil {
		return DeliveryReportExport{}, err
	}
	folder := filepath.Join(project, filepath.FromSlash(deliveryreport.Dir))
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return DeliveryReportExport{}, fmt.Errorf("could not create the report folder: %w", err)
	}
	stem, err := freeReportStem(folder, generatedAt)
	if err != nil {
		return DeliveryReportExport{}, err
	}
	for _, file := range []struct {
		name string
		data []byte
	}{{stem + ".json", encoded}, {stem + ".html", page}} {
		if err := writeFileAtomically(filepath.Join(folder, file.name), file.data); err != nil {
			return DeliveryReportExport{}, err
		}
	}
	return DeliveryReportExport{
		Folder: deliveryreport.Dir, HTMLFile: stem + ".html", JSONFile: stem + ".json", Files: report.Summary.Files,
		Findings: report.Summary.Findings, OpenFindings: report.Summary.OpenFindings, PathsIncluded: report.Privacy.PathsIncluded,
	}, nil
}

// freeReportStem names a report after when it was made (delivery-report-20260923-140000Z), adding -2, -3, ... when a
// report of that second is already there.
func freeReportStem(folder, generatedAt string) (string, error) {
	stamp := strings.NewReplacer("-", "", ":", "", "T", "-").Replace(generatedAt)
	base := "delivery-report-" + stamp
	for attempt := 1; attempt <= maxReportNameAttempts; attempt++ {
		stem := base
		if attempt > 1 {
			stem = fmt.Sprintf("%s-%d", base, attempt)
		}
		if !reportFileExists(filepath.Join(folder, stem+".json")) && !reportFileExists(filepath.Join(folder, stem+".html")) {
			return stem, nil
		}
	}
	return "", fmt.Errorf("could not find a free name for the report in %s", deliveryreport.Dir)
}

func reportFileExists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func writeFileAtomically(path string, data []byte) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return fmt.Errorf("could not write the report: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary) // best effort: the rename's error is the one the narrator needs
		return fmt.Errorf("could not write the report: %w", err)
	}
	return nil
}
