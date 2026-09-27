package main

import (
	"context"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// The punch-and-roll anchor poll (teleprompter-manuscript-integration.prd.md Phase 12, ADR 0246, owner decision
// 2026-09-23: live anchors first). While a live session is reading a manuscript chapter, this loop asks REAPER's
// play position (dawport.Puncher, the same role "Punch from here" resolves through) every punchAnchorPollInterval and
// pairs it with the word the reader is on (teleprompter.Service.CurrentWord), so a later punch can resolve any word's
// project time from teleprompter.ResolveWordTime. It changes nothing in REAPER (PlayPosition is read-only) and never
// surfaces a failure to the narrator: a missed poll just leaves that stretch of the chapter to the alignment fallback.

// punchAnchorPollInterval bounds how often the loop asks REAPER: each call costs about 50-100ms through the file
// bridge (bridge/punch.go), so this stays well above that, at a granularity that still brackets most punch targets
// closely (a few seconds of narration between anchors).
const punchAnchorPollInterval = 3 * time.Second

// punchAnchorPollTimeout bounds one PlayPosition call so a slow or wedged bridge never stalls the loop past the next
// tick.
const punchAnchorPollTimeout = 2 * time.Second

// punchAnchorLoop runs until ctx ends (ServiceStartup), the same shape as backgroundCheckLoop.
func (h *Host) punchAnchorLoop(ctx context.Context) {
	ticker := time.NewTicker(punchAnchorPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.punchAnchorTick(ctx)
		}
	}
}

// punchAnchorTick makes one poll. It is a no-op whenever there is nothing to anchor: no project, no live session on a
// chapter, or REAPER's punch role not available now (no bridge, the capability off, or Experimental with the setting
// off) - all ordinary states, not failures.
func (h *Host) punchAnchorTick(parent context.Context) {
	svc := h.services()
	project := svc.config.projectFolder
	if project == "" || svc.teleprompter == nil || svc.dawPortResolver == nil {
		return
	}
	chapterID, word, ok := svc.teleprompter.CurrentWord()
	if !ok {
		return
	}
	puncher, err := dawport.Role[dawport.Puncher](svc.dawPortResolver, dawport.CapPunch)
	if err != nil {
		return
	}
	pollPunchAnchor(parent, puncher, project, chapterID, word, h.log)
}

// pollPunchAnchor is punchAnchorTick's testable core, once a Puncher role is already resolved: ask its play position
// and record one anchor. Split out so a test can supply a fake Puncher directly, without a REAPER bridge or a
// dawport resolver.
func pollPunchAnchor(parent context.Context, puncher dawport.Puncher, project, chapterID string, word int, log *hostlog.Log) {
	ctx, cancel := context.WithTimeout(parent, punchAnchorPollTimeout)
	defer cancel()
	position, err := puncher.PlayPosition(ctx)
	if err != nil {
		return
	}
	// Heard (GetPlayPosition) is the position the narrator hears, the working default until spike 1 decides which
	// play position anchors a word best (teleprompter-manuscript-integration.prd.md Phase 12, still owner-gated); no
	// ASR-latency correction is applied yet, since it is not measured for either engine (the PRD's own Evidence).
	anchor := teleprompter.Anchor{Word: word, Position: position.Heard}
	if err := teleprompter.AppendAnchor(project, chapterID, anchor); err != nil && log != nil {
		_ = log.Report("punch_anchor_not_recorded", err.Error())
	}
}
