//go:build !windows

package update

import (
	"errors"
	"os/exec"
	"syscall"
	"time"
)

// SpawnDetached starts the program in its own session so it outlives this process. Only Windows replaces itself; this exists so the
// package builds and its tests run everywhere.
func SpawnDetached(program string, args []string, dir string) error {
	command := exec.Command(program, args...) //nolint:gosec // G204: the program is this app's own executable, the arguments are the ones it was started with
	command.Dir = dir
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := command.Start(); err != nil {
		return errors.Join(userError("The new version could not be started."), err)
	}
	// Reap the child when it exits: a released child that ends stays a zombie, and processAlive (kill 0) would call it running.
	go func() { _ = command.Wait() }()
	return nil
}

// processAlive reports whether the process is still running.
func processAlive(pid int) bool { return syscall.Kill(pid, 0) == nil }

// WaitForExit returns when the process has ended, or after timeout.
func WaitForExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if syscall.Kill(pid, 0) != nil {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}
