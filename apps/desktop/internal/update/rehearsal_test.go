//go:build rehearsal

package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestRehearsalWithTwoRealBuilds is the update run against real builds of the application, on copies in a temporary folder. It is
// not part of the gate (it opens the application's window for a few seconds); run it with
//
//	REHEARSAL_OLD=<older narration-utils.exe> REHEARSAL_NEW=<newer build, stamped with the version> \
//	  go test -tags rehearsal -run Rehearsal -v ./internal/update
//
// The old build is started with launcher-style arguments and left running; Install swaps the new one in beside it and starts it, the
// old one is then closed as the app closes itself after an install, and the test waits for the new build to load its window and ask
// for its Bootstrap, which is what confirms the update: the old file and the launch record must then be gone. The application's
// settings folder is pointed at the temporary folder; the launch record is written to its real place and removed afterwards.
func TestRehearsalWithTwoRealBuilds(t *testing.T) {
	oldBuild, newBuild := os.Getenv("REHEARSAL_OLD"), os.Getenv("REHEARSAL_NEW")
	if oldBuild == "" || newBuild == "" {
		t.Skip("set REHEARSAL_OLD and REHEARSAL_NEW to two real builds")
	}
	root, err := os.MkdirTemp("", "rehearsal-*")
	if err != nil {
		t.Fatal(err)
	}
	// The window's web view keeps its profile folder open for a moment after the program is stopped, so removal is best effort.
	t.Cleanup(func() {
		time.Sleep(5 * time.Second)
		_ = os.RemoveAll(root)
	})
	// The window needs the real local profile (WebView2 does not start in an empty one), so the launch record goes to its real place,
	// which must be empty; the settings folder is the temporary one.
	t.Setenv("APPDATA", filepath.Join(root, "APPDATA"))
	appDir := filepath.Join(root, "Program")
	exe := filepath.Join(appDir, "narration-utils.exe")
	copyFile(t, oldBuild, exe)
	project := filepath.Join(root, "Project")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	pending := filepath.Join(cache, "narration-utils", "update", "pending.json")
	if exists(pending) {
		t.Skip("an update launch record already exists in the real cache; not touching it")
	}
	t.Cleanup(func() { _ = os.Remove(pending) })
	stagedPath := filepath.Join(root, "cache", "narration-utils.exe")
	copyFile(t, newBuild, stagedPath)
	bytes, err := os.ReadFile(stagedPath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(bytes)
	staged := Staged{Executable: stagedPath, ExecutableSize: int64(len(bytes)), ExecutableSHA256: hex.EncodeToString(sum[:])}
	want := strings.TrimSpace(func() string { out, _ := exec.Command(newBuild, "--version").Output(); return string(out) }())
	from := strings.TrimSpace(func() string { out, _ := exec.Command(oldBuild, "--version").Output(); return string(out) }())
	if want == "" || from == "" || want == from {
		t.Fatalf("the two builds must report different versions: %q and %q", from, want)
	}

	arguments := []string{"--project-folder", project, "--project-name", "Rehearsal", "--daw", "Standalone"}
	running := exec.Command(exe, arguments...)
	if err := running.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = running.Process.Kill(); _ = running.Wait() }()
	time.Sleep(6 * time.Second) // the window is up and the app is running, holding its single-instance lock
	if running.ProcessState != nil {
		t.Fatalf("the old build exited on its own: %v", running.ProcessState)
	}

	options := InstallOptions{Staged: staged, Executable: exe, Args: arguments, PID: running.Process.Pid, From: from, To: want, PendingPath: pending}
	if err := Install(context.Background(), options); err != nil {
		t.Fatal(err)
	}
	if got := versionOf(t, exe); got != want {
		t.Fatalf("the program at its own path reports %s, want %s", got, want)
	}
	if got := versionOf(t, exe+oldSuffix); got != from {
		t.Fatalf(".old reports %s, want %s", got, from)
	}
	t.Logf("swapped %s for %s while %s was running", from, want, from)

	// The app closes itself after an install; the new build waits for that before it takes the single-instance lock.
	_ = running.Process.Kill()
	_ = running.Wait()
	deadline := time.Now().Add(90 * time.Second)
	for exists(exe+oldSuffix) || exists(pending) {
		if time.Now().After(deadline) {
			out, _ := exec.Command("powershell", "-NoProfile", "-Command", "Get-Process | Where-Object { $_.Path -like '"+root+"*' } | Format-Table Id,ProcessName,Path -AutoSize | Out-String -Width 300").CombinedOutput()
			logs, _ := filepath.Glob(filepath.Join(root, "*", "narration-utils", "*"))
			note, _ := os.ReadFile(pending)
			t.Fatalf("the new build did not confirm within 90 s (old file present %v, record present %v)\nprocesses of the copy:\n%s\nfiles: %v\nrecord: %s", exists(exe+oldSuffix), exists(pending), out, logs, note)
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Log("the new build started, asked for its Bootstrap and confirmed the update: .old and the launch record are gone")
	// Stop what the new build started: only the processes whose program is the temporary copy, never another installation.
	script := "Get-Process | Where-Object { $_.Path -eq '" + strings.ReplaceAll(exe, "'", "''") + "' } | Stop-Process -Force"
	_ = exec.Command("powershell", "-NoProfile", "-Command", script).Run()
}
