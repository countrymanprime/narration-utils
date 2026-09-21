package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// The install tests run real programs: testdata/fakeapp is built once per version and started the way the application is started, so
// what is tested is the rename of a running program, the relaunch arguments, the single-instance wait and the rollback, not a model
// of them.
var (
	fakeMu       sync.Mutex
	fakeBuilds   = map[string]string{}
	fakeBuildDir string
)

func TestMain(m *testing.M) {
	renameDelay = 0 // the retries of a failing rename are tested, not waited out
	code := m.Run()
	if fakeBuildDir != "" {
		_ = os.RemoveAll(fakeBuildDir)
	}
	os.Exit(code)
}

func fakeApp(t *testing.T, version string) string {
	t.Helper()
	fakeMu.Lock()
	defer fakeMu.Unlock()
	if path, ok := fakeBuilds[version]; ok {
		return path
	}
	if fakeBuildDir == "" {
		dir, err := os.MkdirTemp("", "fakeapp-*")
		if err != nil {
			t.Fatal(err)
		}
		fakeBuildDir = dir
	}
	name := "fakeapp-" + version
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(fakeBuildDir, name)
	build := exec.Command("go", "build", "-ldflags", "-X main.version="+version, "-o", path, "./testdata/fakeapp")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build fakeapp: %v\n%s", err, output)
	}
	fakeBuilds[version] = path
	return path
}

func appFileName() string {
	if runtime.GOOS == "windows" {
		return "narration-utils.exe"
	}
	return "narration-utils"
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	bytes, err := os.ReadFile(from)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, bytes, 0o700); err != nil {
		t.Fatal(err)
	}
}

func versionOf(t *testing.T, program string) string {
	t.Helper()
	output, err := exec.Command(program, "--version").Output()
	if err != nil {
		t.Fatalf("%s --version: %v", program, err)
	}
	return strings.TrimSpace(string(output))
}

type installation struct {
	dir, exe, pending, cache string
}

