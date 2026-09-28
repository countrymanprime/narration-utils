//go:build windows

package audacitybridge

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"

	"golang.org/x/sys/windows"
)

// The pipe names mod-script-pipe creates on Windows (the spec note, "Pipes"). They are fixed: the host never takes a pipe name from
// a setting, an argument or the page, so nothing outside this file can point the client at another pipe.
const (
	toServerPipe   = `\\.\pipe\ToSrvPipe`
	fromServerPipe = `\\.\pipe\FromSrvPipe`
)

// PipeTransport is Audacity's scripting pipe on this machine. It is local-only by construction: `\\.\pipe\` names a pipe on the
// local computer, never a remote one.
func PipeTransport() Transport { return TransportFunc(dialPipes) }

func dialPipes(ctx context.Context) (Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Audacity's own clients open the pipe it reads first, then the one it writes (pipe_test.py).
	to, err := openPipe(toServerPipe, windows.GENERIC_WRITE)
	if err != nil {
		return nil, err
	}
	from, err := openPipe(fromServerPipe, windows.GENERIC_READ)
	if err != nil {
		_ = windows.CloseHandle(to)
		return nil, err
	}
	return &pipeConn{to: to, from: from}, nil
}

func openPipe(name string, access uint32) (windows.Handle, error) {
	path, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return windows.InvalidHandle, err
	}
	h, err := windows.CreateFile(path, access, 0, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		switch {
		case errors.Is(err, windows.ERROR_FILE_NOT_FOUND), errors.Is(err, windows.ERROR_PATH_NOT_FOUND):
			return windows.InvalidHandle, ErrNotReachable
		case errors.Is(err, windows.ERROR_PIPE_BUSY):
			return windows.InvalidHandle, fmt.Errorf("%w (another program is using Audacity's scripting pipe)", ErrNotReachable)
		default:
			return windows.InvalidHandle, fmt.Errorf("%w: %v", ErrNotReachable, err)
		}
	}
	return h, nil
}

type pipeConn struct {
	to, from  windows.Handle
	closeOnce sync.Once
	closeErr  error
}

func (p *pipeConn) Write(b []byte) (int, error) {
	written := 0
	for written < len(b) {
		var n uint32
		if err := windows.WriteFile(p.to, b[written:], &n, nil); err != nil {
			return written, err
		}
		written += int(n)
	}
	return written, nil
}

func (p *pipeConn) Read(b []byte) (int, error) {
	var n uint32
	err := windows.ReadFile(p.from, b, &n, nil)
	if errors.Is(err, windows.ERROR_BROKEN_PIPE) {
		return int(n), io.EOF
	}
	if err != nil {
		return int(n), err
	}
	if n == 0 && len(b) > 0 {
		return 0, io.EOF
	}
	return int(n), nil
}

// Close cancels any read or write another goroutine is blocked in (CancelIoEx cancels synchronous I/O issued by any thread on the
// handle), then closes both handles.
func (p *pipeConn) Close() error {
	p.closeOnce.Do(func() {
		_ = windows.CancelIoEx(p.to, nil)
		_ = windows.CancelIoEx(p.from, nil)
		p.closeErr = errors.Join(windows.CloseHandle(p.to), windows.CloseHandle(p.from))
	})
	return p.closeErr
}
