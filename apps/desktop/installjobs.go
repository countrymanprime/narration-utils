package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

// The kinds of asset install. The wrappers over the voice and model bindings (TtsInstall, WhisperInstall) each start one.
const (
	installKindTts        = "tts"
	installKindWhisper    = "whisper"
	installKindSpacy      = "spacy"
	installKindMoonshine  = "moonshine"
	installKindDictionary = "dictionary"
)

// The phases of an asset install, the words the UI polls for (apps/ui/src/api/contracts/assets.ts). Whisper used to say "running"; every
// asset now speaks the update download's vocabulary.
const (
	installPhaseDownloading = "downloading"
	installPhaseVerifying   = "verifying"
	installPhaseSuccess     = "success"
	installPhaseCancelled   = "cancelled"
	installPhaseError       = "error"
)

// installJob is one download of one approved asset. Its bytes are the real bytes received (ADR 0015).
type installJob struct {
	mu sync.RWMutex
	// id, kind and assetID are set when the job is made and never change, so they are read without mu.
	id      string
	kind    string
	assetID string
	// +checklocks:mu
	phase string
	// +checklocks:mu
	message string
	// +checklocks:mu
	errorText string
	// downloadingText is the message while bytes arrive, so a file that follows a checked one does not keep saying it is checking.
	// +checklocks:mu
	downloadingText string
	// +checklocks:mu
	done int64
	// +checklocks:mu
	total int64
	// received keeps the bytes of each file so far, so a job of several files reports one running total that never goes back.
	// +checklocks:mu
	received map[string]int64
	ctx      context.Context
	cancel   context.CancelFunc
	// finished is closed when the job has ended, so a start that follows a cancel can wait for the files to be free.
	finished chan struct{}
	// +checklocks:mu
	started time.Time
}

// installSeq keeps job ids apart when two installs start within one clock tick. It is an atomic; checklocks
// sees it used only under h.mu and would ask for an annotation it does not need.
var installSeq atomic.Int64 // +checklocksignore

// running reports whether the job is still working: downloading or checking its files.
func (j *installJob) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.runningLocked()
}

// +checklocksread:j.mu
func (j *installJob) runningLocked() bool {
	return j.phase == installPhaseDownloading || j.phase == installPhaseVerifying
}

// installSpec is what differs between one kind of asset and the next: the words, the files and how to run the install.
type installSpec struct {
	kind, assetID string
	// endedKind is the job:ended kind (jobs.go); noun is the asset in the narrator's words ("voice", "Whisper model").
	endedKind, noun string
	files           []assets.File
	run             func(ctx context.Context, options assets.Options) error
}

// startInstall starts the install of one approved asset, or joins the one already running for it: a second press, a second window or a
// retry that arrives before the first finished never starts a second download of the same files.
// errBeingRemoved is what a start says when the same asset is being removed at that moment.
func errBeingRemoved(noun string) error {
	return fmt.Errorf("the %s is being removed: try again in a moment", noun)
}

func (h *Host) startInstall(spec installSpec) (map[string]any, error) {
	var total int64
	for _, file := range spec.files {
		total += file.Size
	}
	for {
		h.mu.Lock()
		if h.removing[spec.kind+"/"+spec.assetID] {
			h.mu.Unlock()
			return nil, errBeingRemoved(spec.noun)
		}
		var dying *installJob
		for _, existing := range h.installJobs {
			if existing.kind != spec.kind || existing.assetID != spec.assetID || !existing.running() {
				continue
			}
			if existing.ctx.Err() == nil {
				h.mu.Unlock()
				return snapshotInstall(existing), nil
			}
			dying = existing
		}
		if dying != nil {
			// The narrator pressed Cancel and the download is still winding down. A new job would write the same staging folder, so it waits
			// for the old one to let go (a cancelled download ends as soon as its request does).
			h.mu.Unlock()
			select {
			case <-dying.finished:
			case <-time.After(10 * time.Second):
				return snapshotInstall(dying), nil
			}
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		downloading := "Downloading and verifying the approved " + spec.noun + "…"
		job := &installJob{id: fmt.Sprintf("%s-%d-%d", spec.kind, time.Now().UnixNano(), installSeq.Add(1)), kind: spec.kind, assetID: spec.assetID, phase: installPhaseDownloading,
			message: downloading, downloadingText: downloading, total: total, received: map[string]int64{}, ctx: ctx, cancel: cancel, finished: make(chan struct{}), started: time.Now()}
		h.installJobs[job.id] = job
		h.mu.Unlock()
		go h.runInstall(ctx, spec, job)
		return snapshotInstall(job), nil
	}
}

func (h *Host) runInstall(ctx context.Context, spec installSpec, job *installJob) {
	defer close(job.finished)
	defer job.cancel()
	err := h.runGuarded(ctx, spec, job)
	// The cause is logged before the job is locked: a poll must never wait on a disk write.
	var narratorText string
	if err != nil && ctx.Err() == nil {
		_ = h.log.Report("install_failed", spec.kind+" "+spec.assetID+": "+err.Error())
		narratorText = installFailureText(err, spec.noun)
	}
	job.mu.Lock()
	switch {
	case err == nil:
		job.phase, job.message, job.done = installPhaseSuccess, installDoneText(spec.noun), job.total
	case ctx.Err() != nil:
		job.phase, job.message = installPhaseCancelled, installCancelledText(spec.noun)
	default:
		job.phase, job.errorText, job.message = installPhaseError, narratorText, narratorText
	}
	event, ok := endedJob(job.id, spec.endedKind, job.phase, job.message, job.started)
	job.mu.Unlock()
	if ok {
		h.publishJobEnded(event)
	}
}

// runGuarded runs the install and turns a panic into a failure, so a job never stays "downloading" for good (that would hold off every
// project switch).
func (h *Host) runGuarded(ctx context.Context, spec installSpec, job *installJob) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("the install stopped unexpectedly: %v", recovered)
		}
	}()
	return spec.run(ctx, assets.Options{
		OnProgress: func(file assets.File, done int64) { job.record(file, done) },
		OnVerify:   func(assets.File) { job.checking(spec.noun) },
	})
}