// install lays out an installed program at version 1.0.0 and a staged 2.0.0 in a cache folder.
func install(t *testing.T, mode string) (installation, Staged) {
	t.Helper()
	root := t.TempDir()
	layout := installation{dir: filepath.Join(root, "app"), cache: filepath.Join(root, "cache"), pending: filepath.Join(root, "cache", "pending.json")}
	layout.exe = filepath.Join(layout.dir, appFileName())
	copyFile(t, fakeApp(t, "1.0.0"), layout.exe)
	if err := os.WriteFile(filepath.Join(layout.dir, "mode.txt"), []byte(mode), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FAKEAPP_PENDING", layout.pending)
	stagedPath := filepath.Join(layout.cache, "narration-utils.exe")
	copyFile(t, fakeApp(t, "2.0.0"), stagedPath)
	bytes, _ := os.ReadFile(stagedPath)
	sum := sha256.Sum256(bytes)
	return layout, Staged{Executable: stagedPath, ExecutableSize: int64(len(bytes)), ExecutableSHA256: hex.EncodeToString(sum[:])}
}

func (l installation) options(staged Staged, pid int, arguments ...string) InstallOptions {
	return InstallOptions{Staged: staged, Executable: l.exe, Args: arguments, PID: pid, From: "1.0.0", To: "2.0.0", PendingPath: l.pending}
}

func waitFor(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func startedNote(t *testing.T, dir, version string) (args []string, pid int) {
	t.Helper()
	path := filepath.Join(dir, "started-"+version+".json")
	waitFor(t, "started-"+version, func() bool { return exists(path) })
	time.Sleep(50 * time.Millisecond) // the note is written whole, then closed
	var note struct {
		Args []string `json:"args"`
		PID  int      `json:"pid"`
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(bytes, &note); err != nil {
		t.Fatalf("%v in %s", err, bytes)
	}
	return note.Args, note.PID
}

func killProcess(pid int) {
	if process, err := os.FindProcess(pid); err == nil {
		_ = process.Kill()
	}
}

func TestInstallReplacesARunningProgramAndTheNewOneStartsWithTheSameArgumentsAfterTheOldOneExits(t *testing.T) {
	layout, staged := install(t, "linger")
	arguments := []string{"--project-folder", `C:\Projects\Alice`, "--session-dir", `C:\sessions\hub_1`, "--daw", "REAPER"}
	old := exec.Command(layout.exe, arguments...)
	if err := old.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = old.Process.Kill(); _ = old.Wait() }()
	startedNote(t, layout.dir, "1.0.0")
	if err := os.WriteFile(filepath.Join(layout.dir, "mode.txt"), []byte("confirm"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := Install(context.Background(), layout.options(staged, old.Process.Pid, arguments...)); err != nil {
		t.Fatal(err)
	}

	if got := versionOf(t, layout.exe); got != "2.0.0" {
		t.Fatalf("the program at its own path is version %s", got)
	}
	if got := versionOf(t, layout.exe+oldSuffix); got != "1.0.0" {
		t.Fatalf("the old program was not kept, it is %s", got)
	}
	if exists(layout.exe + newSuffix) {
		t.Fatal("the staging copy was left behind")
	}
	// The new copy waits for the running one to exit: it has not started while the old one is alive.
	time.Sleep(600 * time.Millisecond)
	if exists(filepath.Join(layout.dir, "started-2.0.0.json")) {
		t.Fatal("the new copy started while the old one still held the single-instance lock")
	}
	_ = old.Process.Kill()
	_ = old.Wait()

	args, pid := startedNote(t, layout.dir, "2.0.0")
	defer killProcess(pid)
	if strings.Join(args, "\x00") != strings.Join(arguments, "\x00") {
		t.Fatalf("the new copy was started with %q, want %q", args, arguments)
	}
	// Its first Bootstrap confirms the update: the old program and the record are removed.
	waitFor(t, "the update to be confirmed", func() bool { return !exists(layout.exe+oldSuffix) && !exists(layout.pending) })
}

func TestInstallRefusesWhenTheFolderCannotBeWrittenAndChangesNothing(t *testing.T) {
	layout, staged := install(t, "linger")
	options := layout.options(staged, 0)
	options.Writable = func(string) error { return errors.New("access denied") }
	if err := Install(context.Background(), options); !errors.Is(err, ErrNotWritable) {
		t.Fatalf("err = %v", err)
	}
	if got := versionOf(t, layout.exe); got != "1.0.0" || exists(layout.exe+newSuffix) || exists(layout.pending) {
		t.Fatalf("something changed: version %s", got)
	}
}

func TestInstallRefusesAProgramThatDoesNotReportTheVersionTheReleaseNames(t *testing.T) {
	layout, staged := install(t, "linger")
	options := layout.options(staged, 0)
	options.To = "9.9.9"
	err := Install(context.Background(), options)
	if err == nil || !strings.Contains(err.Error(), "does not report the version") {
		t.Fatalf("err = %v", err)
	}
	if got := versionOf(t, layout.exe); got != "1.0.0" || exists(layout.exe+newSuffix) || exists(layout.exe+oldSuffix) || exists(layout.pending) {
		t.Fatalf("something changed: version %s", got)
	}
}

func TestInstallRefusesAStagedProgramThatIsNotTheOneThatWasChecked(t *testing.T) {
	layout, staged := install(t, "linger")
	for name, change := range map[string]func(*Staged){
		"a wrong hash":   func(s *Staged) { s.ExecutableSHA256 = strings.Repeat("0", 64) },
		"a wrong size":   func(s *Staged) { s.ExecutableSize++ },
		"a missing file": func(s *Staged) { s.Executable = filepath.Join(filepath.Dir(s.Executable), "gone.exe") },
	} {
		changed := staged
		change(&changed)
		if err := Install(context.Background(), layout.options(changed, 0)); err == nil {
			t.Errorf("%s: the update was installed", name)
		}
		if got := versionOf(t, layout.exe); got != "1.0.0" || exists(layout.exe+newSuffix) || exists(layout.exe+oldSuffix) || exists(layout.pending) {
			t.Errorf("%s: something changed: version %s", name, got)
		}
	}
}

func TestInstallPutsTheRunningProgramBackWhenTheNewOneCannotBeStarted(t *testing.T) {
	layout, staged := install(t, "linger")
	options := layout.options(staged, 0)
	options.Spawn = func(string, []string, string) error { return userError("The new version could not be started.") }
	if err := Install(context.Background(), options); err == nil {
		t.Fatal("a failed start must be reported")
	}
	if got := versionOf(t, layout.exe); got != "1.0.0" || exists(layout.exe+oldSuffix) || exists(layout.exe+newSuffix) || exists(layout.pending) {
		t.Fatalf("the running program was not restored: version %s", got)
	}
}

func TestInstallRestoresWhenEitherRenameFails(t *testing.T) {
	for failing := 1; failing <= 2; failing++ {
		layout, staged := install(t, "linger")
		options := layout.options(staged, 0)
		options.Rename = func(oldPath, newPath string) error {
			// The first rename moves the running program aside, the second puts the new one in its place: one of them never works.
			if (failing == 1 && newPath == layout.exe+oldSuffix) || (failing == 2 && newPath == layout.exe && oldPath == layout.exe+newSuffix) {
				return errors.New("in use")
			}
			return os.Rename(oldPath, newPath)
		}
		options.Spawn = func(string, []string, string) error {
			t.Fatal("nothing may be started after a rename failed")
			return nil
		}
		if err := Install(context.Background(), options); err == nil {
			t.Fatalf("rename %d failed and Install said nothing", failing)
		}
		if got := versionOf(t, layout.exe); got != "1.0.0" || exists(layout.exe+oldSuffix) || exists(layout.exe+newSuffix) || exists(layout.pending) {
			t.Fatalf("rename %d: not restored, version %s (old %v new %v pending %v)", failing, got, exists(layout.exe+oldSuffix), exists(layout.exe+newSuffix), exists(layout.pending))
		}
	}
}

func TestInstallStopsWhenThereIsNoRoomBesideTheProgram(t *testing.T) {
	layout, staged := install(t, "linger")
	options := layout.options(staged, 0)
	options.Free = func(string) (uint64, error) { return 1 << 10, nil }
	if err := Install(context.Background(), options); err == nil || !strings.Contains(err.Error(), "free disk space") {
		t.Fatalf("err = %v", err)
	}
	if exists(layout.exe+newSuffix) || exists(layout.pending) {
		t.Fatal("nothing may be written when there is no room")
	}
}

func TestInstallRemovesALeftoverOldProgramAndSaysSoWhenItCannotBeRemoved(t *testing.T) {
	layout, staged := install(t, "linger")
	copyFile(t, fakeApp(t, "0.5.0"), layout.exe+oldSuffix)
	spawned := false
	options := layout.options(staged, 0)
	options.Spawn = func(string, []string, string) error { spawned = true; return nil }
	if err := Install(context.Background(), options); err != nil || !spawned {
		t.Fatalf("a leftover from an update that was never confirmed is replaced: %v", err)
	}
	if got := versionOf(t, layout.exe+oldSuffix); got != "1.0.0" {
		t.Fatalf(".old is %s: it must be the program that was running", got)
	}
}

func TestACancelledInstallLeavesNothing(t *testing.T) {
	layout, staged := install(t, "linger")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Install(ctx, layout.options(staged, 0)); err == nil {
		t.Fatal("a cancelled install must stop")
	}
	if exists(layout.exe+newSuffix) || exists(layout.pending) {
		t.Fatal("a cancelled install left files")
	}
}

func TestANewVersionThatDoesNotStartIsReplacedByTheOldOneOnTheNextLaunch(t *testing.T) {
	layout, staged := install(t, "crash")
	gone := exec.Command(fakeApp(t, "1.0.0"), "--version")
	if err := gone.Run(); err != nil {
		t.Fatal(err)
	}
	options := layout.options(staged, gone.Process.Pid, "--project-folder", "P")
	if err := Install(context.Background(), options); err != nil {
		t.Fatal(err)
	}
	// The first start of the new copy (started by Install) records an attempt and exits without confirming.
	startedNote(t, layout.dir, "2.0.0")
	var attemptPID int
	waitFor(t, "the first attempt to be recorded", func() bool {
		pending, ok := readPending(layout.pending)
		attemptPID = pending.AttemptPID
		return ok && pending.Attempts == 1 && attemptPID > 0
	})
	waitFor(t, "the first attempt to end", func() bool { return !processAlive(attemptPID) })
	// The second launch finds a record on its second start, restores the old program, hands over to it and stops.
	if err := exec.Command(layout.exe, "--project-folder", "P").Run(); err != nil {
		t.Fatalf("the second launch failed: %v", err)
	}
	if got := versionOf(t, layout.exe); got != "1.0.0" {
		t.Fatalf("the program at its own path is %s: the old one was not restored", got)
	}
	if got := versionOf(t, layout.exe+failedSuffix); got != "2.0.0" {
		t.Fatalf("the failed version was not kept aside, it is %s", got)
	}
	if exists(layout.pending) || exists(layout.exe+oldSuffix) {
		t.Fatal("the record and .old must be gone after a rollback")
	}
	args, _ := startedNote(t, layout.dir, "1.0.0")
	if len(args) != 2 || args[0] != "--project-folder" || args[1] != "P" {
		t.Fatalf("the restored program started with %q", args)
	}
}

func TestStartupWaitsForTheProcessItReplacesAndStripsTheRelaunchArguments(t *testing.T) {
	var waited []int
	result := Startup(StartupOptions{
		Args: []string{relaunchFlag, "4242", "--daw", "REAPER", "--project-folder", "P"}, PendingPath: filepath.Join(t.TempDir(), "pending.json"),
		Wait: func(pid int, _ time.Duration) { waited = append(waited, pid) },
	})
	if len(waited) != 1 || waited[0] != 4242 {
		t.Fatalf("waited for %v", waited)
	}
	if strings.Join(result.Args, " ") != "--daw REAPER --project-folder P" || result.RolledBack {
		t.Fatalf("result = %+v", result)
	}
	if got := Startup(StartupOptions{Args: []string{"--daw", "REAPER"}, PendingPath: filepath.Join(t.TempDir(), "p.json"), Wait: func(int, time.Duration) { t.Fatal("no wait without the flag") }}); len(got.Args) != 2 {
		t.Fatalf("plain launch: %+v", got)
	}
}

func TestStartupRecordsAnAttemptAndIgnoresARecordThatIsNotAboutThisProgram(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, appFileName())
	path := filepath.Join(dir, "pending.json")
	if err := writePending(path, Pending{From: "1.0.0", To: "2.0.0", Executable: exe}); err != nil {
		t.Fatal(err)
	}
	Startup(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0", PID: 4321})
	if pending, _ := readPending(path); pending.Attempts != 1 || pending.AttemptPID != 4321 {
		t.Fatalf("attempts = %d, pid %d, want 1 and 4321", pending.Attempts, pending.AttemptPID)
	}
	// A record for another version, or another install, is not about this program and is left alone: a development build or an
	// older portable copy starting must not erase the protection of the update that is in progress.
	Startup(StartupOptions{Executable: exe, PendingPath: path, Version: "3.0.0"})
	Startup(StartupOptions{Executable: filepath.Join(dir, "elsewhere", appFileName()), PendingPath: path, Version: "2.0.0"})
	if pending, ok := readPending(path); !ok || pending.Attempts != 1 {
		t.Fatalf("a record about another program was changed or removed: %+v %v", pending, ok)
	}
	// A record older than a week is a leftover.
	Startup(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0", Now: func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }})
	if exists(path) {
		t.Fatal("an old record was kept")
	}
	if got := Startup(StartupOptions{Executable: exe, PendingPath: filepath.Join(dir, "none.json"), Version: "2.0.0"}); got.RolledBack {
		t.Fatal("no record, no rollback")
	}
}

func TestARollbackThatCannotBeDoneLetsTheNewVersionRunOn(t *testing.T) {
	for name, prepare := range map[string]func(exe string) func(string, string) error{
		"no previous version to restore": func(string) func(string, string) error { return nil },
		"the new version cannot be moved aside": func(exe string) func(string, string) error {
			_ = os.WriteFile(exe+oldSuffix, []byte("old"), 0o600)
			return func(string, string) error { return errors.New("in use") }
		},
		"the old version cannot be put back": func(exe string) func(string, string) error {
			_ = os.WriteFile(exe+oldSuffix, []byte("old"), 0o600)
			return func(a, b string) error {
				if a == exe+oldSuffix {
					return errors.New("denied")
				}
				return os.Rename(a, b)
			}
		},
	} {
		dir := t.TempDir()
		exe := filepath.Join(dir, appFileName())
		if err := os.WriteFile(exe, []byte("new"), 0o700); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, "pending.json")
		if err := writePending(path, Pending{From: "1.0.0", To: "2.0.0", Executable: exe, Attempts: 1}); err != nil {
			t.Fatal(err)
		}
		var logged []string
		result := Startup(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0", Rename: prepare(exe), Log: func(kind, _ string) { logged = append(logged, kind) }})
		if result.RolledBack || exists(path) {
			t.Errorf("%s: result %+v, record kept %v", name, result, exists(path))
		}
		if bytes, _ := os.ReadFile(exe); string(bytes) != "new" {
			t.Errorf("%s: the program at its path changed to %q", name, bytes)
		}
		if len(logged) != 1 || logged[0] != "update_rollback_failed" {
			t.Errorf("%s: logged %v", name, logged)
		}
	}
}

func TestARollbackThatRestoredTheOldProgramButCannotStartItSaysSo(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, appFileName())
	_ = os.WriteFile(exe, []byte("new"), 0o700)
	_ = os.WriteFile(exe+oldSuffix, []byte("old"), 0o700)
	path := filepath.Join(dir, "pending.json")
	_ = writePending(path, Pending{From: "1.0.0", To: "2.0.0", Executable: exe, Attempts: 1})
	var logged []string
	result := Startup(StartupOptions{
		Executable: exe, PendingPath: path, Version: "2.0.0", Spawn: func(string, []string, string) error { return errors.New("blocked") },
		Log: func(kind, _ string) { logged = append(logged, kind) },
	})
	if result.RolledBack {
		t.Fatal("a program that could not be started is not a handover")
	}
	if bytes, _ := os.ReadFile(exe); string(bytes) != "old" || len(logged) != 1 {
		t.Fatalf("program %q, logged %v", bytes, logged)
	}
}

func TestConfirmRemovesTheOldProgramAndTheRecordOnlyForThisVersion(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, appFileName())
	path := filepath.Join(dir, "pending.json")
	for _, leftover := range []string{exe + oldSuffix, exe + failedSuffix} {
		_ = os.WriteFile(leftover, []byte("x"), 0o600)
	}
	_ = writePending(path, Pending{From: "1.0.0", To: "2.0.0", Executable: exe})
	Confirm(StartupOptions{Executable: exe, PendingPath: path, Version: "3.0.0"})
	if !exists(exe+oldSuffix) || !exists(path) {
		t.Fatal("another version's start must not confirm this update")
	}
	var logged []string
	Confirm(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0", Log: func(kind, _ string) { logged = append(logged, kind) }})
	if exists(exe+oldSuffix) || exists(exe+failedSuffix) || exists(path) || len(logged) != 1 || logged[0] != "update_confirmed" {
		t.Fatalf("confirm left files or said nothing: %v", logged)
	}
	Confirm(StartupOptions{Executable: exe, PendingPath: path, Version: "2.0.0"}) // no record: nothing to do, and no panic
}

func TestTakeRelaunchArgsKeepsOrderAndIgnoresAnythingThatIsNotAProcessID(t *testing.T) {
	for _, test := range []struct {
		in   []string
		rest string
		pid  int
	}{
		{nil, "", 0},
		{[]string{"--daw", "REAPER"}, "--daw REAPER", 0},
		{[]string{relaunchFlag, "12", "--daw", "REAPER"}, "--daw REAPER", 12},
		{[]string{"--daw", relaunchFlag, "12"}, "--daw " + relaunchFlag + " 12", 0},
		{[]string{relaunchFlag}, "", 0},
		{[]string{relaunchFlag, "abc", "x"}, "x", 0},
		{[]string{relaunchFlag, "-5"}, "", 0},
		{[]string{relaunchFlag, "0"}, "", 0},
		{[]string{relaunchFlag, "99999999999999999999"}, "", 0},
		{[]string{relaunchFlag, "5", relaunchFlag, "6"}, relaunchFlag + " 6", 5},
	} {
		rest, pid := TakeRelaunchArgs(test.in)
		if strings.Join(rest, " ") != test.rest || pid != test.pid {
			t.Errorf("TakeRelaunchArgs(%q) = %q, %d; want %q, %d", test.in, rest, pid, test.rest, test.pid)
		}
	}
}

func FuzzTakeRelaunchArgs(f *testing.F) {
	f.Add("--daw", relaunchFlag, "12")
	f.Add(relaunchFlag, relaunchFlag, "-1")
	f.Fuzz(func(t *testing.T, a, b, c string) {
		input := []string{a, b, c}
		rest, pid := TakeRelaunchArgs(input)
		if pid < 0 || pid > maxProcessID {
			t.Fatalf("pid %d out of range", pid)
		}
		if a == relaunchFlag && len(rest) != 1 {
			t.Fatalf("the flag and its value must both go: %q", rest)
		}
		if a != relaunchFlag && strings.Join(rest, "\x00") != strings.Join(input, "\x00") {
			t.Fatalf("arguments without the flag in front must be untouched: %q", rest)
		}
	})
}

func TestWaitForExitReturnsWhenTheProcessEndsAndImmediatelyForOneThatIsGone(t *testing.T) {
	layout, _ := install(t, "linger")
	process := exec.Command(layout.exe)
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	startedNote(t, layout.dir, "1.0.0")
	returned := make(chan time.Duration, 1)
	go func() {
		begin := time.Now()
		WaitForExit(process.Process.Pid, 20*time.Second)
		returned <- time.Since(begin)
	}()
	select {
	case <-returned:
		t.Fatal("WaitForExit returned while the process was alive")
	case <-time.After(400 * time.Millisecond):
	}
	_ = process.Process.Kill()
	_ = process.Wait()
	select {
	case took := <-returned:
		if took > 15*time.Second {
			t.Fatalf("took %v", took)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("WaitForExit did not return after the process ended")
	}
	begin := time.Now()
	WaitForExit(process.Process.Pid, 20*time.Second)
	if time.Since(begin) > 5*time.Second {
		t.Fatal("a process that is gone must not be waited for")
	}
}

func TestWaitForExitGivesUpAfterTheTimeout(t *testing.T) {
	layout, _ := install(t, "linger")
	process := exec.Command(layout.exe)
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = process.Process.Kill(); _ = process.Wait() }()
	begin := time.Now()
	WaitForExit(process.Process.Pid, 300*time.Millisecond)
	if took := time.Since(begin); took < 250*time.Millisecond || took > 10*time.Second {
		t.Fatalf("took %v", took)
	}
}

func TestWritableDirIsTrueForAFolderYouCanWriteAndFalseOtherwise(t *testing.T) {
	if err := WritableDir(t.TempDir()); err != nil {
		t.Fatalf("a temp folder is writable: %v", err)
	}
	if err := WritableDir(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("a folder that does not exist is not writable")
	}
	file := filepath.Join(t.TempDir(), "file")
	_ = os.WriteFile(file, []byte("x"), 0o600)
	if err := WritableDir(file); err == nil {
		t.Fatal("a file is not a writable folder")
	}
}

func TestSpawnDetachedStartsAProgramThatOutlivesTheCaller(t *testing.T) {
	layout, _ := install(t, "linger")
	if err := SpawnDetached(layout.exe, []string{"--project-folder", "P"}, layout.dir); err != nil {
		t.Fatal(err)
	}
	_, pid := startedNote(t, layout.dir, "1.0.0")
	killProcess(pid)
	if err := SpawnDetached(filepath.Join(layout.dir, "missing.exe"), nil, layout.dir); err == nil || !strings.Contains(fmt.Sprint(err), "could not be started") {
		t.Fatalf("a program that is not there: %v", err)
	}
}
