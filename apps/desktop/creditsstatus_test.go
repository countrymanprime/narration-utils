package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// The credits row statuses (credits-in-chapter-table.prd.md Phase 1, CT2/CT3, ADR 0183): stored on the project manifest,
// separately from a manuscript chapter's status in manuscript-notes.json, so they survive Replace manuscript and Clear.

func TestCreditsStatusesIsEmptyForAProjectThatHasNeverSetOne(t *testing.T) {
	host := hostWithCredits(t)

	encoded, err := host.CreditsStatuses()
	if err != nil {
		t.Fatal(err)
	}

	var statuses map[string]string
	decodeInto(t, encoded, &statuses)
	if len(statuses) != 0 {
		t.Fatalf("statuses = %+v, want empty", statuses)
	}
}

func TestCreditsSetStatusStoresItOnTheProjectManifestAndCreditsStatusesReadsItBack(t *testing.T) {
	host := hostWithCredits(t)

	encoded, err := host.CreditsSetStatus("opening", "finalized")
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]string
	decodeInto(t, encoded, &saved)
	if saved["opening"] != "finalized" {
		t.Fatalf("saved = %+v, want opening finalized", saved)
	}

	manifest, ok, err := project.Load(host.persist, host.config.projectFolder)
	if err != nil || !ok || manifest.CreditsStatus["opening"] != "finalized" {
		t.Fatalf("manifest = %+v, %v, %v", manifest, ok, err)
	}

	encoded, err = host.CreditsStatuses()
	if err != nil {
		t.Fatal(err)
	}
	var statuses map[string]string
	decodeInto(t, encoded, &statuses)
	if len(statuses) != 1 || statuses["opening"] != "finalized" {
		t.Fatalf("statuses = %+v, want only opening finalized", statuses)
	}

	if _, err := host.CreditsSetStatus("closing", "recording"); err != nil {
		t.Fatal(err)
	}
	encoded, err = host.CreditsStatuses()
	if err != nil {
		t.Fatal(err)
	}
	decodeInto(t, encoded, &statuses)
	if statuses["opening"] != "finalized" || statuses["closing"] != "recording" {
		t.Fatalf("statuses = %+v, want both kinds kept", statuses)
	}
}

func TestCreditsSetStatusRefusesAnUnknownKindOrStatus(t *testing.T) {
	host := hostWithCredits(t)

	if _, err := host.CreditsSetStatus("chapter-1", "finalized"); err == nil {
		t.Fatal("want an error for a kind that is not opening or closing")
	}
	if _, err := host.CreditsSetStatus("opening", "done"); err == nil {
		t.Fatal("want an error for an unknown status")
	}
	manifest, ok, err := project.Load(host.persist, host.config.projectFolder)
	if err != nil {
		t.Fatal(err)
	}
	if ok && len(manifest.CreditsStatus) != 0 {
		t.Fatalf("a refused call must not write anything: %+v", manifest.CreditsStatus)
	}
}

func TestCreditsSetStatusSurvivesClearDerivedData(t *testing.T) {
	host := hostWithExtras(t, 10)
	if _, err := host.CreditsSetStatus("opening", "finalized"); err != nil {
		t.Fatal(err)
	}
	if _, err := host.ManuscriptSetChapterStatus("c-0002", "finalized"); err != nil {
		t.Fatal(err)
	}

	if _, err := host.ManuscriptClearProjectData(true); err != nil {
		t.Fatal(err)
	}

	encoded, err := host.CreditsStatuses()
	if err != nil {
		t.Fatal(err)
	}
	var statuses map[string]string
	decodeInto(t, encoded, &statuses)
	if statuses["opening"] != "finalized" {
		t.Fatalf("statuses = %+v, want opening finalized to survive Clear, unlike a manuscript chapter's own status", statuses)
	}
}

func TestCreditsStatusRequiresAnOpenProject(t *testing.T) {
	host := NewHost()

	if _, err := host.CreditsStatuses(); err == nil {
		t.Fatal("want an error with no project open")
	}
	if _, err := host.CreditsSetStatus("opening", "finalized"); err == nil {
		t.Fatal("want an error with no project open")
	}
}
