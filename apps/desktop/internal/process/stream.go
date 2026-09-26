package process

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

// streamStderrTail bounds how much of a streamed child's stderr is kept for
// diagnostics; only the most recent bytes matter when it fails.
const streamStderrTail = 16 * 1024

// StreamChild is a sidecar whose stdout is delivered line by line while it
// runs (the batch sidecars started with Start have theirs discarded).
type StreamChild struct {
	*Child
	command *exec.Cmd
	done    chan struct{}

	stderrMu sync.Mutex
	// +checklocks:stderrMu
	stderr []byte
}

// Done is closed once the process has exited and every stdout line has been
// delivered, so nothing arrives after it.
func (c *StreamChild) Done() <-chan struct{} { return c.done }

// Kill terminates the process. A cooperative stop (a sentinel file the sidecar
// watches) is preferred; this is the fallback when that does not work.
func (c *StreamChild) Kill() error { return c.command.Process.Kill() }

// StderrTail is the last bytes the process wrote to stderr.
func (c *StreamChild) StderrTail() string {
	c.stderrMu.Lock()
	defer c.stderrMu.Unlock()
	return string(c.stderr)
}

// captureStderr keeps the in-memory tail (for an error message) and, when sink is not nil, also copies every byte to
// the run's own stderr file (docs/prds/tool-run-logging.prd.md phase 2): the tail alone is not "kept", only the last
// 16 KiB of it.
func (c *StreamChild) captureStderr(reader io.Reader, sink io.Writer) {
	buffer := make([]byte, 4096)
	for {
		count, err := reader.Read(buffer)
		if count > 0 {
			chunk := buffer[:count]
			c.stderrMu.Lock()
			c.stderr = append(c.stderr, chunk...)
			if extra := len(c.stderr) - streamStderrTail; extra > 0 {
				c.stderr = append([]byte(nil), c.stderr[extra:]...)
			}
			c.stderrMu.Unlock()
			if sink != nil {
				_, _ = sink.Write(chunk)
			}
		}
		if err != nil {
			return
		}
	}
}

// deliverLines calls onLine for each non-empty stdout line. It reads with
// ReadString, not a Scanner, so a very long line (the sidecar's one-off script
// event describes a whole chapter) is never truncated or rejected.
func deliverLines(reader io.Reader, onLine func(string)) {
	buffered := bufio.NewReader(reader)
	for {
		line, err := buffered.ReadString('\n')
		if trimmed := strings.TrimRight(line, "\r\n"); trimmed != "" && onLine != nil {
			onLine(trimmed)
		}
		if err != nil {
			return
		}
	}
}

// StartStream runs a sidecar like Start (no console window on Windows, owned
// by the same Job Object so closing the supervisor kills it) but hands each
// stdout line to onLine and keeps the tail of stderr. onLine runs on its own
// goroutine and must not block for long. Cancelling ctx kills the process.
func (s *Supervisor) StartStream(ctx context.Context, onLine func(string), program string, args ...string) (*StreamChild, error) {
	command := exec.CommandContext(ctx, program, args...)
	configure(command)
	command.Env = runEnv(ctx)
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

	child := &StreamChild{Child: &Child{}, command: command, done: make(chan struct{})}
	stderrSink := runlog.FromContext(ctx).StderrWriter()
	var readers sync.WaitGroup
	readers.Add(2)
	go func() { defer readers.Done(); deliverLines(stdout, onLine) }()
	go func() { defer readers.Done(); child.captureStderr(stderr, stderrSink) }()
	go func() {
		// Wait must not run before the pipes are fully read.
		readers.Wait()
		_ = stderrSink.Close()
		waitErr := command.Wait()
		code := 0
		if waitErr != nil {
			if exit, ok := waitErr.(*exec.ExitError); ok {
				code = exit.ExitCode()
			} else {
				code = -1
			}
		}
		child.mu.Lock()
		child.exitCode = &code
		child.mu.Unlock()
		close(child.done)
	}()
	return child, nil
}
