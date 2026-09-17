package process

import (
	"context"
	"testing"
	"time"
)

func TestSupervisorDrainsAndRecordsExit(t *testing.T) {
	supervisor := NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	child, err := supervisor.Start(context.Background(), "cmd.exe", "/c", "echo output & echo error 1>&2 & exit /b 7")
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
