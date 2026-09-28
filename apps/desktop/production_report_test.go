package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The Production page's status report export (production-tracking.prd.md Phase 5): the host builds it from exactly
// the overview and plan ProductionOverview just answered, and writes it into the project's own
// narration-utils/production/reports folder, never over an earlier report.

func TestProductionStatusReportRequiresAnOpenProject(t *testing.T) {
	host := NewHost()
	if _, err := host.ProductionStatusReport(false); err == nil {
		t.Fatal("want an error with no project open")
	}
}

func TestProductionStatusReportWritesFilesAndLeavesOutTheContractedAmountByDefault(t *testing.T) {
	host := productionHost(t)
	answer := decodeAnswer(t)(host.ProductionStatusReport(false))
	if answer["contractedAmountIncluded"] != false {
		t.Fatalf("want the contracted amount left out by default, got %v", answer)
	}
	folder, _ := answer["folder"].(string)
	if folder != "narration-utils/production/reports" {
		t.Fatalf("want the reports folder, got %q", folder)
	}
	htmlFile, _ := answer["htmlFile"].(string)
	jsonFile, _ := answer["jsonFile"].(string)
	for _, name := range []string{htmlFile, jsonFile} {
		path := filepath.Join(host.config.projectFolder, filepath.FromSlash(folder), name)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected %s to exist: %v", path, err)
		}
	}
	written, err := os.ReadFile(filepath.Join(host.config.projectFolder, filepath.FromSlash(folder), jsonFile))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(written), "\"contracted_amount_included\": true") {
		t.Fatal("the written report should not say the amount was included")
	}
}

func TestProductionStatusReportIncludesTheContractedAmountWhenAsked(t *testing.T) {
	host := productionHost(t)
	answer := decodeAnswer(t)(host.ProductionStatusReport(true))
	if answer["contractedAmountIncluded"] != true {
		t.Fatalf("want the contracted amount included, got %v", answer)
	}
}

func TestProductionStatusReportNeverOverwritesAnEarlierReport(t *testing.T) {
	host := productionHost(t)
	first := decodeAnswer(t)(host.ProductionStatusReport(false))
	second := decodeAnswer(t)(host.ProductionStatusReport(false))
	if first["jsonFile"] == second["jsonFile"] {
		t.Fatalf("two exports named the same file: %v", first["jsonFile"])
	}
}

// TestContractProductionStatusReport pins ProductionStatusReport's payload as the UI receives it, with the dated file
// names fixed: they carry the export time, which contractfile.Stabilize does not normalize (it is not RFC 3339).
func TestContractProductionStatusReport(t *testing.T) {
	host := productionHost(t)
	answer := decodeAnswer(t)(host.ProductionStatusReport(false))
	answer["htmlFile"] = "production-status-20260921-100000Z.html"
	answer["jsonFile"] = "production-status-20260921-100000Z.json"
	stable, err := contractfile.Stabilize(answer)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "production-status-report", stable)
}
