package process

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

func echoExitCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd.exe", []string{"/c", "echo output & echo error 1>&2 & exit /b 7"}
	}
	return "sh", []string{"-c", "echo output; echo error 1>&2; exit 7"}
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
