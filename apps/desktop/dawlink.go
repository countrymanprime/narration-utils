package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// ProjectLinkDawFile is the one shared binding behind the header pill, the
// Tracks page and Settings' DAW category (PRD project-workspace-and-daw-
// link.prd.md, Open Question W19): it opens a native "*.rpp" file dialog and
// links the chosen file to the current project through the manifest storage
// Phase 1-3 already built (project.BuildDawLink, Manifest.Save). Cancelling
// the dialog is not an error: the result says so instead.
func (h *Host) ProjectLinkDawFile() (string, error) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx == nil {
		return "", fmt.Errorf("the desktop host is not ready")
	}
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before linking a REAPER project file")
	}
	path, err := pickFile("Select REAPER project file", []fileFilter{{"REAPER projects", "*.rpp"}})
	if err != nil {
		return "", err
	}
	if path == "" {
		return encodeBinding(map[string]any{"selected": false, "linked": false}, nil)
	}
	result, err := linkDawFile(h.persist, projectFolder, path)
	if err != nil {
		return "", err
	}
	return encodeBinding(result, nil)
}

// linkDawFile is ProjectLinkDawFile's pure logic, kept apart from the dialog
// and the host so it can be unit tested directly.
//
// It refuses to link rppPath when it does not live directly inside
// projectFolder (PRD Open Question W15): today Proofing's bridge only works
// when the project folder equals the rpp's folder (see dawfacts.go and
// transcript/service.go), and attaching a different folder's DAW project
// would mean either silently breaking that invariant or re-pointing the
// whole project (orphaning the imported manuscript) - both are out of scope
// here and wait on W4's Lua changes. Linking inside the folder always
// succeeds and never fails partway: BuildDawLink cannot fail once rppPath and
// projectFolder both resolve to absolute paths, so the only remaining error
// is Manifest.Save's own I/O failure.
func linkDawFile(reporter *persist.Reporter, projectFolder, rppPath string) (map[string]any, error) {
	absFolder, err := filepath.Abs(projectFolder)
	if err != nil {
		return nil, fmt.Errorf("could not resolve the project folder: %w", err)
	}
	absRpp, err := filepath.Abs(rppPath)
	if err != nil {
		return nil, fmt.Errorf("could not resolve the REAPER project file: %w", err)
	}
	if !strings.EqualFold(filepath.Dir(absRpp), absFolder) {
		return map[string]any{
			"selected":       true,
			"linked":         false,
			"path":           absRpp,
			"folderMismatch": true,
			"message": fmt.Sprintf(
				"%s is outside this project's folder (%s). Choose a REAPER project file saved inside the project, or open that project instead.",
				filepath.Base(absRpp), absFolder,
			),
		}, nil
	}

	link, err := project.BuildDawLink(absFolder, absRpp)
	if err != nil {
		return nil, fmt.Errorf("could not record the DAW project link: %w", err)
	}
	manifest, ok, err := project.Load(reporter, absFolder)
	if err != nil {
		return nil, fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil {
		manifest = project.New(filepath.Base(absFolder), time.Now())
	}
	manifest.DawProjectFile = &link
	if err := manifest.Save(absFolder); err != nil {
		return nil, fmt.Errorf("could not save the DAW project link: %w", err)
	}
	return map[string]any{"selected": true, "linked": true, "path": absRpp}, nil
}
