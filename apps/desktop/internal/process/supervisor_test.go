package process

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

func echoExitCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd.exe", []string{"/c", "echo output & echo error 1>&2 & exit /b 7"}
	}
	return "sh", []string{"-c", "echo output; echo error 1>&2; exit 7"}
}

// envEchoCommand writes NARRATION_RUN_ID and NARRATION_LOG_LEVEL to stderr, so a test can prove they reached the
// child's environment (docs/prds/tool-run-logging.prd.md phase 2) without a second helper-process test binary.
func envEchoCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd.exe", []string{"/c", "echo run=%NARRATION_RUN_ID% level=%NARRATION_LOG_LEVEL% 1>&2"}
	}
	return "sh", []string{"-c", "echo run=$NARRATION_RUN_ID level=$NARRATION_LOG_LEVEL 1>&2"}
}

// runContext returns a context carrying a fresh run on a runlog.Logger rooted at dir, and the path its stderr file
// will land at once something writes to it.
func runContext(t *testing.T, dir string) (context.Context, string) {
	t.Helper()
	logger := runlog.New(filepath.Join(dir, "run.jsonl"), 0)
	run := logger.Begin("test")
	return runlog.WithRun(context.Background(), run), filepath.Join(dir, "runs", run.ID()+".stderr.jsonl")
}

// waitForStderrFile polls for path to exist and contain want, since the goroutine that copies a child's stderr into
// its run file finishes sometime after the child itself exits, not synchronously with it.
func waitForStderrFile(t *testing.T, path, want string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var last string
	for time.Now().Before(deadline) {
		if got, err := os.ReadFile(path); err == nil {
			last = string(got)
			if strings.Contains(last, want) {
				return last
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("run stderr file %s never contained %q; last read: %q", path, want, last)
	return ""
}

func TestSupervisorDrainsAndRecordsExit(t *testing.T) {
	supervisor := NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	name, args := echoExitCommand()
	child, err := supervisor.Start(context.Background(), name, args...)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !child.HasExited() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	code, exited := child.ExitCode()
	if !exited || code != 7 {
		t.Fatalf("exited=%v code=%d", exited, code)
	}
}

func TestStartKeepsStderrInTheRunsFileAndSetsEnv(t *testing.T) {
	dir := t.TempDir()
	ctx, stderrPath := runContext(t, dir)
	supervisor := NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	name, args := envEchoCommand()
	child, err := supervisor.Start(ctx, name, args...)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !child.HasExited() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	run := runlog.FromContext(ctx)
	got := waitForStderrFile(t, stderrPath, "run="+run.ID())
	if !strings.Contains(got, "level=info") {
		t.Fatalf("run stderr file = %q, want NARRATION_LOG_LEVEL echoed as info", got)
	}
}

func TestRunKeepsStderrInTheRunsFileAndSetsEnv(t *testing.T) {
	dir := t.TempDir()
	ctx, stderrPath := runContext(t, dir)
	supervisor := NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	name, args := envEchoCommand()
	_, _, stderr, err := supervisor.Run(ctx, name, args...)
	if err != nil {
		t.Fatal(err)
	}
	run := runlog.FromContext(ctx)
	if !strings.Contains(stderr, "run="+run.ID()) || !strings.Contains(stderr, "level=info") {
		t.Fatalf("Run's own returned stderr = %q", stderr)
	}
	got, err := os.ReadFile(stderrPath)
	if err != nil {
		t.Fatalf("run stderr file: %v", err)
	}
	if !strings.Contains(string(got), "run="+run.ID()) || !strings.Contains(string(got), "level=info") {
		t.Fatalf("run stderr file = %q", got)
	}
}

// helperOutputBytes is how much the helper program prints: far more than a pipe buffer holds, so the reader has to keep up, and a last
// line that must still be there when the program has already exited.
const helperOutputBytes = 3 << 20

// TestHelperPrintsALot is not a test: Run starts the test binary as a program that prints a lot, then a marker line, then exits 3.
func TestHelperPrintsALot(t *testing.T) {
	if os.Getenv("PROCESS_TEST_HELPER") != "print-a-lot" {
		t.Skip("only runs as a helper program")
	}
	_, _ = fmt.Fprint(os.Stdout, strings.Repeat("x", helperOutputBytes)+"\nLAST LINE OF STDOUT\n")
	_, _ = fmt.Fprint(os.Stderr, "LAST LINE OF STDERR\n")
	os.Exit(3)
}

func TestRunReturnsAllOfTheOutputAndTheExitCodeOfAProgramThatPrintsALotAndExits(t *testing.T) {
	t.Setenv("PROCESS_TEST_HELPER", "print-a-lot")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	for attempt := 0; attempt < 5; attempt++ {
		code, stdout, stderr, err := supervisor.Run(context.Background(), self, "-test.run=^TestHelperPrintsALot$")
		if err != nil {
			t.Fatal(err)
		}
		if code != 3 || !strings.HasSuffix(stdout, "LAST LINE OF STDOUT\n") || len(stdout) != helperOutputBytes+len("\nLAST LINE OF STDOUT\n") || !strings.Contains(stderr, "LAST LINE OF STDERR") {
			t.Fatalf("attempt %d: code %d, %d bytes of stdout ending %q, stderr %q", attempt, code, len(stdout), stdout[max(0, len(stdout)-30):], stderr)
		}
	}
}

func TestRunStopsWaitingForOutputWhenTheProgramIsStopped(t *testing.T) {
	t.Setenv("PROCESS_TEST_HELPER", "")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	if _, _, _, err := supervisor.Run(ctx, self, "-test.run=^$"); err != nil && time.Since(started) > runWaitDelay+5*time.Second {
		t.Fatalf("Run took %s to give up on a stopped program", time.Since(started))
	}
}
