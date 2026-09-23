package main

import (
	"fmt"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// tracksDiscover lists every *.rpp file discovered in the project folder,
// along with a resolved "selected" path when the choice isn't ambiguous: the
// narrator's previously saved choice if it still exists among the candidates,
// or the sole candidate when there's only one. It reads the project folder and
// settings from one h.services() snapshot, so both belong to the same project
// even if a project switch lands mid-call.
func (h *Host) tracksDiscover() (map[string]any, error) {
	return discoverTracks(h.services())
}

func discoverTracks(svc hostServices) (map[string]any, error) {
	candidates, selected, err := discoverProjectFiles(svc.config.projectFolder, svc.settings)
	if err != nil {
		return nil, err
	}
	return map[string]any{"candidates": candidates, "selected": selected}, nil
}

// discoverProjectFiles lists the *.rpp files directly in folder and resolves
// the selected one (the narrator's saved choice, or the only candidate), ""
// when the choice is ambiguous.
func discoverProjectFiles(folder string, store *settings.Store) (candidates []string, selected string, err error) {
	if folder == "" {
		return nil, "", fmt.Errorf("open a project before viewing tracks")
	}
	candidates, err = tracks.Discover(folder)
	if err != nil {
		return nil, "", fmt.Errorf("could not look for a REAPER project file: %w", err)
	}
	if saved, ok := store.Project("Tracks")["selectedRpp"]; ok && contains(candidates, saved) {
		selected = saved
	} else if len(candidates) == 1 {
		selected = candidates[0]
	}
	return candidates, selected, nil
}

// selectedProjectFile is the saved .rpp the analyses read (the recording
// coverage service's Config.ProjectFile): the Tracks page's selection, with
// the same errors tracksList gives when there is none.
func selectedProjectFile(folder string, store *settings.Store) (string, error) {
	candidates, selected, err := discoverProjectFiles(folder, store)
	if err != nil {
		return "", err
	}
	if selected == "" {
		if len(candidates) == 0 {
			return "", fmt.Errorf("no REAPER project (.rpp) file was found in this project folder")
		}
		return "", fmt.Errorf("choose which REAPER project file to use before viewing tracks")
	}
	return selected, nil
}

// tracksSelect persists the narrator's explicit choice among an ambiguous
// set of discovered .rpp files, refusing anything that isn't one of them so
// the saved path can never point outside the current project folder. The
// candidates and the store the choice is saved to come from one snapshot.
func (h *Host) tracksSelect(path string) (map[string]any, error) {
	svc := h.services()
	discovery, err := discoverTracks(svc)
	if err != nil {
		return nil, err
	}
	candidates, _ := discovery["candidates"].([]string)
	if !contains(candidates, path) {
		return nil, fmt.Errorf("that file is not a REAPER project in the current project folder")
	}
	value := path
	if err := svc.settings.Save("Tracks", "project", map[string]*string{"selectedRpp": &value}); err != nil {
		return nil, err
	}
	return map[string]any{"candidates": candidates, "selected": path}, nil
}

// tracksList resolves the current selection (see tracksDiscover) and parses
// it. An unresolved selection is reported as a distinct, actionable error
// rather than an empty track list, so the frontend can tell "no project
// file exists yet" apart from "choose which one to use."
func (h *Host) tracksList() (tracks.Project, error) {
	return selectedProject(h.services())
}

// selectedProject parses the .rpp svc's project has selected, with
// tracksList's errors when none is selected; shared by every binding that
// reads the project's tracks.
func selectedProject(svc hostServices) (tracks.Project, error) {
	selected, err := selectedProjectFile(svc.config.projectFolder, svc.settings)
	if err != nil {
		return tracks.Project{}, err
	}
	project, err := tracks.Parse(selected)
	if err != nil {
		return tracks.Project{}, fmt.Errorf("could not read %s: %w", filepath.Base(selected), err)
	}
	return project, nil
}
