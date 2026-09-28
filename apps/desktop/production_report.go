package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/productionreport"
)

// The Production page's status report export (docs/prds/production-tracking.prd.md Phase 5). The page sends only the
// narrator's one choice, whether to include the contracted amount and effective rate; the host builds the report from
// exactly the same overview and plan the Production page just read (buildProductionOverview, bindings_production.go)
// and writes an HTML and a JSON file into the project's narration-utils/production/reports folder. It never writes
// next to the audio, never changes the time log or the plan, and never overwrites an earlier report.

// maxProductionReportNameAttempts bounds the search for a free file name when reports are exported within the same second.
const maxProductionReportNameAttempts = 100

// ProductionReportExport is what one export wrote: the folder (relative to the project, slash-separated) and the two
// file names in it.
type ProductionReportExport struct {
	Folder                   string `json:"folder"`
	HTMLFile                 string `json:"htmlFile"`
	JSONFile                 string `json:"jsonFile"`
	ContractedAmountIncluded bool   `json:"contractedAmountIncluded"`
}

// ProductionStatusReport writes the book's status report (Phase 5): hours by stage, PFH, the deadline and milestone
// status, and book-wide readiness counts, as an HTML and a JSON file. includeContractedAmount is the narrator's choice
// to write the contracted amount and the effective rate; off by default, since a status report is often shared with
// someone the narrator would not otherwise tell their rate. It refuses without a project.
func (h *Host) ProductionStatusReport(includeContractedAmount bool) (string, error) {
	svc := h.services()
	project := svc.config.projectFolder
	if project == "" {
		return "", fmt.Errorf("open a project first; the report is kept in its narration-utils/production/reports folder")
	}
	overview, milestones, err := h.buildProductionOverview()
	if err != nil {
		return "", err
	}
	generatedAt := time.Now().UTC().Format(time.RFC3339)
	report := productionreport.Build(productionreport.Input{
		GeneratedAt: generatedAt, AppVersion: h.version,
		Options:    productionreport.Options{IncludeContractedAmount: includeContractedAmount},
		Overview:   overview,
		Milestones: milestones,
		Now:        time.Now(),
	})
	return encodeBinding(writeProductionReport(project, generatedAt, report))
}

// writeProductionReport writes the two files under a name no earlier report has, each through a temporary file.
func writeProductionReport(project, generatedAt string, report productionreport.Report) (ProductionReportExport, error) {
	encoded, err := report.JSON()
	if err != nil {
		return ProductionReportExport{}, err
	}
	page, err := report.HTML()
	if err != nil {
		return ProductionReportExport{}, err
	}
	folder := filepath.Join(project, filepath.FromSlash(productionreport.Dir))
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return ProductionReportExport{}, fmt.Errorf("could not create the report folder: %w", err)
	}
	stem, err := freeProductionReportStem(folder, generatedAt)
	if err != nil {
		return ProductionReportExport{}, err
	}
	for _, file := range []struct {
		name string
		data []byte
	}{{stem + ".json", encoded}, {stem + ".html", page}} {
		if err := writeFileAtomically(filepath.Join(folder, file.name), file.data); err != nil {
			return ProductionReportExport{}, err
		}
	}
	return ProductionReportExport{
		Folder: productionreport.Dir, HTMLFile: stem + ".html", JSONFile: stem + ".json",
		ContractedAmountIncluded: report.Privacy.ContractedAmountIncluded,
	}, nil
}

// freeProductionReportStem names a report after when it was made (production-status-20260927-180000Z), adding -2,
// -3, ... when a report of that second is already there.
func freeProductionReportStem(folder, generatedAt string) (string, error) {
	stamp := strings.NewReplacer("-", "", ":", "", "T", "-").Replace(generatedAt)
	base := "production-status-" + stamp
	for attempt := 1; attempt <= maxProductionReportNameAttempts; attempt++ {
		stem := base
		if attempt > 1 {
			stem = fmt.Sprintf("%s-%d", base, attempt)
		}
		if !reportFileExists(filepath.Join(folder, stem+".json")) && !reportFileExists(filepath.Join(folder, stem+".html")) {
			return stem, nil
		}
	}
	return "", fmt.Errorf("could not find a free name for the report in %s", productionreport.Dir)
}
