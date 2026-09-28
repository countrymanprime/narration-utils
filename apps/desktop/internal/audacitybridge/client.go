package audacitybridge

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// DefaultTimeout is how long one command may take, from writing it to reading its empty line. Audacity answers a scripting command
// on its main thread, so a modal dialog holds the answer back; five seconds is several frames of a busy Audacity without leaving
// the narrator staring at a frozen button.
const DefaultTimeout = 5 * time.Second

// LineEnd is what ends a command on Windows, as Audacity's own pipe_test.py writes it: CR, LF and a NUL (the spec note, "Pipes").
const LineEnd = "\r\n\x00"

// Options configure a Client. The zero value is DefaultTimeout and LineEnd.
type Options struct {
	Timeout time.Duration
	LineEnd string
}

// Client sends one command at a time over a Transport and reads its framed reply. It connects on the first request, and after any
// failure that leaves the connection in doubt (a timeout, a broken frame, a write or read error) it drops the connection, so the
// next request reconnects: a late answer to a timed-out command can never be read as the answer to the next one.
//
// It is safe for concurrent use; requests are serialised, because the pipe carries one conversation.
type Client struct {
	transport Transport
	// Set once in New and read-only after, so no lock guards them.
	// +checklocksignore
	timeout time.Duration
	// +checklocksignore
	lineEnd string

	mu sync.Mutex // guards conn and reader, and serialises requests
	// +checklocks:mu
	conn Conn
	// +checklocks:mu
	reader *bufio.Reader

	reachable atomic.Bool
	lastSeen  atomic.Int64 // unix nanoseconds of the last complete reply
}

// New is a client over transport. It opens nothing until the first request.
func New(transport Transport, opts Options) *Client {
	c := &Client{transport: transport, timeout: opts.Timeout, lineEnd: opts.LineEnd}
	if c.timeout <= 0 {
		c.timeout = DefaultTimeout
	}
	if c.lineEnd == "" {
		c.lineEnd = LineEnd
	}
	return c
}

// Reachable is whether the last request got a complete reply (OK or Failed!). It asks nothing.
func (c *Client) Reachable() bool { return c.reachable.Load() }

// LastSeen is when the last complete reply arrived, or the zero time.
func (c *Client) LastSeen() time.Time {
	n := c.lastSeen.Load()
	if n == 0 {
		return time.Time{}
	}
	return time.Unix(0, n)
}

// Do sends cmd and returns its reply. A command Audacity reports as failed is a *CommandError (errors.Is ErrCommandFailed); no
// pipe is ErrNotReachable; no complete answer within the timeout (or before ctx ends) is ErrTimeout; a broken frame is a
// *ProtocolError. A command with a refused value sends nothing and returns its ErrInvalidValue.
func (c *Client) Do(ctx context.Context, cmd *Command) (Reply, error) {
	line, err := cmd.Encode()
	if err != nil {
		return Reply{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return Reply{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	if c.conn == nil {
		conn, err := c.transport.Dial(ctx)
		if err != nil {
			c.reachable.Store(false)
			if errors.Is(err, ErrNotReachable) || errors.Is(err, ErrUnsupportedPlatform) {
				return Reply{}, err
			}
			if ctx.Err() != nil {
				return Reply{}, ErrTimeout
			}
			return Reply{}, fmt.Errorf("%w: %v", ErrNotReachable, err)
		}
		c.conn, c.reader = conn, bufio.NewReaderSize(conn, 64<<10)
	}
	reply, ok, err := c.exchangeLocked(ctx, line)
	if errors.Is(err, ErrNoProject) {
		// A complete (if empty) answer: Audacity is there and the pipe is in step.
		c.reachable.Store(true)
		c.lastSeen.Store(time.Now().UnixNano())
		return Reply{}, err
	}
	if err != nil {
		_ = c.dropLocked()
		c.reachable.Store(false)
		return Reply{}, err
	}
	c.reachable.Store(true)
	c.lastSeen.Store(time.Now().UnixNano())
	if !ok {
		return reply, &CommandError{Command: cmd.Name(), Lines: reply.Lines}
	}
	return reply, nil
}

type result struct {
	reply Reply
	ok    bool
	err   error
}

// exchangeLocked writes line and reads its reply, giving up at ctx's end. Both run on a goroutine so a transport whose Write or
// Read blocks is unblocked by Close (the caller's dropLocked).
//
// +checklocks:c.mu
func (c *Client) exchangeLocked(ctx context.Context, line string) (Reply, bool, error) {
	conn, reader := c.conn, c.reader
	done := make(chan result, 1)
	go func() {
		if _, err := conn.Write([]byte(line + c.lineEnd)); err != nil {
			done <- result{err: fmt.Errorf("%w: writing the command: %v", ErrNotReachable, err)}
			return
		}
		reply, ok, err := readReply(reader)
		if err != nil {
			var protocol *ProtocolError
			if !errors.As(err, &protocol) && !errors.Is(err, ErrNoProject) {
				err = fmt.Errorf("%w: reading the answer: %v", ErrNotReachable, err)
			}
		}
		done <- result{reply, ok, err}
	}()
	select {
	case r := <-done:
		return r.reply, r.ok, r.err
	case <-ctx.Done():
		// Close unblocks the goroutine; its result lands in the buffered channel and is dropped.
		_ = conn.Close()
		c.conn, c.reader = nil, nil
		return Reply{}, false, ErrTimeout
	}
}

// Close drops the connection, if any. The client stays usable: the next request reconnects.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dropLocked()
}

// +checklocks:c.mu
func (c *Client) dropLocked() error {
	if c.conn == nil {
		return nil
	}
	err := c.conn.Close()
	c.conn, c.reader = nil, nil
	return err
}
