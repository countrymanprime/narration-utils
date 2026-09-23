package project

import (
	"os"
	"path/filepath"
)

// DawLink is a project's link to its DAW (REAPER) project file, stored both as
// an absolute path and as a path relative to the project folder (PRD W2:
// "store both"). Either survives a move the other doesn't: the absolute path
// survives the project folder itself moving while the rpp stays where it was
// relative to it, and the relative path survives the whole project folder
// (rpp included) being relocated as a unit.
type DawLink struct {
	Absolute string `json:"absolute"`
	Relative string `json:"relative,omitempty"`
}

// BuildDawLink records rppPath as a link from projectFolder: the absolute path
// always, and a path relative to projectFolder when rppPath is inside it (empty
// otherwise, since "relative to a folder it isn't under" isn't meaningful).
func BuildDawLink(projectFolder, rppPath string) (DawLink, error) {
	absolute, err := filepath.Abs(rppPath)
	if err != nil {
		return DawLink{}, err
	}
	link := DawLink{Absolute: absolute}
	if relative, err := filepath.Rel(projectFolder, absolute); err == nil && !isOutsideFolder(relative) {
		link.Relative = relative
	}
	return link, nil
}

// isOutsideFolder reports whether a filepath.Rel result climbs out of the base
// folder (starts with ".."), which means rppPath isn't actually inside it.
func isOutsideFolder(relative string) bool {
	return relative == ".." || len(relative) >= 3 && relative[:3] == ".."+string(filepath.Separator)
}

// Resolve returns the file this link points to, preferring whichever path
// currently exists on disk (W2). The absolute path is tried first: it is
// stable across a project folder move where the rpp itself did not move, and
// is what today's Tracks.selectedRpp already stores. The relative path (joined
// against projectFolder) is tried next, covering a project folder that moved
// as a whole. ok is false when neither resolves to a file that exists.
func (l DawLink) Resolve(projectFolder string) (path string, ok bool) {
	if l.Absolute != "" && fileExists(l.Absolute) {
		return l.Absolute, true
	}
	if l.Relative != "" {
		candidate := filepath.Join(projectFolder, l.Relative)
		if fileExists(candidate) {
			return candidate, true
		}
	}
	return "", false
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
