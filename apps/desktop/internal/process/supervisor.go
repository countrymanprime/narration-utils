// Package process supervises the two retained Python analysis sidecars. It
// drains output so a verbose child cannot deadlock, and owns Windows job
// handles so close/crash kills the entire child tree.
package process

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"
)

type Child struct {
	mu sync.RWMutex
	// +checklocks:mu
	exitCode *int
}

func (c *Child) HasExited() bool { c.mu.RLock(); defer c.mu.RUnlock(); return c.exitCode != nil }
func (c *Child) ExitCode() (int, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.exitCode == nil {
		return 0, false
	}
	return *c.exitCode, true
}

type Supervisor struct{ jobs jobSet }

func NewSupervisor() *Supervisor { return &Supervisor{jobs: newJobSet()} }

// Start runs a sidecar without a console window on Windows, drains both
// streams, and records exit status. Cancellation is intentionally separate:
// existing Python tools use their documented .cancel sentinels rather than a
// forceful process kill so they can leave their result files consistent.
func (s *Supervisor) Start(ctx context.Context, program string, args ...string) (*Child, error) {
	command := exec.CommandContext(ctx, program, args...)
	configure(command)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("could not start %s: %w", program, err)
	}
	if err := s.jobs.assign(command.Process.Pid); err != nil {
		_ = command.Process.Kill()
		return nil, err
	}
	child := &Child{}
	go func() { _, _ = io.Copy(io.Discard, stdout) }()
	go func() { _, _ = io.Copy(io.Discard, stderr) }()
	go func() {
		err := command.Wait()
		code := 0
		if err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				code = exit.ExitCode()
			} else {
				code = -1
			}
		}
		child.mu.Lock()
		child.exitCode = &code
		child.mu.Unlock()
	}()
	return child, nil
}

// runWaitDelay is how long Run waits for a program's output once the program has exited (or been stopped): a descendant that kept the
// pipe open must not keep Run waiting for ever.
const runWaitDelay = 5 * time.Second

// Run is the synchronous counterpart used for short Story Bible mutations and the packaged smoke test.
// It has the same Job Object ownership as Start. The output is copied into buffers by the standard library and Run returns only when it
// has been read to the end: reading a pipe by hand while Wait closes it can lose the last bytes of what the program printed.
func (s *Supervisor) Run(ctx context.Context, program string, args ...string) (int, string, string, error) {
	command := exec.CommandContext(ctx, program, args...)
	configure(command)
	var out, failure bytes.Buffer
	command.Stdout, command.Stderr = &out, &failure
	command.WaitDelay = runWaitDelay
	if err := command.Start(); err != nil {
		return 0, "", "", fmt.Errorf("could not start %s: %w", program, err)
	}
	if err := s.jobs.assign(command.Process.Pid); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return 0, "", "", err
	}
	waitErr := command.Wait()
	code := 0
	if waitErr != nil && !errors.Is(waitErr, exec.ErrWaitDelay) {
		var exit *exec.ExitError
		if errors.As(waitErr, &exit) {
			code = exit.ExitCode()
		} else {
			code = -1
		}
	}
	return code, out.String(), failure.String(), nil
}

func (s *Supervisor) Close() error { return s.jobs.close() }
