package main

import (
	"context"
	"os"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Watching the saved REAPER project (daw-chapter-track-auto-sync.prd.md Phase 4, S6 A and B, ADR 0210). While a
// project with chapter sync on has a .rpp to read, the host stats that file every chapterSyncPollInterval. When its
// modification time moves and then holds still for chapterSyncDebounce, the host re-runs the sync (trigger "watch"),
// so a new track saved in REAPER for the next chapter is linked and announced without a click. REAPER's edit counter,
// which the bridge's heartbeat carries unasked (PROJECT_STATUS's changeCount), only says "REAPER has changes the saved
// file does not have yet" (unsavedEdits): the saved file stays what a sync reads. The watcher sends REAPER nothing.

const (
	// chapterSyncPollInterval is how often the saved .rpp is stat'ed: one stat, no read, while sync is on.
	chapterSyncPollInterval = 2 * time.Second
	// chapterSyncDebounce is how long the .rpp's modification time must hold still before the sync re-reads it, so a
	// save that writes the file in several steps is read once, after the last.
	chapterSyncDebounce = 1500 * time.Millisecond
)

// chapterSyncWatcher is what the watcher saw last, for one project folder and .rpp at a time. A different folder or
// file (a project switch, another .rpp chosen) starts over from a new baseline, since each of those paths runs its own
// sync.
type chapterSyncWatcher struct {
	mu sync.Mutex
	// +checklocks:mu
	folder string
	// +checklocks:mu
	path string
	// modTime is the .rpp's last seen modification time; changedAt is when a new one was first seen (zero when none
	// is waiting for the debounce).
	// +checklocks:mu
	modTime time.Time
	// +checklocks:mu
	changedAt time.Time
	// countBase is REAPER's edit counter as of the last sync (or the first heartbeat seen); a different count since
	// means edits the saved file does not have.
	// +checklocks:mu
	countBase int
	// +checklocks:mu
	hasCountBase bool
	// +checklocks:mu
	unsavedEdits bool
}

// unsavedFor reports whether REAPER has unsaved edits to folder's watched project.
func (w *chapterSyncWatcher) unsavedFor(folder string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.folder == folder && w.unsavedEdits
}

// chapterSyncWatchLoop runs the watcher until ctx ends (ServiceStartup).
func (h *Host) chapterSyncWatchLoop(ctx context.Context) {
	ticker := time.NewTicker(chapterSyncPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			h.chapterSyncWatchTick(now)
		}
	}
}

// chapterSyncWatchTick is one look at the saved project and the heartbeat's edit counter. It runs a sync once a
// changed .rpp has settled, and otherwise sends chaptersync:state only when unsavedEdits changes.
func (h *Host) chapterSyncWatchTick(now time.Time) {
	svc := h.services()
	folder := svc.config.projectFolder
	path, modTime := "", time.Time{}
	if folder != "" && h.chapterSyncConsentOn(folder) {
		if selected, err := selectedProjectFile(folder, svc.settings); err == nil && selected != "" {
			if info, err := os.Stat(selected); err == nil {
				path, modTime = selected, info.ModTime()
			}
		}
	}
	count, counted := 0, false
	if path != "" && svc.reachability != nil && svc.reachability.Matches(path) {
		count, counted = svc.reachability.ChangeCount()
	}

	w := &h.chapterSyncWatch
	w.mu.Lock()
	if path == "" || folder != w.folder || path != w.path {
		cleared := w.unsavedEdits
		w.folder, w.path, w.modTime, w.changedAt = folder, path, modTime, time.Time{}
		w.countBase, w.hasCountBase, w.unsavedEdits = count, counted, false
		w.mu.Unlock()
		if cleared {
			h.emitChapterSyncState()
		}
		return
	}
	if !modTime.Equal(w.modTime) {
		w.modTime, w.changedAt = modTime, now
	}
	flipped := false
	switch {
	case !counted:
		// No live, matching heartbeat with a counter: nothing is known about unsaved edits.
		flipped, w.unsavedEdits, w.hasCountBase = w.unsavedEdits, false, false
	case !w.hasCountBase || count < w.countBase:
		// The first count seen, or REAPER reopened the project (the counter starts again): a new baseline.
		flipped, w.unsavedEdits = w.unsavedEdits, false
		w.countBase, w.hasCountBase = count, true
	case count != w.countBase && !w.unsavedEdits:
		w.unsavedEdits, flipped = true, true
	}
	due := !w.changedAt.IsZero() && now.Sub(w.changedAt) >= chapterSyncDebounce
	if due {
		// The save is what the sync reads, so the edits before it are no longer unsaved.
		w.changedAt, w.unsavedEdits = time.Time{}, false
		w.countBase, w.hasCountBase = count, counted
	}
	w.mu.Unlock()
	switch {
	case due:
		h.chapterSyncTrigger(syncTriggerWatch)
	case flipped:
		h.emitChapterSyncState()
	}
}

// chapterSyncConsentOn reports whether folder's narrator said Sync. A manifest that cannot be read counts as no.
func (h *Host) chapterSyncConsentOn(folder string) bool {
	manifest, ok, err := project.Load(h.persist, folder)
	if err != nil || !ok {
		return false
	}
	consent, _ := consentOf(manifest)
	return consent == consentOn
}

// emitChapterSyncState sends the current state without syncing; a state that cannot be read is logged.
func (h *Host) emitChapterSyncState() {
	state, err := h.chapterSyncState()
	if err != nil {
		if h.log != nil {
			_ = h.log.Report("chapter_sync_failed", "watch: "+err.Error())
		}
		return
	}
	h.emitChapterSync(state)
}
