package main

import (
	"context"
	"errors"

	editingpkg "github.com/countrymanprime/narration-utils/shell/internal/editing"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// editingPolicy reads the Editing settings section (Q2, Q3): every value
// unset until the narrator sets one (no builtinDefaults entry to fall back
// to), so store.Effective's own fallback ("") is exactly PolicyFromSettings's
// own "not checked" convention.
func editingPolicy(store *settings.Store) editingpkg.Policy {
	effective := func(key string) string {
		value, _ := store.Effective("Editing", key, "")
		return value
	}
	policy, err := editingpkg.PolicyFromSettings(effective("max_gap_seconds"), effective("head_max_seconds"), effective("tail_max_seconds"))
	if err != nil {
		// A value that fails to parse (should be impossible: saveSettings
		// already validates every number through numberSpecs before it is
		// ever written) is read as unset rather than panicking or blocking
		// the scan - the same fail-safe-to-unknown spirit as the rest of
		// this PRD.
		return editingpkg.Policy{}
	}
	return policy
}

// errEditingNoProject is the answer of every editing binding before a
// project is open (mirrors bindings_stages.go's errStagesNoProject).
var errEditingNoProject = errors.New("open a project before checking editing")

// The editing-readiness check bindings (docs/prds/editing-readiness-analysis.prd.md
// Phase 5). A check runs only when the narrator asks (Q9): nothing here
// starts one on its own. Unlike CoverageStart/CoverageState, these bindings
// are plain poll-style calls with no live event and no OS-notification job
// tracking yet - Phase 7's panel (out of this pass's scope) is expected to
// wire that up the way bindings_coverage.go does for coverage:state, once a
// real apps/ui build (with the wails3 CLI available to regenerate
// apps/ui/wailsjs) can also add the matching jobKindEditing to
// apps/ui/src/api/contracts/system.ts. Calling these four methods from Go
// works today (Wails binds every exported *Host method by reflection); the
// JS-callable wrapper for them does not exist until
// `pnpm --dir apps/desktop bindings` is run somewhere the wails3 CLI is
// installed - it is not in this sandbox (command -v wails3 fails here).

// editingIdle is the state reported when no project (so no editing service)
// is open.
var editingIdle = editingpkg.State{Phase: editingpkg.PhaseIdle, Message: "Open a project, save it in REAPER, then check a chapter's editing."}

// EditingStart starts an editing-readiness scan of one chapter: played-range
// empty-space (and, cached alongside it, click/breath candidates - always
// unknown until Phase 4 validates them). It answers {status: "started",
// state} or {status: "refused", reason, message} when the chapter cannot be
// resolved to exactly one confirmed track and its items in the saved
// project (nothing was run or written); any other error is a rejected
// promise.
func (h *Host) EditingStart(documentID, chapterID, chapterTitle string) (string, error) {
	service := h.services().editing
	if service == nil {
		return "", errEditingNoProject
	}
	state, err := service.Start(context.Background(), editingpkg.Request{DocumentID: documentID, ChapterID: chapterID, ChapterTitle: chapterTitle})
	if reason, refused := editingpkg.ReasonOf(err); refused {
		return encodeBinding(map[string]any{"status": "refused", "reason": string(reason), "message": err.Error()}, nil)
	}
	if err != nil {
		return "", err
	}
	return encodeBinding(map[string]any{"status": "started", "state": state}, nil)
}

// EditingState is the current check, or the last one that ended.
func (h *Host) EditingState() (string, error) {
	if service := h.services().editing; service != nil {
		return encodeBinding(service.State(), nil)
	}
	return encodeBinding(editingIdle, nil)
}

// EditingCancel asks a running check to stop after its current item; the
// items it already finished stay cached and ledgered. With nothing running
// it does nothing.
func (h *Host) EditingCancel() (string, error) {
	if service := h.services().editing; service != nil {
		service.Cancel()
	}
	return encodeBinding(nil, nil)
}

// EditingCandidates lists the chapter's current empty-space findings
// (silence_cleanup, evidence.class "silence"): what a scan found, in the
// review-dashboard findings shape, so the narrator can hear and act on each
// one (Phase 7's own scope; this binding only reads what a scan already
// persisted).
func (h *Host) EditingCandidates(chapterID string) (string, error) {
	service := h.services().editing
	if service == nil {
		return encodeBinding([]any{}, nil)
	}
	found, err := service.Candidates(chapterID)
	if err != nil {
		return "", err
	}
	return encodeBinding(found, nil)
}
