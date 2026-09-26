package main

import (
	"context"
	"sync"
	"time"
)

// Following REAPER while idle (read-aloud-resume-from-daw PRD Phase 5). While a Read aloud dialog shows the resume
// prompt and no session is running, the host polls chapter_track_state about once a second and tells the UI to
// dismiss the prompt the moment REAPER starts playing or recording (RD7, "it should go away if we start playing").
// It never touches REAPER; it only reads, at the same reaperConnected trust level Phase 4's locate already uses.

const (
	// resumeWatchPollInterval is how often the watched track's live state is read.
	resumeWatchPollInterval = 1 * time.Second
	// resumeWatchMaxLifetime bounds a watch that a dialog never explicitly stops (a crash, a dropped event): it stops
	// itself well past any narrator's normal setup time, rather than polling forever.
	resumeWatchMaxLifetime = 10 * time.Minute
)

// resumeWatch is the poll's lifecycle: one watch runs at a time, cancelled by TeleprompterUnwatchResume, by a new
// TeleprompterWatchResume call replacing it, or by its own timeout. interval is a seam for tests; zero means
// resumeWatchPollInterval.
type resumeWatch struct {
	mu sync.Mutex
	// +checklocks:mu
	cancel context.CancelFunc
	// +checklocks:mu
	interval time.Duration
}

// TeleprompterWatchResume starts polling trackGUID for RD7, replacing any watch already running. A track with no
// live bridge (REAPER unreachable, the experimental switch off, no track GUID) never polls: the resume prompt's own
// per-open lookup (Phase 4) already covers those states, and there is nothing here to watch for.
func (h *Host) TeleprompterWatchResume(trackGUID string) (string, error) {
	svc := h.services()
	var reader trackStateReader
	if svc.actions != nil {
		reader = svc.actions
	}
	h.resumeWatch.start(reader, reaperStatus(svc).Connection, trackGUID, h.emitTeleprompterResumeLive)
	return encodeBinding(nil, nil)
}

// TeleprompterUnwatchResume stops the poll: the dialog closed, or the prompt already settled (Start reading, a
// choice, or a session beginning). Stopping a watch that is not running is not an error.
func (h *Host) TeleprompterUnwatchResume() (string, error) {
	h.resumeWatch.stop()
	return encodeBinding(nil, nil)
}

func (w *resumeWatch) start(reader trackStateReader, connection, trackGUID string, dismiss func()) {
	w.stop()
	if reader == nil || connection != reaperConnected || trackGUID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), resumeWatchMaxLifetime)
	w.mu.Lock()
	w.cancel = cancel
	interval := w.interval
	w.mu.Unlock()
	if interval <= 0 {
		interval = resumeWatchPollInterval
	}
	go w.poll(ctx, reader, trackGUID, interval, dismiss)
}

func (w *resumeWatch) stop() {
	w.mu.Lock()
	cancel := w.cancel
	w.cancel = nil
	w.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// poll asks REAPER about trackGUID every resumeWatchPollInterval until ctx ends or REAPER answers playing or
// recording, in which case it calls dismiss once and stops: the dialog's own next open starts a fresh watch, so one
// dismissal is enough (RD7 does not ask for more than that). A refusal (a stale track, a momentary unavailability)
// never stops the poll; the next tick simply tries again.
func (w *resumeWatch) poll(ctx context.Context, reader trackStateReader, trackGUID string, interval time.Duration, dismiss func()) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			state, err := reader.ChapterTrackState(ctx, trackGUID)
			if err != nil {
				continue
			}
			if state.Playing || state.Recording {
				if dismiss != nil {
					dismiss()
				}
				return
			}
		}
	}
}
