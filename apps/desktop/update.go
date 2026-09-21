package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/update"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// startupUpdateDelay is how long the automatic update check waits after the window is up: the check is metadata only and must
// never compete with what the narrator does first.
const startupUpdateDelay = 12 * time.Second

// updateStatusEvent is the event a background check sends when it found a release newer than the running version. Its payload is
// the same Status the UpdateStatus binding returns (apps/ui/src/api/schemas/update.ts).
const updateStatusEvent = "update:status"

// updateCachePath is the per-user file the update check remembers its answer in, beside the other cached data (never in a project).
func updateCachePath() string {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "narration-utils", "update", "check.json")
}

// updateSettings reads the two Updates settings: whether to check on startup and which channel counts. Both are global settings
// (a project has no say in how the app updates); a value that is missing or not one of the choices is the default.
func (h *Host) updateSettings() (checkOnStartup bool, channel update.Channel) {
	store := h.services().settings
	// Read the global tier and the defaults, never the project's file: a project a narrator opens (or is sent) must not switch
	// their updates off or change their channel.
	read := func(key, fallback string) string {
		if value, ok := store.Global("Updates")[key]; ok {
			return value
		}
		if value, ok := store.Defaults("Updates")[key]; ok {
			return value
		}
		return fallback
	}
	return read("check_on_startup", "true") != "false", update.ParseChannel(read("channel", string(update.ChannelCandidates)))
}

// updateStatus is the remembered answer and the running version. It makes no request.
func (h *Host) updateStatus() update.Status {
	_, channel := h.updateSettings()
	return h.updates.Status(channel)
}

// checkForUpdate asks GitHub now, for an explicit Check now. Every outcome is a status: a failure is the `failure` text the
// narrator reads, never an exception.
func (h *Host) checkForUpdate(ctx context.Context) update.Status {
	if _, err := h.updates.Check(ctx); err != nil && !errors.Is(err, update.ErrChecking) && !errors.Is(err, update.ErrNoPlatform) && ctx.Err() == nil {
		_ = h.log.Report("update_check_failed", err.Error())
	}
	return h.updateStatus()
}

// updateContext is the context an explicit check runs in: the app's own, so closing the app cancels it.
func (h *Host) updateContext() context.Context {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.ctx != nil {
		return h.ctx
	}
	return context.Background()
}

// autoCheckForUpdate is the once-a-day startup check: silent unless it found a release newer than the running version, and it says
// so through the update:status event. It asks nothing when the narrator switched it off or a check was made recently.
func (h *Host) autoCheckForUpdate(ctx context.Context) {
	enabled, _ := h.updateSettings()
	if !h.updates.Due(enabled, h.updates.Clock()) {
		return
	}
	if _, err := h.updates.Check(ctx); err != nil {
		if ctx.Err() == nil {
			_ = h.log.Report("update_check_failed", err.Error())
		}
		return
	}
	if status := h.updateStatus(); status.Available != nil {
		h.publishUpdate(status)
	}
}

// startupUpdateCheck waits, then runs the automatic check. It stops at once when the app closes.
func (h *Host) startupUpdateCheck(ctx context.Context, delay time.Duration) {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return
	case <-timer.C:
	}
	h.autoCheckForUpdate(ctx)
}

func (h *Host) publishUpdate(status update.Status) {
	h.mu.RLock()
	ctx, events := h.ctx, h.updateEvents
	h.mu.RUnlock()
	if events != nil {
		events(status)
		return
	}
	if ctx != nil {
		runtime.EventsEmit(ctx, updateStatusEvent, status)
	}
}

// openReleaseNotes opens the notes of the release the last check found, and nothing else: the address is the one the checker built
// from the repository and the tag, and no caller supplies one.
func (h *Host) openReleaseNotes() error {
	status := h.updateStatus()
	if status.Available == nil {
		return fmt.Errorf("there is no newer release to show")
	}
	h.mu.RLock()
	ctx, open := h.ctx, h.openURL
	h.mu.RUnlock()
	if open != nil {
		open(ctx, status.Available.NotesURL)
		return nil
	}
	if ctx == nil {
		return fmt.Errorf("the desktop host is not ready")
	}
	runtime.BrowserOpenURL(ctx, status.Available.NotesURL)
	return nil
}
