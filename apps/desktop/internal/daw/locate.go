// Package daw locates the REAPER executable on the host machine
// (docs/prds/project-workspace-and-daw-link.prd.md Phase 6 spike, W11) so a
// future launch action (Phase 8) never needs the narrator to type a path by
// hand. The evidence behind the two auto-detect sources this package tries is
// recorded in docs/research/reaper-spike-s6-daw-reachability.md and
// docs/adr/0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md.
//
// Auto-detect is preferred over asking the narrator, and a Settings override
// always wins when it points at a real file (Resolve below): the owner
// recommendation from Open Question W11.
package daw

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ErrNotFound is returned when no auto-detect source located reaper.exe.
var ErrNotFound = errors.New("reaper.exe was not found on this machine")

// Source names where a resolved path came from, for a caller that wants to
// tell the narrator ("found automatically" vs. "your Settings path").
const (
	SourceSettingsOverride = "settings_override"
	SourceUninstallEntry   = "uninstall_registry"
	SourceFileAssociation  = "file_association"
)

// installEntry is one program the Windows "Uninstall" registry key lists:
// enough of it to recognize a REAPER install and find its executable.
type installEntry struct {
	DisplayName     string
	InstallLocation string
}

// Resolve returns the REAPER executable to use and where it came from.
// override is a narrator-supplied Settings path (DAW.reaper_path, stored
// through the existing three-layer settings.Store, no schema change needed);
// when it names a file that exists, it always wins. Otherwise Resolve tries
// autoDetect, which the caller supplies (LocateReaperExecutable on Windows,
// or a fake in tests).
func Resolve(override string, autoDetect func() (string, string, error)) (path, source string, err error) {
	if override != "" {
		if info, statErr := os.Stat(override); statErr == nil && !info.IsDir() {
			return override, SourceSettingsOverride, nil
		}
	}
	if autoDetect == nil {
		return "", "", ErrNotFound
	}
	return autoDetect()
}

// fileExists reports whether path names a real, non-directory file. It is a
// var, not a plain func, only so a test in this package could fake it if a
// future test needs to; the production windows locator calls it directly.
var fileExists = func(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// pickFromUninstallEntries returns the InstallLocation of the first entry
// whose DisplayName looks like a REAPER install ("REAPER", "REAPER (x64)",
// a future "REAPER (arm64)", but not some unrelated program that merely
// mentions REAPER in a longer description), joined with reaper.exe, when
// that file exists on disk. exists is injected so the selection logic is
// tested without touching the real filesystem.
func pickFromUninstallEntries(entries []installEntry, exists func(string) bool) (string, bool) {
	for _, entry := range entries {
		if !looksLikeReaper(entry.DisplayName) || entry.InstallLocation == "" {
			continue
		}
		candidate := filepath.Join(entry.InstallLocation, "reaper.exe")
		if exists(candidate) {
			return candidate, true
		}
	}
	return "", false
}

// looksLikeReaper matches Cockos's own naming exactly: "REAPER", or "REAPER"
// followed by a parenthesized architecture suffix (observed real value:
// "REAPER (x64)", spike run 2026-09-22), case-insensitively. It is
// deliberately narrow rather than a bare "starts with REAPER" prefix check,
// which would also match an unrelated program whose longer name happens to
// start with the same word (the Uninstall key is a large, uncurated list).
func looksLikeReaper(displayName string) bool {
	trimmed := strings.TrimSpace(displayName)
	upper := strings.ToUpper(trimmed)
	if upper == "REAPER" {
		return true
	}
	rest, ok := strings.CutPrefix(upper, "REAPER (")
	return ok && strings.HasSuffix(rest, ")")
}

// parseAssociationCommand extracts the executable from a Windows file-association
// command string such as `"C:\Program Files\REAPER (x64)\reaper.exe" -project "%1"`
// (the real value read from HKCR\Reaper.Project\shell\open64\command in the
// Phase 6 spike). It returns false when the string does not start with a
// quoted path.
func parseAssociationCommand(command string) (string, bool) {
	command = strings.TrimSpace(command)
	if !strings.HasPrefix(command, `"`) {
		return "", false
	}
	rest := command[1:]
	end := strings.Index(rest, `"`)
	if end <= 0 {
		return "", false
	}
	return rest[:end], true
}
