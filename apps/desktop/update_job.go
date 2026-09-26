package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/update"
)

// The phases of an update download, the words the UI polls for (apps/ui/src/api/contracts/update.ts).
const (
	updatePhaseDownloading = "downloading"
	updatePhaseVerifying   = "verifying"
	updatePhaseUnpacking   = "unpacking"
	updatePhaseReady       = "ready"
	updatePhaseInstalling  = "installing"
	updatePhaseError       = "error"
	updatePhaseCancelled   = "cancelled"
)

// updateJob is one download of one release. Its bytes are the real bytes received (ADR 0015).
type updateJob struct {
	mu sync.RWMutex
	// id is set when the job is made and never changes, so it is read without mu.
	id string
	// +checklocks:mu
	version string
	// +checklocks:mu
	phase string
	// +checklocks:mu
	message string
	// +checklocks:mu
	errorText string
	// +checklocks:mu
	done int64
	// +checklocks:mu
	total  int64
	cancel context.CancelFunc
	// +checklocks:mu
	started time.Time
	// +checklocks:mu
	staged update.Staged
	// +checklocks:mu
	hasStaged bool
}

// updateRunning reports whether the job is still working: not ready, failed or cancelled.
func (j *updateJob) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == updatePhaseDownloading || j.phase == updatePhaseVerifying || j.phase == updatePhaseUnpacking || j.phase == updatePhaseInstalling
}

// updateStagingRoot is where downloads are kept: the per-user cache, beside the other downloaded assets and never in a project.
func updateStagingRoot() string {
	return filepath.Join(filepath.Dir(updateCachePath()), "staged")
}

func newUpdateStager() *update.Stager {
	platform, _ := update.CurrentPlatform()
	return &update.Stager{Root: updateStagingRoot(), Platform: platform, Client: update.NewDownloadClient()}
}

// startUpdateDownload starts downloading the release the last check found, when there is one that this program can install. It never
// starts on its own: the only caller is the narrator's explicit click (ADR 0072).
func (h *Host) startUpdateDownload() (map[string]any, error) {
	if !h.updates.Platform.SelfReplace {
		return nil, update.UserError("This platform does not update itself. Open the release notes to download the update from the release page.")
	}
	_, channel := h.updateSettings()
	release, ok := h.updates.Newer(channel)
	if !ok {
		return nil, update.UserError("There is no newer release to download.")
	}
	h.mu.Lock()
	if h.updateJob != nil && h.updateJob.running() {
		h.mu.Unlock()
		return nil, update.UserError("An update download is already running.")
	}
	parent := h.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	id := fmt.Sprintf("update-%d", time.Now().UnixNano())
	ctx = runlog.WithRun(ctx, h.jobRuns.begin(h.runLog, id, jobKindAppUpdate, "version", release.Version.String()))
	job := &updateJob{id: id, version: release.Version.String(), phase: updatePhaseDownloading, total: release.Asset.Size, cancel: cancel, started: time.Now(),
		message: "Downloading Narration Utils " + release.Version.String() + "…"}
	h.updateJob = job
	stager := h.stager
	h.mu.Unlock()
	go h.runUpdateDownload(ctx, stager, release, job)
	return snapshotUpdateJob(job), nil
}

// runUpdateDownload stages the release and records how it ended. Closing the app cancels ctx, so a download never outlives it.
func (h *Host) runUpdateDownload(ctx context.Context, stager *update.Stager, release update.Release, job *updateJob) {
	defer job.cancel()
	staged, err := stager.Stage(ctx, release, func(progress update.Progress) {
		job.mu.Lock()
		defer job.mu.Unlock()
		job.done, job.total = progress.Done, progress.Total
		switch progress.Phase {
		case update.PhaseDownloading:
			job.phase, job.message = updatePhaseDownloading, "Downloading Narration Utils "+job.version+"…"
		case update.PhaseVerifying:
			job.phase, job.message = updatePhaseVerifying, "Checking the download against the release's checksum…"
		case update.PhaseUnpacking:
			job.phase, job.message = updatePhaseUnpacking, "Unpacking the program…"
		}
	})
	// What happened is logged before the job is locked: the poll must never wait on a disk write.
	var narratorText string
	if err != nil && ctx.Err() == nil {
		_ = h.log.Report("update_download_failed", err.Error())
		narratorText = update.UserMessage(err, "The update could not be downloaded.")
	}
	job.mu.Lock()
	switch {
	case err == nil:
		job.phase, job.message, job.staged, job.hasStaged = updatePhaseReady, "Version "+job.version+" is downloaded and checked.", staged, true
		job.done = job.total
	case ctx.Err() != nil:
		job.phase, job.message = updatePhaseCancelled, "The update download was cancelled."
	default:
		// The narrator reads a sentence; the log keeps what actually happened.
		job.phase, job.errorText = updatePhaseError, narratorText
		job.message = job.errorText
	}
	event, ok := endedJob(job.id, jobKindAppUpdate, job.phase, job.message, job.started)
	job.mu.Unlock()
	if ok {
		h.publishJobEnded(event)
	}
}

