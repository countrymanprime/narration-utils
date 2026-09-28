//go:build windows

package audacitybridge

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

var pipeSeq atomic.Int64

// testPipes creates a fresh pair of named pipes under test-only names, the way mod-script-pipe creates ToSrvPipe and FromSrvPipe,
// and returns their names and server handles.
func testPipes(t *testing.T) (toName, fromName string, to, from windows.Handle) {
	t.Helper()
	base := fmt.Sprintf(`\\.\pipe\nu-audacitybridge-test-%d-%d`, os.Getpid(), pipeSeq.Add(1))
	toName, fromName = base+"-to", base+"-from"
	create := func(name string) windows.Handle {
		p, err := windows.UTF16PtrFromString(name)
		if err != nil {
			t.Fatal(err)
		}
		h, err := windows.CreateNamedPipe(p, windows.PIPE_ACCESS_DUPLEX, windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT, 1, 4096, 4096, 0, nil)
		if err != nil {
			t.Fatalf("CreateNamedPipe(%s): %v", name, err)
		}
		t.Cleanup(func() { _ = windows.CloseHandle(h) })
		return h
	}
	return toName, fromName, create(toName), create(fromName)
}

// connect waits for the client on both server handles (ERROR_PIPE_CONNECTED means it connected first).
func connect(h windows.Handle) error {
	if err := windows.ConnectNamedPipe(h, nil); err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
		return err
	}
	return nil
}

// serverFile wraps a server handle for line reading and writing.
type serverFile struct{ h windows.Handle }

func (f serverFile) Read(b []byte) (int, error) {
	var n uint32
	err := windows.ReadFile(f.h, b, &n, nil)
	return int(n), err
}

func (f serverFile) Write(b []byte) (int, error) {
	var n uint32
	err := windows.WriteFile(f.h, b, &n, nil)
	return int(n), err
}

func clientFor(toName, fromName string, timeout time.Duration) *Client {
	return New(TransportFunc(func(ctx context.Context) (Conn, error) { return dialPipes(ctx, toName, fromName) }), Options{Timeout: timeout})
}

// A real named-pipe round trip: the command arrives framed with CR LF NUL, and the framed reply is read back.
func TestPipeRoundTrip(t *testing.T) {
	toName, fromName, to, from := testPipes(t)
	got := make(chan string, 1)
	go func() {
		if connect(to) != nil || connect(from) != nil {
			return
		}
		line, _ := bufio.NewReader(serverFile{to}).ReadString('\n')
		got <- line
		_, _ = serverFile{from}.Write([]byte(pingText + "\nBatchCommand finished: OK\n\n"))
	}()
	client := clientFor(toName, fromName, 5*time.Second)
	defer func() { _ = client.Close() }()
	if err := client.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if line := <-got; line != `Message: Text="`+pingText+`"`+"\r\n" {
		t.Errorf("the server read %q", line)
	}
}

func TestPipeNotThere(t *testing.T) {
	client := clientFor(`\\.\pipe\nu-audacitybridge-test-missing-to`, `\\.\pipe\nu-audacitybridge-test-missing-from`, time.Second)
	if err := client.Ping(context.Background()); !errors.Is(err, ErrNotReachable) {
		t.Fatalf("err = %v, want ErrNotReachable", err)
	}
	// The pipe Audacity reads is there but the one it writes is not: the first handle is closed again.
	toName, _, _, _ := testPipes(t)
	client = clientFor(toName, `\\.\pipe\nu-audacitybridge-test-missing-from`, time.Second)
	if err := client.Ping(context.Background()); !errors.Is(err, ErrNotReachable) {
		t.Fatalf("err = %v, want ErrNotReachable", err)
	}
}

// Audacity takes the command and never answers: Close cancels the blocked ReadFile (CancelIoEx), so the timeout returns.
func TestPipeTimeoutCancelsTheBlockedRead(t *testing.T) {
	toName, fromName, to, from := testPipes(t)
	go func() {
		if connect(to) != nil || connect(from) != nil {
			return
		}
		_, _ = bufio.NewReader(serverFile{to}).ReadString('\n')
	}()
	client := clientFor(toName, fromName, 300*time.Millisecond)
	start := time.Now()
	if err := client.Ping(context.Background()); !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Errorf("the timeout took %v", elapsed)
	}
}

// Audacity closes the pipe mid-answer: the client reads the end of the pipe and reports a broken frame.
func TestPipeHangUp(t *testing.T) {
	toName, fromName, to, from := testPipes(t)
	go func() {
		if connect(to) != nil || connect(from) != nil {
			return
		}
		_, _ = bufio.NewReader(serverFile{to}).ReadString('\n')
		_, _ = serverFile{from}.Write([]byte("partial\n"))
		_ = windows.DisconnectNamedPipe(from)
	}()
	client := clientFor(toName, fromName, 5*time.Second)
	defer func() { _ = client.Close() }()
	err := client.Ping(context.Background())
	if !errors.Is(err, ErrProtocol) && !errors.Is(err, ErrNotReachable) {
		t.Fatalf("err = %v, want a broken frame or a lost pipe", err)
	}
}

// A second client finds the one-instance pipe taken, as when another program holds Audacity's scripting pipe.
func TestPipeBusy(t *testing.T) {
	toName, fromName, to, from := testPipes(t)
	go func() { _, _ = connect(to), connect(from) }()
	first, err := dialPipes(context.Background(), toName, fromName)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = first.Close() }()
	if _, err := dialPipes(context.Background(), toName, fromName); !errors.Is(err, ErrNotReachable) || !strings.Contains(err.Error(), "another program") {
		t.Fatalf("err = %v, want ErrNotReachable naming another program", err)
	}
}

func TestPipeNameThatCannotBeANameIsRefused(t *testing.T) {
	if _, err := openPipe("bad\x00name", windows.GENERIC_READ); err == nil {
		t.Fatal("a name with a NUL opened")
	}
}

func TestPipeDialWithAnEndedContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := dialPipes(ctx, `\\.\pipe\x`, `\\.\pipe\y`); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
}

func TestPipeConnCloseIsIdempotent(t *testing.T) {
	toName, fromName, to, from := testPipes(t)
	go func() { _, _ = connect(to), connect(from) }()
	conn, err := dialPipes(context.Background(), toName, fromName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte("x")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	first := conn.Close()
	if second := conn.Close(); second != first {
		t.Errorf("a second Close = %v, want the first's answer %v", second, first)
	}
	if _, err := conn.Read(make([]byte, 1)); err == nil {
		t.Error("Read after Close succeeded")
	}
	if PipeTransport() == nil || !strings.HasPrefix(toServerPipe, `\\.\pipe\`) {
		t.Error("PipeTransport must use the local pipe names")
	}
}
