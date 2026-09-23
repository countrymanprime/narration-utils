//go:build !windows

package daw

import (
	"os/exec"
	"syscall"
)

// Launch starts program with args in its own session so it outlives this process. REAPER itself is Windows-only
// so far (ADR 0030); this exists so the package builds and its tests run on every platform CI covers.
func Launch(program string, args ...string) error {
	command := exec.Command(program, args...) //nolint:gosec // G204: program is a resolved reaper.exe path (Resolve), args are file paths this app built
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}