func (h *Host) updateJobByID(id string) (*updateJob, error) {
	h.mu.RLock()
	job := h.updateJob
	h.mu.RUnlock()
	if job == nil || job.id != id {
		return nil, update.UserError("That update download is not known.")
	}
	return job, nil
}

func (h *Host) updateJobState(id string) (map[string]any, error) {
	job, err := h.updateJobByID(id)
	if err != nil {
		return nil, err
	}
	return snapshotUpdateJob(job), nil
}

func (h *Host) cancelUpdateJob(id string) (map[string]any, error) {
	job, err := h.updateJobByID(id)
	if err != nil {
		return nil, err
	}
	job.cancel()
	return snapshotUpdateJob(job), nil
}

// stagedUpdate is the update that finished downloading and is ready to install, if there is one and its program is still there.
func (h *Host) stagedUpdate() (update.Staged, bool) {
	h.mu.RLock()
	job := h.updateJob
	h.mu.RUnlock()
	if job == nil {
		return update.Staged{}, false
	}
	job.mu.RLock()
	staged, ok := job.staged, job.hasStaged && job.phase == updatePhaseReady
	job.mu.RUnlock()
	if !ok {
		return update.Staged{}, false
	}
	if info, err := os.Lstat(staged.Executable); err != nil || !info.Mode().IsRegular() || info.Size() != staged.ExecutableSize {
		return update.Staged{}, false
	}
	return staged, true
}

// beginInstall takes the job from ready to installing and returns the staged program, or reports that it is not ready (not
// downloaded, gone, or already being installed). It is atomic under the job's lock.
func (j *updateJob) beginInstall() (update.Staged, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if !j.hasStaged || j.phase != updatePhaseReady {
		return update.Staged{}, false
	}
	if info, err := os.Lstat(j.staged.Executable); err != nil || !info.Mode().IsRegular() || info.Size() != j.staged.ExecutableSize {
		return update.Staged{}, false
	}
	j.phase, j.message = updatePhaseInstalling, "Installing version "+j.version+". Narration Utils restarts in a moment."
	return j.staged, true
}

// endInstall records how the install ended: on failure the update is ready again to be tried; on success it stays on its last step.
func (j *updateJob) endInstall(installed bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if !installed {
		j.phase, j.message = updatePhaseReady, "Version "+j.version+" is downloaded and checked."
	}
}

// installing reports whether the job is on its last step: the app is replacing itself and about to close.
func (j *updateJob) installing() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == updatePhaseInstalling
}

// readyUpdate is the job and version of the update that finished downloading and is still there to install.
func (h *Host) readyUpdate() (id, version string, ok bool) {
	h.mu.RLock()
	job := h.updateJob
	h.mu.RUnlock()
	if job == nil {
		return "", "", false
	}
	job.mu.RLock()
	staged, ready := job.staged, job.hasStaged && job.phase == updatePhaseReady
	id, version = job.id, job.version
	job.mu.RUnlock()
	if !ready {
		return "", "", false
	}
	if info, err := os.Lstat(staged.Executable); err != nil || !info.Mode().IsRegular() || info.Size() != staged.ExecutableSize {
		return "", "", false
	}
	return id, version, true
}

// snapshotUpdateJob is the payload the download bindings send. The percent is bytes received over bytes expected, and nothing else.
func snapshotUpdateJob(job *updateJob) map[string]any {
	job.mu.RLock()
	defer job.mu.RUnlock()
	percent := update.Progress{Done: job.done, Total: job.total}.Percent()
	if job.phase == updatePhaseReady {
		percent = 100
	}
	return map[string]any{"id": job.id, "version": job.version, "phase": job.phase, "message": job.message, "percent": percent, "bytesDone": job.done, "bytesTotal": job.total, "error": job.errorText}
}
