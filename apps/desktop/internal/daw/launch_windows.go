//go:build windows

package daw

import (
	"errors"
	"os/exec"
	"syscall"
)

const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
	createBreakawayJob    = 0x01000000
)

// Launch starts program with args, detached from this process (Phase 8, PRD "Launching REAPER": a detached spawn,
// never the process supervisor, whose Windows job object kills every child when the app closes -
// apps/desktop/internal/process/job_windows.go): its own process group, outside any job this process is in, so
// REAPER outlives the app when the narrator quits it. Tried first with CREATE_BREAKAWAY_JOB (needed only when this
// process is itself inside a job that forbids children leaving it, the same situation
// apps/desktop/internal/update/spawn_windows.go already handles for a self-update); a job that refuses breakaway
// rejects the flag, so the second attempt omits it.
func Launch(program string, args ...string) error {
	var causes []error
	for _, flags := range []uint32{detachedProcess | createNewProcessGroup | createBreakawayJob, detachedProcess | createNewProcessGroup} {
		command := exec.Command(program, args...) //nolint:gosec // G204: program is a resolved reaper.exe path (Resolve), args are file paths this app built
		command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags}
		if err := command.Start(); err != nil {
			causes = append(causes, err)
			continue
		}
		return command.Process.Release()
	}
	return errors.Join(causes...)
}
