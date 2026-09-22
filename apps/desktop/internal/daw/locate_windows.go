//go:build windows

package daw

import (
	"golang.org/x/sys/windows/registry"
)

// uninstallKeys are the two views of the "Add or Remove Programs" list a
// 64-bit REAPER install can be registered under (the Phase 6 spike found the
// native x64 REAPER install under the first one; WOW6432Node covers a 32-bit
// install running on 64-bit Windows).
var uninstallKeys = []string{
	`SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
	`SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
}

// LocateReaperExecutable auto-detects reaper.exe: first the Windows
// "Uninstall" registry entries (the source the Phase 6 spike verified
// against a real install, docs/research/reaper-spike-s6-daw-reachability.md),
// then the .rpp file association as a fallback for an install that did not
// register there.
func LocateReaperExecutable() (path, source string, err error) {
	if found, ok := pickFromUninstallEntries(readUninstallEntries(), fileExists); ok {
		return found, SourceUninstallEntry, nil
	}
	if command, ok := readAssociationCommand(); ok {
		if resolved, ok := parseAssociationCommand(command); ok && fileExists(resolved) {
			return resolved, SourceFileAssociation, nil
		}
	}
	return "", "", ErrNotFound
}

func readUninstallEntries() []installEntry {
	var entries []installEntry
	for _, root := range uninstallKeys {
		key, err := registry.OpenKey(registry.LOCAL_MACHINE, root, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		names, err := key.ReadSubKeyNames(-1)
		_ = key.Close()
		if err != nil {
			continue
		}
		for _, name := range names {
			entries = append(entries, readOneUninstallEntry(root, name))
		}
	}
	return entries
}

func readOneUninstallEntry(root, name string) installEntry {
	sub, err := registry.OpenKey(registry.LOCAL_MACHINE, root+`\`+name, registry.QUERY_VALUE)
	if err != nil {
		return installEntry{}
	}
	defer func() { _ = sub.Close() }()
	displayName, _, _ := sub.GetStringValue("DisplayName")
	installLocation, _, _ := sub.GetStringValue("InstallLocation")
	return installEntry{DisplayName: displayName, InstallLocation: installLocation}
}

// readAssociationCommand reads the .rpp ProgID's open command. REAPER's
// installer registers a 64-bit build under "open64" rather than plain "open"
// (verified in the Phase 6 spike); both are tried since a different REAPER
// build may use the plain key.
func readAssociationCommand() (string, bool) {
	for _, verb := range []string{"open64", "open"} {
		key, err := registry.OpenKey(registry.CLASSES_ROOT, `Reaper.Project\shell\`+verb+`\command`, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		value, _, err := key.GetStringValue("")
		_ = key.Close()
		if err == nil && value != "" {
			return value, true
		}
	}
	return "", false
}