// record notes the bytes of one file so far and moves the job back to downloading (a later file follows a checked one).
func (j *installJob) record(file assets.File, done int64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if done > j.received[file.Name] {
		j.received[file.Name] = done
	}
	var sum int64
	for _, bytes := range j.received {
		sum += bytes
	}
	if sum > j.done {
		j.done = sum
	}
	if j.done > j.total {
		j.done = j.total
	}
	if j.phase != installPhaseDownloading {
		j.phase, j.message = installPhaseDownloading, j.downloadingText
	}
}

// checking says a file has arrived and is being hashed. The next file's first bytes move the job back to downloading.
func (j *installJob) checking(noun string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.phase, j.message = installPhaseVerifying, "Checking the "+noun+" against its approved checksum…"
}

func installDoneText(noun string) string      { return capitalize(noun) + " installed and verified." }
func installCancelledText(noun string) string { return capitalize(noun) + " download cancelled." }

func capitalize(text string) string {
	if text == "" {
		return text
	}
	return strings.ToUpper(text[:1]) + text[1:]
}

// installFailureText is what a narrator reads when an install failed: what happened and what to do, never the address or the socket error
// (those are in the host log).
func installFailureText(err error, noun string) string {
	var short *assets.InsufficientSpaceError
	var status *assets.StatusError
	switch {
	case errors.Is(err, assets.ErrChecksumMismatch), errors.Is(err, assets.ErrSizeMismatch):
		return "The downloaded " + noun + " did not match the approved file, so it was not installed. Try again; if it keeps happening, the file may have changed at its source."
	case errors.Is(err, assets.ErrBadArchive), errors.Is(err, assets.ErrBadContent):
		return "The downloaded " + noun + " matched the approved file but could not be unpacked or prepared, so it was not installed. This is a " +
			"problem with the release, not with your connection: please report it."
	case errors.As(err, &short):
		return short.Error()
	case assets.IsDiskFull(err):
		return "The disk filled up while the " + noun + " was downloading. Free some space and try again: what was downloaded so far is kept, so the download carries on from there."
	case errors.As(err, &status) && status.Missing():
		return "The download host no longer has the approved " + noun + ". This is a problem with the release, not with your connection: please report it."
	case errors.As(err, &status):
		return "The download host is busy or refused the request. Try again in a few minutes."
	}
	return "The " + noun + " could not be downloaded. Check your internet connection and try again: what was downloaded so far is kept, so the download carries on from there."
}

func (h *Host) installJobByID(id, what string) (*installJob, error) {
	h.mu.RLock()
	job := h.installJobs[id]
	h.mu.RUnlock()
	if job == nil {
		return nil, fmt.Errorf("unknown %s install job", what)
	}
	return job, nil
}

// snapshotInstall is the payload of the install bindings. Percent is bytes received over bytes expected, and nothing else (ADR 0015),
// and 99 until the install has succeeded. The generic asset bindings send it as it is.
func snapshotInstall(job *installJob) map[string]any {
	job.mu.RLock()
	defer job.mu.RUnlock()
	percent := 0
	switch {
	case job.phase == installPhaseSuccess:
		percent = 100
	case job.total > 0:
		percent = int(job.done * 100 / job.total)
		if percent > 99 {
			percent = 99
		}
	}
	return map[string]any{"id": job.id, "kind": job.kind, "assetId": job.assetID, "phase": job.phase, "message": job.message, "percent": percent,
		"bytesDone": job.done, "bytesTotal": job.total, "error": job.errorText}
}

// legacyInstall is the payload of the voice and Whisper install bindings that predate the generic ones: the same job, and the asset named
// as voiceId or modelId, which the pages that use them read.
func legacyInstall(snapshot map[string]any) map[string]any {
	if snapshot == nil {
		return nil
	}
	if snapshot["kind"] == installKindTts {
		snapshot["voiceId"] = snapshot["assetId"]
	} else {
		snapshot["modelId"] = snapshot["assetId"]
	}
	return snapshot
}
