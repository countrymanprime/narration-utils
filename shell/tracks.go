package main

import (
	"fmt"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// tracksDiscover snapshots the project folder and settings pointer under
// h.mu (see docs/architecture/host-binding-concurrency.md - configureLocked
// reassigns both on every project switch) and lists every *.rpp file
// discovered in it, along with a resolved "selected" path when the choice
// isn't ambiguous: the narrator's previously saved choice if it still
// exists among the candidates, or the sole candidate when there's only one.
func (h *Host) tracksDiscover() (map[string]any, error) {
	h.mu.RLock()
	folder, settings := h.config.projectFolder, h.settings
	h.mu.RUnlock()
	if folder == "" {
		return nil, fmt.Errorf("open a project before viewing tracks")
	}
	candidates, err := tracks.Discover(folder)
	if err != nil {
		return nil, fmt.Errorf("could not look for a REAPER project file: %w", err)
	}
	selected := ""
	if saved, ok := settings.Project("Tracks")["selectedRpp"]; ok && contains(candidates, saved) {
		selected = saved
	} else if len(candidates) == 1 {
		selected = candidates[0]
	}
	return map[string]any{"candidates": candidates, "selected": selected}, nil
}

// tracksSelect persists the narrator's explicit choice among an ambiguous
// set of discovered .rpp files, refusing anything that isn't one of them so
// the saved path can never point outside the current project folder.
func (h *Host) tracksSelect(path string) (map[string]any, error) {
	h.mu.RLock()
	settings := h.settings
	h.mu.RUnlock()
	discovery, err := h.tracksDiscover()
	if err != nil {
		return nil, err
	}
	candidates, _ := discovery["candidates"].([]string)
	if !contains(candidates, path) {
		return nil, fmt.Errorf("that file is not a REAPER project in the current project folder")
	}
	value := path
	if err := settings.Save("Tracks", "project", map[string]*string{"selectedRpp": &value}); err != nil {
		return nil, err
	}
	return map[string]any{"candidates": candidates, "selected": path}, nil
}

// tracksList resolves the current selection (see tracksDiscover) and parses
// it. An unresolved selection is reported as a distinct, actionable error
// rather than an empty track list, so the frontend can tell "no project
// file exists yet" apart from "choose which one to use."
func (h *Host) tracksList() (tracks.Project, error) {
	discovery, err := h.tracksDiscover()
	if err != nil {
		return tracks.Project{}, err
	}
	selected, _ := discovery["selected"].(string)
	if selected == "" {
		candidates, _ := discovery["candidates"].([]string)
		if len(candidates) == 0 {
			return tracks.Project{}, fmt.Errorf("no REAPER project (.rpp) file was found in this project folder")
		}
		return tracks.Project{}, fmt.Errorf("choose which REAPER project file to use before viewing tracks")
	}
	project, err := tracks.Parse(selected)
	if err != nil {
		return tracks.Project{}, fmt.Errorf("could not read %s: %w", filepath.Base(selected), err)
	}
	return project, nil
}
