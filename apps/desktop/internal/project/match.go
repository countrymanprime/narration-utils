package project

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// FindByDawFile scans projectsDir's immediate subfolders for the one project
// whose manifest links rppPath as its DAW project file
// (docs/prds/project-workspace-and-daw-link.prd.md Phase 5, W5: "match by
// linked file"; W4: the rpp may live outside its project's folder, so this
// walks every project's own link rather than assuming rppPath's containing
// folder is the project).
//
// For each candidate it resolves the manifest's link the same way
// dawLinkFacts does (DawLink.Resolve: whichever of the absolute/relative
// paths currently exists on disk) and compares that against rppPath, both
// cleaned and lower-cased for a case-insensitive match (Windows paths are not
// case-sensitive, and this is the first platform, ADR 0030).
//
// ok is false when projectsDir cannot be listed, rppPath is empty (an unsaved
// REAPER project has no file to match, W5), or no project's link resolves to
// rppPath. Callers that get ok=false fall back to their existing behaviour
// (the picker, or the rpp's own folder) unchanged.
func FindByDawFile(reporter *persist.Reporter, projectsDir, rppPath string) (folder, name string, ok bool) {
	if projectsDir == "" || rppPath == "" {
		return "", "", false
	}
	target := normalizePath(rppPath)
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return "", "", false
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		candidate := filepath.Join(projectsDir, entry.Name())
		manifest, loaded, loadErr := Load(reporter, candidate)
		if loadErr != nil || !loaded || manifest == nil || manifest.DawProjectFile == nil {
			continue
		}
		resolved, exists := manifest.DawProjectFile.Resolve(candidate)
		if !exists || normalizePath(resolved) != target {
			continue
		}
		return candidate, manifest.Name, true
	}
	return "", "", false
}

// normalizePath makes a path absolute (best effort; the input is kept as-is
// if that fails) and case-folds it so two spellings of the same Windows path
// compare equal.
func normalizePath(path string) string {
	if absolute, err := filepath.Abs(path); err == nil {
		path = absolute
	}
	return strings.ToLower(filepath.Clean(path))
}
