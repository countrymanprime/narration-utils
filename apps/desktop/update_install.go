package main

import (
	"os"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/update"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// quitDelay is how long the host waits after answering UpdateInstall before it closes: the answer has to reach the window first.
const quitDelay = 400 * time.Millisecond

// updateBusyReason is what the narrator reads when the update is refused because work is running.
const updateBusyReason = "Narration Utils is busy, so the update was not installed. Finish or stop what is running (an import, a Story Bible build, a download, a comparison or a teleprompter session), then try again."

// currentExecutable is the path of the running program with any links resolved: the path the update replaces.
func (h *Host) currentExecutable() (string, error) {
	if h.executable != nil {
		return h.executable()
	}
	return update.CurrentExecutable()
}

// writableTTL is how long a folder's writability is remembered: the probe creates a file, and the status is asked for often.
const writableTTL = 30 * time.Second

// writable reports whether the install folder can be written to, from a probe at most once per writableTTL for a folder.
func (h *Host) writable(dir string) bool {
	h.writableMu.Lock()
	defer h.writableMu.Unlock()
	if h.writableDir == dir && time.Since(h.writableAt) < writableTTL {
		return h.writableOK
	}
	h.writableDir, h.writableAt, h.writableOK = dir, time.Now(), update.WritableDir(dir) == nil
	return h.writableOK
}

// installBlockedReason says why this program cannot replace itself, or "" when it can: a development build has nothing to update to,
// only Windows replaces itself, and the folder it lives in must be one it may write to (it never asks for elevation).
func (h *Host) installBlockedReason() string {
	switch {
	case update.IsDevelopment(h.version):
		return "A development build does not update itself."
	case !h.updates.Platform.SelfReplace:
		return "This platform does not update itself."
	}
	executable, err := h.currentExecutable()
	if err != nil {
		return "Narration Utils could not find where it is installed."
	}
	if !h.writable(filepath.Dir(executable)) {
		return update.ErrNotWritable.Error()
	}
	return ""
}

// installDownloadedUpdate replaces the running program with the update that finished downloading and starts it, when nothing is
// running that the restart would displace. It is the narrator's explicit action. On success the app closes a moment later, once this
// answer has reached the window; on any failure the running program is exactly as it was.
func (h *Host) installDownloadedUpdate(id string) (map[string]any, error) {
	job, err := h.updateJobByID(id)
	if err != nil {
		return nil, err
	}
	if job.installing() {
		return nil, update.UserError("The update is already being installed.")
	}
	if reason := h.installBlockedReason(); reason != "" {
		return nil, update.UserError(reason)
	}
	// The same rule that keeps a second REAPER launch from displacing work: an import draft, a Story Bible build, a download, a
	// comparison or a teleprompter session is never thrown away by a restart.
	if !h.canAttach() {
		return nil, update.UserError(updateBusyReason)
	}
	executable, err := h.currentExecutable()
	if err != nil {
		return nil, update.UserError("Narration Utils could not find where it is installed.")
	}
	// Taking the job from ready to installing is the one step that decides which call installs: a second click, or a retry, that comes
	// while this one is copying finds the job no longer ready and is refused, so two installs never race over the same files.
	staged, ok := job.beginInstall()
	if !ok {
		return nil, update.UserError("The update is not downloaded yet, or it is already being installed.")
	}
	install := h.installUpdate
	if install == nil {
		install = update.Install
	}
	err = install(h.updateContext(), update.InstallOptions{
		Staged: staged, Executable: executable, Args: os.Args[1:], PID: os.Getpid(), From: h.version, To: staged.Release.Version.String(), PendingPath: h.pendingPath,
		Ready: h.idle,
	})
	if err != nil {
		job.endInstall(false)
		_ = h.log.Report("update_install_failed", err.Error())
		return nil, update.UserError(update.UserMessage(err, "The update could not be installed. The running version was not changed."))
	}
	job.endInstall(true)
	go h.closeForUpdate()
	return snapshotUpdateJob(job), nil
}

// closeForUpdate closes the app after a successful install: the new program is already started and waiting for this process to exit.
func (h *Host) closeForUpdate() {
	time.Sleep(quitDelay)
	if h.quitApp != nil {
		h.quitApp()
		return
	}
	if h.sidecars != nil {
		_ = h.sidecars.Close()
	}
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil {
		runtime.Quit(ctx)
	}
}

// confirmInstalledUpdate runs once, on the first Bootstrap: an update that was just installed has started, so the program it replaced
// is removed and the launch record cleared.
func (h *Host) confirmInstalledUpdate() {
	executable, err := h.currentExecutable()
	if err != nil {
		return
	}
	update.Confirm(update.StartupOptions{
		Executable: executable, PendingPath: h.pendingPath, Version: h.version,
		Log: func(kind, message string) { _ = h.log.Report(kind, message) },
	})
}

// showDownloadedUpdate opens the folder that holds the downloaded program, for a narrator whose install the app may not replace.
func (h *Host) showDownloadedUpdate() error {
	staged, ok := h.stagedUpdate()
	if !ok {
		return update.UserError("The update is not downloaded yet.")
	}
	if h.openFolder != nil {
		return h.openFolder(staged.Dir)
	}
	return update.OpenFolder(staged.Dir)
}
