package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// DawLaunch starts REAPER on the current project's linked DAW file (Phase 8,
// docs/prds/project-workspace-and-daw-link.prd.md): it resolves reaper.exe (a
// Settings override always wins, otherwise auto-detect - daw.Resolve /
// daw.LocateReaperExecutable, ADR 0092 W11), and passes the linked .rpp,
// plus, when the DAW.auto_start_launcher setting is on (owner decision D10,
// default OFF), the launcher script too - the exact
// `reaper.exe "<project.rpp>" "<script.lua>"` form spike S6 confirmed REAPER
// runs automatically at startup (ADR 0092 W12), so the bridge is live
// without the narrator running the action by hand. The launch is detached
// (daw.Launch): never through the sidecar supervisor's kill-on-close job
// object (internal/process/job_windows.go), so REAPER outlives the app when
// the narrator closes it.
func (h *Host) DawLaunch() (string, error) {
	result, err := launchReaper(h.services(), h.persist, h.reaperLocate, h.reaperLaunch)
	if err != nil {
		return "", err
	}
	return encodeBinding(result, nil)
}

// launchReaper is DawLaunch's pure logic, kept apart from the host so it can be unit tested directly with fake
// locate/launch seams: locate defaults to daw.LocateReaperExecutable and launch to daw.Launch, exactly as
// h.reaperLocate/h.reaperLaunch being nil means in production.
func launchReaper(svc hostServices, reporter *persist.Reporter, locate func() (path, source string, err error), launch func(program string, args []string) error) (map[string]any, error) {
	if svc.config.projectFolder == "" {
		return nil, fmt.Errorf("open a project before starting REAPER")
	}
	manifest, ok, err := project.Load(reporter, svc.config.projectFolder)
	if err != nil {
		return nil, fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil || manifest.DawProjectFile == nil {
		return nil, fmt.Errorf("link a REAPER project file before starting REAPER")
	}
	rpp, resolved := manifest.DawProjectFile.Resolve(svc.config.projectFolder)
	if !resolved {
		return nil, fmt.Errorf("the linked REAPER project file no longer exists on disk")
	}

	override, _ := svc.settings.Effective("DAW", "reaper_path", "")
	autoStart, _ := svc.settings.Effective("DAW", "auto_start_launcher", "false")

	if locate == nil {
		locate = daw.LocateReaperExecutable
	}
	execPath, source, err := daw.Resolve(override, locate)
	if err != nil {
		return nil, fmt.Errorf("could not find reaper.exe: %w", err)
	}

	args := []string{rpp}
	if autoStart == "true" && svc.config.reaperLauncher != "" {
		args = append(args, svc.config.reaperLauncher)
	}

	if launch == nil {
		launch = func(program string, args []string) error { return daw.Launch(program, args...) }
	}
	if err := launch(execPath, args); err != nil {
		return nil, fmt.Errorf("could not start REAPER: %w", err)
	}
	return map[string]any{"launched": true, "path": execPath, "source": source}, nil
}
