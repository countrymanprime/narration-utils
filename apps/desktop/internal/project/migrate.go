package project

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// AmbiguousRppError is returned by EnsureDawLink when several *.rpp files sit
// directly in the project folder and nothing already resolves a choice: W3
// says to auto-adopt a sole file silently but ask when several exist, so the
// caller (a binding, eventually) can prompt the narrator with Candidates
// instead of guessing.
type AmbiguousRppError struct {
	Candidates []string
}

func (e *AmbiguousRppError) Error() string {
	return fmt.Sprintf("%d REAPER project files were found; choose which one to link", len(e.Candidates))
}

// EnsureDawLink resolves a project's DAW file link exactly once, in this order
// (PRD W1-W3):
//
//  1. An existing manifest link that still resolves to a file on disk is
//     reused as-is; changed is false.
//  2. Otherwise, the legacy Tracks.selectedRpp value (settings.json, read by
//     the caller) is adopted as the link if it still exists on disk.
//  3. Otherwise, a sole *.rpp file found directly in the project folder is
//     adopted silently, so no existing project regresses to a disabled Tracks
//     page (W3).
//
// When several *.rpp files exist in the folder and neither 1 nor 2 resolved a
// choice, it returns *AmbiguousRppError instead of guessing (W3: "ask when
// several exist"). When nothing resolves and the folder holds no *.rpp files
// at all, it returns the zero DawLink with changed false and a nil error:
// there is simply nothing to link yet.
func EnsureDawLink(projectFolder string, manifest *Manifest, legacySelectedRpp string) (DawLink, bool, error) {
	if manifest != nil && manifest.DawProjectFile != nil {
		if resolved, ok := manifest.DawProjectFile.Resolve(projectFolder); ok {
			link, err := BuildDawLink(projectFolder, resolved)
			if err != nil {
				return DawLink{}, false, err
			}
			return link, false, nil
		}
	}

	if legacySelectedRpp != "" && fileExists(legacySelectedRpp) {
		link, err := BuildDawLink(projectFolder, legacySelectedRpp)
		if err != nil {
			return DawLink{}, false, err
		}
		return link, true, nil
	}

	candidates, err := findRppFiles(projectFolder)
	if err != nil {
		return DawLink{}, false, err
	}
	switch len(candidates) {
	case 0:
		return DawLink{}, false, nil
	case 1:
		link, err := BuildDawLink(projectFolder, candidates[0])
		if err != nil {
			return DawLink{}, false, err
		}
		return link, true, nil
	default:
		return DawLink{}, false, &AmbiguousRppError{Candidates: candidates}
	}
}

// findRppFiles lists every top-level *.rpp file directly inside folder,
// sorted by path. It deliberately does not recurse, matching
// internal/tracks.Discover: a nested .rpp under "Backups" or a render output
// folder is not a project file the narrator chose.
func findRppFiles(folder string) ([]string, error) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, fmt.Errorf("could not look for a REAPER project file: %w", err)
	}
	var found []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".rpp") {
			found = append(found, filepath.Join(folder, entry.Name()))
		}
	}
	sort.Strings(found)
	return found, nil
}
