//go:build windows

package daw

import (
	"strings"

	"golang.org/x/sys/windows"
)

// IsRunning reports whether a process whose executable file name is exeName (for example "reaper.exe") is running for any user
// on this computer. A snapshot that cannot be taken answers false: the caller then behaves as it did before it could tell.
func IsRunning(exeName string) bool {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer func() { _ = windows.CloseHandle(snapshot) }()
	entry := windows.ProcessEntry32{Size: uint32(sizeofProcessEntry32)}
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		if strings.EqualFold(windows.UTF16ToString(entry.ExeFile[:]), exeName) {
			return true
		}
	}
	return false
}
