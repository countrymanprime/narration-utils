package main

import (
	"context"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// Background recording checks (daw-chapter-track-auto-sync.prd.md Phase 7, S7, D27, ADR 0211). Every
// backgroundCheckInterval the host asks coverage.NextBackground whether a linked chapter whose recording changed since
// its check may be checked now, and starts it through the same coverage.Start as a narrator's press, marked Background.
// A narrator's own start pre-empts it (coverageStart), and a chapter the host already tried at its current change is
// not tried again, so a narrator's Cancel sticks until the chapter changes.

const (
	backgroundCheckInterval = 30 * time.Second
	// settingBackgroundChecks is RecordingCoverage.background_checks, on by default.
	settingBackgroundChecks = "background_checks"
)

// chapterSyncBackground is chaptersync:state's word on background checks: whether they are on, and why none runs now
// (a coverage.BackgroundWait: off, busy, model, battery, recording, quiet, nothing; "" when one was just started or
// the host has not looked yet).
type chapterSyncBackground struct {
	Enabled bool   `json:"enabled"`
	Wait    string `json:"wait"`
}

// backgroundChecks is what the loop remembers for the open project.
type backgroundChecks struct {
	mu sync.Mutex
	// +checklocks:mu
	folder string
	// attempted maps a chapter to the change it was last started for (its LastChanged).
	// +checklocks:mu
	attempted map[string]time.Time
	// +checklocks:mu
	last coverage.BackgroundDecision
	// +checklocks:mu
	looked bool
}

// forFolderLocked resets what the loop remembers when the project changed. The caller holds mu.
func (b *backgroundChecks) forFolderLocked(folder string) {
	if b.folder != folder || b.attempted == nil {
		b.folder, b.attempted, b.last, b.looked = folder, map[string]time.Time{}, coverage.BackgroundDecision{}, false
	}
}

// stateFor is chaptersync:state's background field for folder.
func (b *backgroundChecks) stateFor(folder string, enabled bool) chapterSyncBackground {
	b.mu.Lock()
	defer b.mu.Unlock()
	state := chapterSyncBackground{Enabled: enabled}
	if b.folder == folder && b.looked {
		state.Wait = string(b.last.Wait)
	}
	return state
}

// backgroundCheckLoop runs the scheduler until ctx ends (ServiceStartup).
func (h *Host) backgroundCheckLoop(ctx context.Context) {
	ticker := time.NewTicker(backgroundCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			h.backgroundCheckTick(now)
		}
	}
}

// backgroundChecksEnabled reads RecordingCoverage.background_checks.
func backgroundChecksEnabled(svc hostServices) bool {
	if svc.settings == nil {
		return false
	}
	value, _ := svc.settings.Effective(coverage.SettingsTool, settingBackgroundChecks, "true")
	return value == "true"
}

// backgroundCheckTick makes one decision and, when it names a chapter, starts that chapter's check. It sends
// chaptersync:state when the reason to wait changes, so the UI can say why nothing runs.
func (h *Host) backgroundCheckTick(now time.Time) coverage.BackgroundDecision {
	svc := h.services()
	folder := svc.config.projectFolder
	if svc.coverage == nil || folder == "" {
		return coverage.BackgroundDecision{}
	}
	transcription, modelReady := h.coverageTranscription(svc)
	power := coverage.PowerUnknown
	if h.powerState != nil {
		power = h.powerState()
	} else {
		power = platformPower()
	}
	// The heartbeat does not say yet whether REAPER is recording (a play-state bit on PROJECT_STATUS is lane B's to
	// add), so a running REAPER leaves RecordingKnown false and background checks wait until it closes.
	conditions := coverage.BackgroundConditions{
		Enabled: backgroundChecksEnabled(svc), ModelReady: modelReady, Busy: !h.idle(), Power: power,
		ReaperRunning: svc.reachability != nil && svc.reachability.Reachable(),
		LastActivity:  h.chapterSyncWatch.lastActivityFor(folder), Now: now,
	}

	b := &h.backgroundChecks
	candidates := []coverage.BackgroundCandidate{}
	if conditions.Enabled && !conditions.Busy {
		if state, err := h.chapterSyncState(); err == nil {
			b.mu.Lock()
			b.forFolderLocked(folder)
			for _, row := range state.Chapters {
				if row.TrackGUID == "" || row.LastChanged == nil || row.Checking {
					continue
				}
				// A never-checked chapter is a candidate only when a sync saw its track change: a whole book is never
				// checked from scratch on its own.
				if row.Freshness == string(evidence.StateNever) && row.TrackChangedAt == nil {
					continue
				}
				if tried, ok := b.attempted[row.ChapterID]; ok && tried.Equal(*row.LastChanged) {
					continue
				}
				candidates = append(candidates, coverage.BackgroundCandidate{
					ChapterID: row.ChapterID, Freshness: evidence.EvaluatorState(row.Freshness), LastChanged: *row.LastChanged,
				})
			}
			b.mu.Unlock()
		}
	}
	decision := coverage.NextBackground(conditions, candidates)

	b.mu.Lock()
	b.forFolderLocked(folder)
	changed := !b.looked || b.last.Wait != decision.Wait
	b.last, b.looked = decision, true
	for _, candidate := range candidates {
		if candidate.ChapterID == decision.ChapterID {
			b.attempted[candidate.ChapterID] = candidate.LastChanged
		}
	}
	b.mu.Unlock()

	if decision.ChapterID != "" {
		_, err := svc.coverage.Start(coverage.Request{
			ChapterID: decision.ChapterID, Transcription: transcription, Alignment: coverageSettings(svc.settings).Alignment, Background: true,
		})
		if err != nil && h.log != nil {
			_ = h.log.Report("background_check_failed", decision.ChapterID+": "+err.Error())
		}
		changed = true
	}
	if changed {
		h.emitChapterSyncState()
	}
	return decision
}

// coverageTranscription is the narrator's Transcript Compare model for a check, and false when it is not installed
// (a background check never downloads one).
func (h *Host) coverageTranscription(svc hostServices) (coverage.Transcription, bool) {
	models := h.registry().whisper
	if models == nil {
		return coverage.Transcription{}, false
	}
	modelID := resolveWhisperModelID(svc.settings, nil)
	if _, known := models.Model(modelID); !known {
		return coverage.Transcription{}, false
	}
	modelDir, err := models.Dir(modelID)
	if err != nil {
		return coverage.Transcription{}, false
	}
	return coverage.Transcription{Model: modelID, ModelDir: modelDir}, true
}
