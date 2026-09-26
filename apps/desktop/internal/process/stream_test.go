package process

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

const streamHelperEnv = "PROCESS_STREAM_HELPER_MODE"

// TestStreamHelperProcess is not a real test. The tests below re-execute this
// test binary as the child process (the standard Go helper-process pattern) so
// stdout, stderr, very long lines and a hanging child behave identically on
// every platform, which shell one-liners cannot do.
func TestStreamHelperProcess(t *testing.T) {
	mode := os.Getenv(streamHelperEnv)
	if mode == "" {
		return
	}
	switch mode {
	case "lines":
		fmt.Println("one")
		fmt.Println("two")
		fmt.Println("three")
		fmt.Fprintln(os.Stderr, "warning: something")
		os.Exit(0)
	case "long":
		fmt.Println(strings.Repeat("x", 300000))
		fmt.Println("after")
		os.Exit(0)
	case "fail":
		fmt.Println("partial")
		fmt.Fprintln(os.Stderr, "boom")
		os.Exit(3)
	case "env":
		fmt.Fprintf(os.Stderr, "run=%s level=%s\n", os.Getenv("NARRATION_RUN_ID"), os.Getenv("NARRATION_LOG_LEVEL"))
		fmt.Println("done")
		os.Exit(0)
	case "hang":
		fmt.Println("ready")
		time.Sleep(time.Minute)
		os.Exit(0)
	}
	os.Exit(2)
}

type collector struct {
	mu    sync.Mutex
	lines []string
	ready chan struct{}
	once  sync.Once
}

func newCollector() *collector { return &collector{ready: make(chan struct{})} }

func (c *collector) add(line string) {
	c.mu.Lock()
	c.lines = append(c.lines, line)
	c.mu.Unlock()
	if line == "ready" {
		c.once.Do(func() { close(c.ready) })
	}
}

func (c *collector) snapshot() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.lines...)
}

func startHelper(t *testing.T, ctx context.Context, mode string, c *collector) *StreamChild {
	t.Helper()
	t.Setenv(streamHelperEnv, mode)
	supervisor := NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	child, err := supervisor.StartStream(ctx, c.add, os.Args[0], "-test.run=TestStreamHelperProcess")
	if err != nil {
		t.Fatal(err)
	}
	return child
}

func waitDone(t *testing.T, child *StreamChild) {
	t.Helper()
	select {
	case <-child.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("the streamed child did not finish")
	}
}

func TestStartStreamDeliversEveryStdoutLineInOrderBeforeDone(t *testing.T) {
	c := newCollector()
	child := startHelper(t, context.Background(), "lines", c)
	waitDone(t, child)

	if got := strings.Join(c.snapshot(), ","); got != "one,two,three" {
		t.Fatalf("lines = %q", got)
	}
	if code, exited := child.ExitCode(); !exited || code != 0 {
		t.Fatalf("exited=%v code=%d", exited, code)
	}
	if !strings.Contains(child.StderrTail(), "warning: something") {
		t.Fatalf("stderr tail = %q", child.StderrTail())
	}
}

func TestStartStreamKeepsStderrInTheRunsFileAndSetsEnv(t *testing.T) {
	dir := t.TempDir()
	ctx, stderrPath := runContext(t, dir)
	c := newCollector()
	child := startHelper(t, ctx, "env", c)
	waitDone(t, child)

	run := runlog.FromContext(ctx)
	got := waitForStderrFile(t, stderrPath, "run="+run.ID())
	if !strings.Contains(got, "level=info") {
		t.Fatalf("run stderr file = %q, want NARRATION_LOG_LEVEL echoed as info", got)
	}
}

func TestStartStreamDoesNotTruncateVeryLongLines(t *testing.T) {
	c := newCollector()
	child := startHelper(t, context.Background(), "long", c)
	waitDone(t, child)

	lines := c.snapshot()
	if len(lines) != 2 || len(lines[0]) != 300000 || lines[1] != "after" {
		t.Fatalf("got %d lines", len(lines))
	}
}

func TestStartStreamRecordsAFailureExitCodeAndItsStderr(t *testing.T) {
	c := newCollector()
	child := startHelper(t, context.Background(), "fail", c)
	waitDone(t, child)

	if code, exited := child.ExitCode(); !exited || code != 3 {
		t.Fatalf("exited=%v code=%d", exited, code)
	}
	if got := c.snapshot(); len(got) != 1 || got[0] != "partial" {
		t.Fatalf("lines = %v", got)
	}
	if !strings.Contains(child.StderrTail(), "boom") {
		t.Fatalf("stderr tail = %q", child.StderrTail())
	}
}

func TestStartStreamKillStopsAChildThatIgnoresEverythingElse(t *testing.T) {
	c := newCollector()
	child := startHelper(t, context.Background(), "hang", c)
	select {
	case <-c.ready:
	case <-time.After(10 * time.Second):
		t.Fatal("the child never reported ready")
	}

	if err := child.Kill(); err != nil {
		t.Fatal(err)
	}
	waitDone(t, child)
	if code, exited := child.ExitCode(); !exited || code == 0 {
		t.Fatalf("a killed child should report a non-zero exit: exited=%v code=%d", exited, code)
	}
}

func TestStartStreamStopsTheChildWhenItsContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := newCollector()
	child := startHelper(t, ctx, "hang", c)
	select {
	case <-c.ready:
	case <-time.After(10 * time.Second):
		t.Fatal("the child never reported ready")
	}

	cancel()
	waitDone(t, child)
	if !child.HasExited() {
		t.Fatal("the child should have exited")
	}
}
