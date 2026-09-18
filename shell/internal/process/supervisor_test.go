package process

import (
	"context"
	"runtime"
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
