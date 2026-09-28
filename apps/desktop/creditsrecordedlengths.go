package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// CreditsRecordedLengths is a credits row's "actual recorded" (credits-in-chapter-table.prd.md Phase 3): the same
// track-based measurement actual-recorded-column.prd.md gives every manuscript chapter (recordedLengthsFor), read
// for the two credits ids. Never an estimate (ADR 0193): a credits id has its own confirmed link, or none, in the
// same chapter-track-map.json every manuscript chapter uses (ADR 0333), so this reads it directly rather than
// through manuscript.Service's own RecordedLengths hook, which only ever sees the manuscript's own chapter ids.
func (h *Host) CreditsRecordedLengths() (string, error) {
	svc := h.services()
	if svc.manuscript == nil {
		return "", fmt.Errorf("open a project before reading credits recorded lengths")
	}
	data, err := svc.manuscript.Load()
	if err != nil {
		return "", fmt.Errorf("could not read the manuscript: %w", err)
	}
	ids := []string{coverage.CreditsChapterID("opening"), coverage.CreditsChapterID("closing")}
	documentID, _ := data["documentId"].(string)
	var lengths map[string]manuscript.RecordedLength
	if documentID == "" {
		lengths = map[string]manuscript.RecordedLength{
			ids[0]: {Unavailable: manuscript.RecordedUnlinked},
			ids[1]: {Unavailable: manuscript.RecordedUnlinked},
		}
	} else {
		mappings, err := evidence.NewMappingStore(svc.config.projectFolder).List(documentID)
		if err != nil {
			return "", fmt.Errorf("could not read the chapter track links: %w", err)
		}
		project, readable := readSelectedProject(svc.config.projectFolder, svc.settings)
		lengths = recordedLengthsFor(ids, mappings, project, readable)
	}
	return encodeBinding(map[string]any{
		"opening": creditsRecordedLengthPayload(lengths[ids[0]]),
		"closing": creditsRecordedLengthPayload(lengths[ids[1]]),
	}, nil)
}

func creditsRecordedLengthPayload(length manuscript.RecordedLength) map[string]any {
	if length.Unavailable != "" {
		return map[string]any{"recordedUnavailable": string(length.Unavailable)}
	}
	return map[string]any{"recordedSeconds": length.Seconds}
}

// readSelectedProject parses the project's currently selected .rpp, uncached: CreditsRecordedLengths is read on
// demand (opening a credits row's slide-over), not on every chapter-list read, so it does not need
// projectParseCache's warm-reuse the way recordedLengths' per-poll provider does.
func readSelectedProject(folder string, store *settings.Store) (tracks.Project, bool) {
	path, err := selectedProjectFile(folder, store)
	if err != nil {
		return tracks.Project{}, false
	}
	project, err := readProject(path)
	if err != nil {
		return tracks.Project{}, false
	}
	return project, true
}
