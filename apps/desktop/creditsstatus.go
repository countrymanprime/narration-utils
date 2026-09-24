package main

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Credits row statuses (credits-in-chapter-table.prd.md Phase 1, CT2/CT3, ADR 0183): the opening and closing credits rows
// the chapter table shows get a status of their own, one of the same five a manuscript chapter has, stored on the project
// manifest beside Credits and RetailSample so it survives Replace manuscript and Clear derived data, unlike a chapter's
// status in manuscript-notes.json (which resetDerived wipes).

// creditsStatusKinds are the two credits rows a status can belong to, matching creditsScriptTitles's kinds.
var creditsStatusKinds = map[string]bool{"opening": true, "closing": true}

// CreditsStatuses reads this project's credits row statuses. A kind never set is simply absent from the map; the UI
// treats that the same way it treats a manuscript chapter with no note: "not_started".
func (h *Host) CreditsStatuses() (string, error) {
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before reading its credits statuses")
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	statuses := map[string]string{}
	if ok && manifest != nil && manifest.CreditsStatus != nil {
		statuses = manifest.CreditsStatus
	}
	return encodeBinding(statuses, nil)
}

// CreditsSetStatus sets kind ("opening" or "closing") to status (one of the five chapter statuses), refusing either an
// unknown kind or an unknown status without writing anything.
func (h *Host) CreditsSetStatus(kind, status string) (string, error) {
	if !creditsStatusKinds[kind] {
		return "", fmt.Errorf("credits status kind must be opening or closing, not %q", kind)
	}
	if !credits.ValidStatus(status) {
		return "", fmt.Errorf("unknown credits status: %s", status)
	}
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before setting its credits statuses")
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil {
		manifest = project.New(svc.config.projectName, time.Now())
	}
	if manifest.CreditsStatus == nil {
		manifest.CreditsStatus = map[string]string{}
	}
	manifest.CreditsStatus[kind] = status
	if err := manifest.Save(projectFolder); err != nil {
		return "", fmt.Errorf("could not save the credits status: %w", err)
	}
	return encodeBinding(manifest.CreditsStatus, nil)
}
