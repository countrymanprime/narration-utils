package main

import (
	"context"
	"errors"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// Punch and roll (teleprompter-manuscript-integration.prd.md Phase 12, booth-actions-enablement PRD Phase 3, ADR
// 0246): "Punch from here" on a flag resolves the flagged word's project time from the punch anchors the poll loop
// has recorded (teleprompterpunchpoll.go), then moves REAPER's edit cursor there minus the pre-roll setting, through
// dawport.Puncher (CapPunch), never bridge.Actions directly. Reading REAPER's own pre-roll preference first is the
// owner-gated spike this phase does not run; the setting is the only source until it does.

// defaultPunchPreRoll is what a settings value that will not parse falls back to (the same 3 s the setting's own
// repo default and range describe, apps/desktop/settings_number.go).
const defaultPunchPreRoll = 3.0

// ErrNoPunchAnchor is TeleprompterPunchPreview/TeleprompterPunch's refusal when the anchors recorded so far cannot
// place word at all (fewer than two anchors, teleprompter.ResolveWordTime): nothing was moved.
var ErrNoPunchAnchor = errors.New("there's no punch anchor near this word yet: read a little further, then try again")

// errNoDawConnection is TeleprompterPunch's refusal with no bridge at all (a standalone launch): the same wording the
// DAW port's own resolver gives a capability with no adapter (dawport.Resolver.message's ReasonStandalone case).
var errNoDawConnection = errors.New("no DAW is connected to this app. Open this app from your DAW to use it.")

// TeleprompterPunchResult is TeleprompterPunchPreview's or TeleprompterPunch's answer: Outcome "resolved" (a preview:
// nothing moved) or "punched" (Cursor is where REAPER's edit cursor landed), each with ResolvedTime, Source
// ("anchor" or "alignment", teleprompter.SourceAnchor/SourceAlignment) and PreRoll so the UI can show them before and
// after moving; or "refused" (Message says why, nothing moved).
type TeleprompterPunchResult struct {
	Outcome      string   `json:"outcome"`
	Cursor       *float64 `json:"cursor,omitempty"`
	ResolvedTime *float64 `json:"resolvedTime,omitempty"`
	Source       string   `json:"source,omitempty"`
	PreRoll      *float64 `json:"preRoll,omitempty"`
	Message      string   `json:"message,omitempty"`
}

func refusedPunch(err error) TeleprompterPunchResult {
	return TeleprompterPunchResult{Outcome: "refused", Message: err.Error()}
}

// punchPreRoll reads Teleprompter.punch_preroll_seconds, falling back to defaultPunchPreRoll when it is unset or, on
// a corrupt settings file, unparseable - never a hard error, since a bad pre-roll should not block "Punch from here".
func punchPreRoll(svc hostServices) float64 {
	if svc.settings == nil {
		return defaultPunchPreRoll
	}
	value, _ := svc.settings.Effective("Teleprompter", "punch_preroll_seconds", "")
	preRoll, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return defaultPunchPreRoll
	}
	return preRoll
}

// resolvePunch is what preview and punch share: word's project time and source from the chapter's anchors, and the
// pre-roll to use. It never touches REAPER.
func resolvePunch(svc hostServices, chapterID string, word int) (position float64, source string, preRoll float64, err error) {
	project := svc.config.projectFolder
	if project == "" {
		return 0, "", 0, errNoProject
	}
	anchors, err := teleprompter.LoadAnchors(project, chapterID)
	if err != nil {
		return 0, "", 0, err
	}
	position, source, ok := teleprompter.ResolveWordTime(anchors, word)
	if !ok {
		return 0, "", 0, ErrNoPunchAnchor
	}
	return position, source, punchPreRoll(svc), nil
}

// TeleprompterPunchPreview resolves word's punch time and pre-roll without moving anything in REAPER: what the
// narrator sees before confirming "Punch from here" (Phase 12's "UI showing resolved time, its source... and pre-roll
// before moving").
func (h *Host) TeleprompterPunchPreview(chapterID string, word int) (string, error) {
	svc := h.services()
	position, source, preRoll, err := resolvePunch(svc, chapterID, word)
	if err != nil {
		return encodeBinding(refusedPunch(err), nil)
	}
	return encodeBinding(TeleprompterPunchResult{Outcome: "resolved", ResolvedTime: &position, Source: source, PreRoll: &preRoll}, nil)
}

// TeleprompterPunch resolves word's punch time again (the narrator may have kept reading since the preview) and
// moves REAPER's edit cursor there minus the pre-roll, through the DAW port's Puncher role. On a successful punch,
// every anchor at or after word is dropped (the narrator is about to re-record from here, so an anchor from the take
// being replaced would misplace the next punch, teleprompter.DropAnchorsFrom); that failing is logged, never
// surfaced, since the punch itself already succeeded.
func (h *Host) TeleprompterPunch(chapterID string, word int) (string, error) {
	svc := h.services()
	position, source, preRoll, err := resolvePunch(svc, chapterID, word)
	if err != nil {
		return encodeBinding(refusedPunch(err), nil)
	}
	if svc.dawPortResolver == nil {
		return encodeBinding(refusedPunch(errNoDawConnection), nil)
	}
	puncher, err := dawport.Role[dawport.Puncher](svc.dawPortResolver, dawport.CapPunch)
	if err != nil {
		return encodeBinding(refusedPunch(err), nil)
	}
	cursor, err := puncher.PunchTo(context.Background(), position, preRoll)
	if err != nil {
		return encodeBinding(refusedPunch(err), nil)
	}
	if err := teleprompter.DropAnchorsFrom(svc.config.projectFolder, chapterID, word); err != nil && h.log != nil {
		_ = h.log.Report("punch_anchor_not_recorded", err.Error())
	}
	return encodeBinding(TeleprompterPunchResult{Outcome: "punched", Cursor: &cursor, ResolvedTime: &position, Source: source, PreRoll: &preRoll}, nil)
}
