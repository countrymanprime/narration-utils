package main

import (
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
//     this project's bridge right now. Always false ("unknown") here: nothing
//     in the app today gives a liveness signal for the bridge (no heartbeat),
//     and building one is Phase 6 of the PRD (the reachability/verification
//     spike, W10). TODO(PRD Phase 6): replace this with a real check once the
//     spike lands a bridge command or heartbeat.
//   - matches: whether the DAW project REAPER has open right now is the
//     linked file. Also always false ("unknown") here for the same reason:
//     it needs the same Phase 6/7 bridge work (W10, W14, Phase 7 "Open-project
//     verification") before it is observable at all.
//
// projectFolder empty (no project attached yet) short-circuits to all-false:
// there is nothing to link.
func dawLinkFacts(reporter *persist.Reporter, projectFolder string) (linked, reachable, matches bool) {
	if projectFolder == "" {
		return false, false, false
	}
	manifest, ok, err := project.Load(reporter, projectFolder)
	if err != nil || !ok || manifest == nil || manifest.DawProjectFile == nil {
		return false, false, false
	}
	_, resolved := manifest.DawProjectFile.Resolve(projectFolder)
	// reachable and matches are always false/unknown for now; see the doc
	// comment above (Phase 6 TODO).
	return resolved, false, false
}
