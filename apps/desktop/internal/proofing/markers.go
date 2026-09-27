// This file is Phase 3 of docs/prds/proofing-readiness-signals.prd.md: a
// static read of the saved project's proofer PICKUP: markers (the
// reaper-automation-follow-through PRD's Phase 8 convention, `PICKUP: <body>`
// open and `PICKUP_DONE: <body>` resolved), attributed to a chapter by its
// mapped track's played-item span (Q15) and registered as a pickup source
// (Phase 1). There is no ledger record, because nothing was analyzed - the
// basis is the saved project's own modified time (tracks.Project.Markers,
// already parsed once per evaluation into EvidenceView.Project). No Lua, no
// bindings, no UI: this is the standalone fallback (Q6 option A); RF's own
// count_pickups over the live bridge stays a Could once its Lua is verified
// in REAPER.
package proofing

import (
	"fmt"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// AnalyzerProoferMarkers identifies the proofer PICKUP: marker source (Q1).
// It never comes from the findings store - gatherSources never sees it, and
// it is not in knownSources - so markerSource builds its SourceReport
// directly; sourceOrder still places its reading position.
const AnalyzerProoferMarkers = "proofer-markers"

const (
	pickupMarkerPrefix     = "PICKUP:"
	pickupDoneMarkerPrefix = "PICKUP_DONE:"
)

// markerSource reads the chapter's PICKUP: markers from the saved project.
// Unlike Compare or take review there is no run record to be stale against: a
// static read only ever describes the project as it is right now. The source
// has never run for the chapter (RunNever, does not vouch) when its
// mapped-track span holds no PICKUP: or PICKUP_DONE: marker at all - nothing
// yet says the proofer worked this chapter with markers, matching a chapter
// that was never recorded into or compared - and is current (RunCurrent) the
// moment the span holds at least one, open or done. chapterTrack's mapping
// problems (unreadable project, unmapped or ambiguous track) propagate
// unchanged, same as every other source.
func markerSource(chapter stages.ChapterContext, view stages.EvidenceView) SourceReport {
	report := SourceReport{Analyzer: AnalyzerProoferMarkers, Label: "Proofer markers", Tracked: true, Run: RunStatus{State: RunNever}}
	track, problem := chapterTrack(chapter, view)
	if problem != nil {
		report.Run = *problem
		return report
	}
	start, end, ok := chapterRange(track)
	if !ok {
		return report
	}
	attributed := 0
	for _, marker := range view.Project.Markers {
		body, done, isPickup := pickupMarkerBody(marker.Name)
		if !isPickup || marker.Position < start || marker.Position > end {
			continue
		}
		attributed++
		if done {
			continue
		}
		report.Items = append(report.Items, PickupItem{
			FindingID: markerFindingID(marker), Category: findings.CategoryPickup, Text: markerText(body),
		})
	}
	if attributed == 0 {
		return report
	}
	report.Run = RunStatus{State: RunCurrent, At: view.ProjectFile.ModTime}
	return report
}

// pickupMarkerBody reports whether name is a proofer pickup marker (RF's
// convention) and, when it is, its body text after the prefix and whether it
// carries the done convention. isPickup is false for any other marker name,
// distinguishing that from a pickup marker with an empty body.
func pickupMarkerBody(name string) (body string, done, isPickup bool) {
	switch {
	case strings.HasPrefix(name, pickupDoneMarkerPrefix):
		return strings.TrimSpace(name[len(pickupDoneMarkerPrefix):]), true, true
	case strings.HasPrefix(name, pickupMarkerPrefix):
		return strings.TrimSpace(name[len(pickupMarkerPrefix):]), false, true
	default:
		return "", false, false
	}
}

func markerText(body string) string {
	if body == "" {
		return "pickup marker"
	}
	return body
}

// markerFindingID identifies a marker item stably across reads: by its own
// GUID when the saved project has one (REAPER writes one for a marker made
// through the API), else by its number and position.
func markerFindingID(marker tracks.Marker) string {
	if marker.GUID != "" {
		return "reaper-marker:" + marker.GUID
	}
	return fmt.Sprintf("reaper-marker:%d@%.6f", marker.Index, marker.Position)
}

// UnattributedPickupMarkers lists every proofer pickup marker (open or done)
// in the saved project that falls inside no chapter's mapped-track item span
// (Q15 option A): it never blocks a chapter's signal, but is worth a
// project-level note once a page has somewhere to show one. documentID scopes
// the confirmed mapping read; a project with no mapping store reports none.
func UnattributedPickupMarkers(documentID string, view stages.EvidenceView) ([]tracks.Marker, error) {
	if view.Mapping == nil {
		return nil, nil
	}
	links, err := view.Mapping.List(documentID)
	if err != nil {
		return nil, err
	}
	var spans [][2]float64
	for _, link := range links {
		for _, track := range view.Project.Tracks {
			if track.GUID != link.TrackGUID {
				continue
			}
			if start, end, ok := chapterRange(track); ok {
				spans = append(spans, [2]float64{start, end})
			}
		}
	}
	var unattributed []tracks.Marker
	for _, marker := range view.Project.Markers {
		if _, _, isPickup := pickupMarkerBody(marker.Name); !isPickup {
			continue
		}
		covered := false
		for _, span := range spans {
			if marker.Position >= span[0] && marker.Position <= span[1] {
				covered = true
				break
			}
		}
		if !covered {
			unattributed = append(unattributed, marker)
		}
	}
	return unattributed, nil
}
