package update

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInstallStopsWithBusyWhenWorkStartsAfterTheClick(t *testing.T) {
	layout, staged := install(t, "linger")
	options := layout.options(staged, 0)
	options.Ready = func() bool { return false }
	options.Spawn = func(string, []string, string) error { t.Fatal("nothing may start"); return nil }
	if err := Install(context.Background(), options); !errors.Is(err, ErrBusy) {
		t.Fatalf("err = %v", err)
	}
	if got := versionOf(t, layout.exe); got != "1.0.0" || exists(layout.exe+newSuffix) || exists(layout.exe+oldSuffix) || exists(layout.pending) {
		t.Fatalf("something changed: %s", got)
	}
}

func TestARenameThatFailsForAMomentIsRetriedAndTheUpdateStillWorks(t *testing.T) {
	layout, staged := install(t, "linger")
	failures := 0
	options := layout.options(staged, 0)
	options.Rename = func(oldPath, newPath string) error {
		if failures < 3 {
			failures++
			return errors.New("the file is in use by another process")
		}
		return os.Rename(oldPath, newPath)
	}
	options.Spawn = func(string, []string, string) error { return nil }
	if err := Install(context.Background(), options); err != nil {
		t.Fatalf("a sharing violation that clears must not fail the update: %v", err)
	}
	if got := versionOf(t, layout.exe); got != "2.0.0" {
		t.Fatalf("the program is %s", got)
	}
}

func TestWhenTheOldProgramCannotBePutBackTheRecordAndOldStayAndTheErrorNamesTheFile(t *testing.T) {
	layout, staged := install(t, "linger")
	options := layout.options(staged, 0)
	options.Spawn = func(string, []string, string) error { return errors.New("blocked by antivirus") }
	options.Rename = func(oldPath, newPath string) error {
		if oldPath == layout.exe+oldSuffix { // putting the old program back never works
			return errors.New("denied")
		}
		return os.Rename(oldPath, newPath)
	}
	err := Install(context.Background(), options)
	if err == nil || !strings.Contains(err.Error(), "Rename "+layout.exe+oldSuffix+" to "+layout.exe) {
		t.Fatalf("the error must say which file to rename: %v", err)
	}
	if !exists(layout.exe+oldSuffix) || !exists(layout.pending) {
		t.Fatal(".old and the record must be kept when the restore failed")
	}
	if !strings.Contains(err.Error(), "blocked by antivirus") {
		t.Fatalf("the reason the start failed is lost: %v", err)
	}
	if got := UserMessage(err, "fallback"); strings.Contains(got, "antivirus") || !strings.Contains(got, "could not be put back") {
		t.Fatalf("the narrator's sentence: %q", got)
	}
}

func TestALaunchWhileTheFirstStartIsStillComingUpIsNotAFailureAndRollsNothingBack(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, appFileName())
	_ = os.WriteFile(exe, []byte("new"), 0o700)
	_ = os.WriteFile(exe+oldSuffix, []byte("old"), 0o700)
	path := filepath.Join(dir, "pending.json")
	_ = writePending(path, Pending{From: "1.0.0", To: "2.0.0", Executable: exe, StartedAt: time.Now(), Attempts: 1, AttemptPID: 777})
	result := Startup(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0", PID: 888, Alive: func(pid int) bool { return pid == 777 }})
	if result.RolledBack {
		t.Fatal("a second instance launched while the first is starting must not roll the build back")
	}
	if bytes, _ := os.ReadFile(exe); string(bytes) != "new" || !exists(path) {
		t.Fatal("nothing may change while the first start is still running")
	}
	// The first start has ended without confirming: now it is a failure.
	spawned := false
	result = Startup(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0", PID: 888, Alive: func(int) bool { return false }, Spawn: func(string, []string, string) error { spawned = true; return nil }})
	if !result.RolledBack || !spawned {
		t.Fatalf("result %+v spawned %v", result, spawned)
	}
	if bytes, _ := os.ReadFile(exe); string(bytes) != "old" {
		t.Fatalf("the program is %q", bytes)
	}
}

func TestTheProcessThatRecordedTheAttemptCanBeTheOneThatRunsAgain(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, appFileName())
	_ = os.WriteFile(exe, []byte("new"), 0o700)
	_ = os.WriteFile(exe+oldSuffix, []byte("old"), 0o700)
	path := filepath.Join(dir, "pending.json")
	_ = writePending(path, Pending{From: "1.0.0", To: "2.0.0", Executable: exe, StartedAt: time.Now(), Attempts: 1, AttemptPID: 999})
	// Same pid: a reused process id must not suppress the rollback forever.
	result := Startup(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0", PID: 999, Alive: func(int) bool { return true }, Spawn: func(string, []string, string) error { return nil }})
	if !result.RolledBack {
		t.Fatal("a launch with the recorded pid is the failed start's successor, not a second instance")
	}
}

func TestProcessAliveKnowsARunningProcessFromOneThatIsGone(t *testing.T) {
	if !processAlive(os.Getpid()) {
		t.Fatal("this process is alive")
	}
	layout, _ := install(t, "quit")
	process := exec.Command(layout.exe)
	if err := process.Run(); err != nil {
		t.Fatal(err)
	}
	if processAlive(process.Process.Pid) {
		t.Fatal("a process that has exited is not alive")
	}
}
