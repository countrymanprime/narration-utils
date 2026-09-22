//go:build windows

package update

import (
	"errors"
	"os/exec"
	"syscall"
	"time"

	winsys "golang.org/x/sys/windows"
)

const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
	createBreakawayJob    = 0x01000000
)

// SpawnDetached starts the program so that it outlives this process: no console, its own process group, and outside any job object
// this process is in (the sidecars' kill-on-close job holds only the sidecars, but REAPER may have started this program in a job of
// its own that must not take the new one with it). A job that forbids breakaway refuses that flag, so it is tried without.
func SpawnDetached(program string, args []string, dir string) error {
	var causes []error
	for _, flags := range []uint32{detachedProcess | createNewProcessGroup | createBreakawayJob, detachedProcess | createNewProcessGroup} {
		command := exec.Command(program, args...) //nolint:gosec // G204: the program is this app's own executable, the arguments are the ones it was started with
		command.Dir = dir
		command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags}
		if err := command.Start(); err != nil {
			causes = append(causes, err)
			continue
		}
		return command.Process.Release()
	}
	// The narrator reads the sentence; the log keeps why (antivirus and SmartScreen say so here).
	return errors.Join(append([]error{userError("The new version could not be started.")}, causes...)...)
}

// processAlive reports whether the process is still running.
func processAlive(pid int) bool {
	handle, err := winsys.OpenProcess(winsys.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid)) //nolint:gosec // G115: a process id is a positive 32-bit number, parsed with a bound
	if err != nil {
		return false
	}
	defer func() { _ = winsys.CloseHandle(handle) }()
	var code uint32
	if err := winsys.GetExitCodeProcess(handle, &code); err != nil {
		return false
	}
	return code == 259 // STILL_ACTIVE
}

// WaitForExit returns when the process has ended, or after timeout. A process that is already gone (or that cannot be opened) is
// finished as far as the caller is concerned: the wait exists so a new copy does not start while the old one still holds the
// single-instance lock.
func WaitForExit(pid int, timeout time.Duration) {
	handle, err := winsys.OpenProcess(winsys.SYNCHRONIZE, false, uint32(pid)) //nolint:gosec // G115: a process id is a positive 32-bit number, parsed with a bound
	if err != nil {
		return
	}
	defer func() { _ = winsys.CloseHandle(handle) }()
	_, _ = winsys.WaitForSingleObject(handle, uint32(timeout.Milliseconds())) //nolint:gosec // G115: the timeout is a few seconds
}
