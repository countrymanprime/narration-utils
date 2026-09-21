package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/update"
)

// stagedHost is a Host that has downloaded version 0.2.7 and is ready to install it; the caller replaces the install and the quit.
func stagedHost(t *testing.T) (*Host, string) {
	t.Helper()
	fake := newReleaseFiles(t)
	host := downloadHost(t, fake)
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	started := startDownload(t, host)
	if job := waitForJob(t, host, started.ID, finished); job.Phase != "ready" {
		t.Fatalf("job = %+v", job)
	}
	return host, started.ID
}

func jobState(t *testing.T, host *Host, id string) jobPayload {
	t.Helper()
	text, err := host.UpdateJobState(id)
	return decodeJob(t, text, err)
}

func TestInstallHandsTheStagedProgramTheArgumentsAndTheVersionsAndThenClosesTheApp(t *testing.T) {
	host, id := stagedHost(t)
	var got update.InstallOptions
	var quit atomic.Bool
	host.installUpdate = func(_ context.Context, options update.InstallOptions) error { got = options; return nil }
	host.quitApp = func() { quit.Store(true) }
	text, err := host.UpdateInstall(id)
	job := decodeJob(t, text, err)
	if job.Phase != "installing" || !strings.Contains(job.Message, "restarts") {
		t.Fatalf("job = %+v", job)
	}
	if got.From != "0.2.6" || got.To != "0.2.7" || got.PID != os.Getpid() || got.PendingPath != host.pendingPath || filepath.Base(got.Executable) != "narration-utils.exe" {
		t.Fatalf("options = %+v", got)
	}
	if got.Staged.Executable == "" || got.Staged.ExecutableSHA256 == "" || len(got.Args) != len(os.Args[1:]) {
		t.Fatalf("options = %+v", got)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !quit.Load() {
		if time.Now().After(deadline) {
			t.Fatal("the app was not closed after a successful install")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// The job is still on its last step, so another download is refused.
	if _, err := host.UpdateDownload(); err == nil {
		t.Fatal("a download must not start while the app is installing")
	}
}

func TestInstallIsRefusedWhileWorkIsRunningAndNothingIsTouched(t *testing.T) {
	host, id := stagedHost(t)
	called := false
	host.installUpdate = func(context.Context, update.InstallOptions) error { called = true; return nil }
	host.quitApp = func() {}
	host.mu.Lock()
	host.guideJob = &workJob{id: "guide-1", kind: "story_bible", phase: "running"}
	host.mu.Unlock()
	if _, err := host.UpdateInstall(id); err == nil || !strings.Contains(err.Error(), "busy") {
		t.Fatalf("err = %v", err)
	}
	if called {
		t.Fatal("install ran while a Story Bible build was running")
	}
	// The download is kept: finishing the work and trying again installs it.
	host.mu.Lock()
	host.guideJob = nil
	host.mu.Unlock()
	if _, err := host.UpdateInstall(id); err != nil || !called {
		t.Fatalf("second try: %v, called %v", err, called)
	}
}

func TestStatusSaysWhyTheAppCannotReplaceItselfBeforeTheNarratorTries(t *testing.T) {
	host, id := stagedHost(t)
	host.installUpdate = func(context.Context, update.InstallOptions) error { t.Fatal("install must not run"); return nil }
	if status := host.updateStatus(); !status.CanInstall || status.InstallBlockedReason != "" {
		t.Fatalf("a writable install can be replaced: %+v", status)
	}
	// A folder the program may not write to (here, one that is not there).
	host.executable = func() (string, error) { return filepath.Join(t.TempDir(), "missing", "narration-utils.exe"), nil }
	if status := host.updateStatus(); status.CanInstall || !strings.Contains(status.InstallBlockedReason, "replace itself") {
		t.Fatalf("status = %+v", status)
	}
	if _, err := host.UpdateInstall(id); err == nil || !strings.Contains(err.Error(), "replace itself") {
		t.Fatalf("err = %v", err)
	}
	host.executable = func() (string, error) { return "", errors.New("no path") }
	if status := host.updateStatus(); status.CanInstall {
		t.Fatalf("an unknown install location cannot be replaced: %+v", status)
	}
	host.updates.Platform.SelfReplace = false
	if status := host.updateStatus(); status.CanInstall || !strings.Contains(status.InstallBlockedReason, "does not update itself") {
		t.Fatalf("status = %+v", status)
	}
	host.updates.Platform.SelfReplace = true
	host.version = "0.0.0-dev"
	if status := host.updateStatus(); status.CanInstall || !strings.Contains(status.InstallBlockedReason, "development") {
		t.Fatalf("status = %+v", status)
	}
}

func TestAFailedInstallLeavesTheUpdateReadyAndTheErrorReadable(t *testing.T) {
	host, id := stagedHost(t)
	host.quitApp = func() { t.Error("the app must not close after a failed install") }
	host.installUpdate = func(context.Context, update.InstallOptions) error {
		return update.UserError("The running program could not be moved aside, so it was not replaced.")
	}
	if _, err := host.UpdateInstall(id); err == nil || err.Error() != "The running program could not be moved aside, so it was not replaced." {
		t.Fatalf("err = %v", err)
	}
	if job := jobState(t, host, id); job.Phase != "ready" {
		t.Fatalf("the job is %q: a failed install must leave the update ready to try again", job.Phase)
	}
	host.installUpdate = func(context.Context, update.InstallOptions) error {
		return errors.New(`open C:\secret\path: access denied`)
	}
	_, err := host.UpdateInstall(id)
	if err == nil || strings.Contains(err.Error(), "secret") || !strings.Contains(err.Error(), "not changed") {
		t.Fatalf("a raw error must not reach the narrator: %v", err)
	}
	time.Sleep(quitDelay + 200*time.Millisecond) // a wrongly scheduled close would have fired by now
}

func TestInstallNeedsAKnownJobAndADownloadThatHasFinished(t *testing.T) {
	fake := newReleaseFiles(t)
	fake.serveZip = func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(fake.zip[:1024])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}
	host := downloadHost(t, fake)
	host.installUpdate = func(context.Context, update.InstallOptions) error { t.Fatal("install must not run"); return nil }
	if _, err := host.UpdateInstall("nope"); err == nil {
		t.Fatal("unknown job")
	}
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	started := startDownload(t, host)
	waitForJob(t, host, started.ID, func(job jobPayload) bool { return job.BytesDone >= 1024 })
	if _, err := host.UpdateInstall(started.ID); err == nil || !strings.Contains(err.Error(), "not downloaded yet") {
		t.Fatalf("err = %v", err)
	}
	cancelDownload(t, host, started.ID)
}

func TestTheDownloadedFileCanBeShownInItsFolderOnlyOnceItIsDownloaded(t *testing.T) {
	host, id := stagedHost(t)
	var opened []string
	host.openFolder = func(dir string) error { opened = append(opened, dir); return nil }
	if _, err := host.UpdateShowDownload(); err != nil {
		t.Fatal(err)
	}
	staged, _ := host.stagedUpdate()
	if len(opened) != 1 || opened[0] != staged.Dir {
		t.Fatalf("opened %v, want %s", opened, staged.Dir)
	}
	cancelDownload(t, host, id)
	fresh := downloadHost(t, newReleaseFiles(t))
	fresh.openFolder = func(string) error { t.Fatal("nothing to show"); return nil }
	if _, err := fresh.UpdateShowDownload(); err == nil {
		t.Fatal("no download, nothing to show")
	}
}

func TestTheFirstBootstrapConfirmsAnUpdateThatWasJustInstalled(t *testing.T) {
	fake := newReleaseFiles(t)
	host := downloadHost(t, fake)
	executable, _ := host.currentExecutable()
	if err := os.WriteFile(executable+".old", []byte("the previous version"), 0o600); err != nil {
		t.Fatal(err)
	}
	record := `{"from":"0.2.5","to":"0.2.6","executable":` + jsonString(executable) + `,"attempts":1}`
	if err := os.WriteFile(host.pendingPath, []byte(record), 0o600); err != nil {
		t.Fatal(err)
	}
	host.Bootstrap()
	if _, err := os.Stat(executable + ".old"); !os.IsNotExist(err) {
		t.Fatal("the previous version was not removed after the first Bootstrap")
	}
	if _, err := os.Stat(host.pendingPath); !os.IsNotExist(err) {
		t.Fatal("the launch record was not cleared")
	}
	// Only the first Bootstrap confirms.
	if err := os.WriteFile(executable+".old", []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	host.Bootstrap()
	if _, err := os.Stat(executable + ".old"); err != nil {
		t.Fatal("a later Bootstrap removed a file the first one did not")
	}
}

func jsonString(text string) string {
	quoted, _ := json.Marshal(text)
	return string(quoted)
}

func TestASecondInstallWhileTheFirstIsCopyingIsRefusedAndAFailureMakesTheUpdateReadyAgain(t *testing.T) {
	host, id := stagedHost(t)
	entered, release := make(chan struct{}), make(chan struct{})
	host.installUpdate = func(context.Context, update.InstallOptions) error {
		close(entered)
		<-release
		return update.UserError("The new program could not be copied next to the running one.")
	}
	first := make(chan error, 1)
	go func() {
		_, err := host.UpdateInstall(id)
		first <- err
	}()
	<-entered
	if _, err := host.UpdateInstall(id); err == nil || !strings.Contains(err.Error(), "already being installed") {
		t.Fatalf("a second install while the first runs: %v", err)
	}
	if host.canAttach() {
		t.Fatal("no project may be attached while the app is replacing itself")
	}
	if !host.idle() {
		t.Fatal("the install itself is not work the install must wait for")
	}
	if _, err := host.UpdateDownload(); err == nil {
		t.Fatal("no download may start while the app is installing")
	}
	close(release)
	if err := <-first; err == nil {
		t.Fatal("the first install failed and must say so")
	}
	if job := jobState(t, host, id); job.Phase != "ready" {
		t.Fatalf("after a failure the update is ready again, the job is %q", job.Phase)
	}
	if !host.canAttach() {
		t.Fatal("the app is usable again after a failed install")
	}
}

func TestTheWritableProbeIsNotRepeatedOnEveryStatus(t *testing.T) {
	host, _ := stagedHost(t)
	dir := t.TempDir()
	host.executable = func() (string, error) { return filepath.Join(dir, "narration-utils.exe"), nil }
	if reason := host.installBlockedReason(); reason != "" {
		t.Fatalf("reason = %q", reason)
	}
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if reason := host.installBlockedReason(); reason != "" {
		t.Fatalf("a folder probed a moment ago is not probed again: %q", reason)
	}
	host.writableMu.Lock()
	host.writableAt = time.Now().Add(-2 * writableTTL)
	host.writableMu.Unlock()
	if reason := host.installBlockedReason(); reason == "" {
		t.Fatal("after the cache expires the folder is probed again")
	}
}
