package main

import (
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// dawLinkFacts computes the three separate DAW facts that
// docs/prds/project-workspace-and-daw-link.prd.md's Open Question W13 asks
// Bootstrap to carry, instead of collapsing them into the `daw` label string
// (which today is just "REAPER" or "Standalone" and cannot express any of
// this, W13/W14):
//
//   - linked: whether the project's manifest (project.json) records a DAW
//     project file that still resolves to a file on disk
//     (project.DawLink.Resolve). This is a stored fact and is knowable today.
//   - reachable: whether a running REAPER can be confirmed to be listening on
//     this project's bridge right now (Phase 7, ADR 0092/W10): reach's last
//     PROJECT_STATUS heartbeat is fresh (daw.Reachability.Reachable).
//   - matches: whether the DAW project REAPER has open right now (per that
//     same heartbeat) is the linked file (daw.Reachability.Matches).
//
// reach is nil when no bridge client exists yet (no session directory, or no
// project attached): reachable and matches both stay false in that case.
//
// projectFolder empty (no project attached yet) short-circuits to all-false:
// there is nothing to link.
//
// daw is the launch's own `daw` fact ("REAPER" or "" / "Standalone").
// Open Question W18: a REAPER-launched project the manifest has not linked
// yet (several rpp files in the launched folder, or the narrator simply has
// not linked one) would otherwise gate Proofing shut even though REAPER is
// live and the launcher knows the exact rpp - so a live `--daw REAPER` launch
// counts as linked too, until Phase 5's --project-file matching (resolveProjectFile) is
// wired all the way through the picker rather than just second-instance/startup attach.
func dawLinkFacts(reporter *persist.Reporter, projectFolder, daw_ string, reach *daw.Reachability) (linked, reachable, matches bool) {
	if projectFolder == "" {
		return false, false, false
	}
	resolved, resolvedPath := false, ""
	if manifest, ok, err := project.Load(reporter, projectFolder); err == nil && ok && manifest != nil && manifest.DawProjectFile != nil {
		resolvedPath, resolved = manifest.DawProjectFile.Resolve(projectFolder)
	}
	if reach != nil {
		reachable = reach.Reachable()
		matches = resolved && reach.Matches(resolvedPath)
	}
	return resolved || daw_ == "REAPER", reachable, matches
}
