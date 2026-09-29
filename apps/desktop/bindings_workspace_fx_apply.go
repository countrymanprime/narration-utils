package main

import (
	"context"
	"errors"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// Apply FX to a passage (edit-and-proof-workspace.prd.md Phase 9, ADR 0234, ADR 0705). Two actions, both sent only
// after the narrator confirms them, both through the DAW port's FXManager role (dawport.CapFXChains, experimental,
// ADR 0230):
//
//   - WorkspaceAddTakeFX puts one installed plug-in on a passage of a take (add_take_fx): the page sends a chapter id,
//     a token range and a plug-in name from WorkspaceListFX, and the host resolves the range to one bridge.Passage from
//     the chapter's stored alignment checked against the saved project. The page never sends a GUID or a time
//     (threat model row 5f), and a passage that crosses two items is refused (one item per request).
//   - WorkspaceApplyFXChain puts one of the narrator's FX chains on the chapter's own track (apply_fx_chain). The track
//     is the one the chapter's newest check covered, never a value from the page; the Lua resolves the chain by name
//     inside FXChains (threat model row 5h).
//
// Nothing is queued (EP10 A): a REAPER that is not listening refuses, and nothing acts later.

const (
	refusedCrossesItems = "crosses_items"
	refusedBadRange     = "bad_range"
	refusedBadName      = "bad_name"
	refusedNoTrack      = "no_track"

	messageFXCrossesItems = "This passage crosses two REAPER items. Select words from one item at a time."
	messageFXBadRange     = "That selection is not in this chapter's alignment. Reload the chapter and select the words again."
	messageFXNoItem       = "These words weren't heard in the recording, so there's no audio to put an effect on. Run the check again if the chapter has changed."
	messageFXStale        = "This passage's item is no longer in the REAPER project as it was checked, so nothing was changed. Run the check again to find it where it is now."
	messageFXRecording    = "REAPER is recording, so nothing was changed. Stop recording first."
	messageFXBadPlugin    = "A passage takes one plug-in by name; FX chains go on a track."
	messageFXBadChain     = "That is not the name of an FX chain in REAPER's FXChains folder."
	messageFXNoTrack      = "This chapter has no checked track in REAPER to put a chain on. Run the check first."
	messageFXTrackStale   = "This chapter's track is no longer in the REAPER project, so nothing was changed. Run the check again."
)

// WorkspaceFXResult is what adding a plug-in or a chain did: Outcome "added" (the plug-in went on the middle piece's
// take: ItemGUID and TakeGUID name that piece, Splits how many cuts it took, 0 to 2), "applied" (the chain went on the
// track, Added FX in all) or "refused" (Reason and Message say why; nothing in REAPER changed). One Undo in REAPER
// takes the whole action back.
type WorkspaceFXResult struct {
	Outcome  string `json:"outcome"`
	Reason   string `json:"reason,omitempty"`
	Message  string `json:"message,omitempty"`
	Plugin   string `json:"plugin,omitempty"`
	ItemGUID string `json:"itemGuid,omitempty"`
	TakeGUID string `json:"takeGuid,omitempty"`
	Splits   int    `json:"splits,omitempty"`
	Chain    string `json:"chain,omitempty"`
	Track    string `json:"track,omitempty"`
	Added    int    `json:"added,omitempty"`
}

func fxRefused(reason, message string) WorkspaceFXResult {
	return WorkspaceFXResult{Outcome: "refused", Reason: reason, Message: message}
}

// fxRefusal words what the bridge or REAPER answered for an FX action: the navigation refusals, but saying nothing was
// changed and naming the FX rules.
func fxRefusal(err error) WorkspaceFXResult {
	var stale *bridge.StaleError
	var trackStale *bridge.TrackStaleError
	switch {
	case errors.As(err, &trackStale):
		return fxRefused(refusedStale, messageFXTrackStale)
	case errors.As(err, &stale):
		return fxRefused(refusedStale, messageFXStale)
	case errors.Is(err, bridge.ErrRecording):
		return fxRefused(refusedRecording, messageFXRecording)
	case errors.Is(err, bridge.ErrBadPluginName):
		return fxRefused(refusedBadName, messageFXBadPlugin)
	case errors.Is(err, bridge.ErrBadChainName):
		return fxRefused(refusedBadName, messageFXBadChain)
	case errors.Is(err, bridge.ErrNoTrack):
		return fxRefused(refusedNoTrack, messageFXNoTrack)
	case errors.Is(err, bridge.ErrNoItemIdentity):
		return fxRefused(refusedNoItem, messageFXNoItem)
	}
	navigation := refusal(err)
	return fxRefused(navigation.Reason, navigation.Message)
}

// workspaceFXNoRole is the refusal for no FX role: no DAW port, the capability off, or REAPER unreachable. It reads as
// the "REAPER is not connected" refusal every workspace action shares.
func workspaceFXNoRole() WorkspaceFXResult {
	navigation := refusal(bridge.ErrUnavailable)
	return fxRefused(navigation.Reason, navigation.Message)
}

// resolveWorkspacePassage joins the token range [first, last] of view to one bridge.Passage: the item and take GUIDs
// the stored alignment names, and the source seconds from first's start to last's end. It refuses (a *WorkspaceFXResult,
// never an error, because these are the narrator's selection and not a fault) a range outside the alignment or read
// backwards, a word nothing was heard for, a range heard on two items, and an item no longer in the saved project.
func resolveWorkspacePassage(view coverage.AlignmentView, first, last int) (bridge.Passage, *WorkspaceFXResult) {
	badRange := fxRefused(refusedBadRange, messageFXBadRange)
	if first < 0 || last < first || last >= len(view.Tokens) {
		return bridge.Passage{}, &badRange
	}
	target, err := resolveWorkspaceTarget(view, first, last)
	if err != nil {
		refusedResult := fxRefused(refusedCrossesItems, messageFXCrossesItems)
		return bridge.Passage{}, &refusedResult
	}
	if target.ItemGUID == "" || target.TakeGUID == "" {
		refusedResult := fxRefused(refusedNoItem, messageFXNoItem)
		return bridge.Passage{}, &refusedResult
	}
	if target.SourceStart == nil || target.SourceEnd == nil {
		refusedResult := fxRefused(refusedNoSourceTime, messageWorkspaceNoSourceTime)
		return bridge.Passage{}, &refusedResult
	}
	itemIndex := *view.Tokens[first].Item
	if item, ok := alignmentItemAt(view.Items, itemIndex); !ok || !item.Live {
		refusedResult := fxRefused(refusedStale, messageFXStale)
		return bridge.Passage{}, &refusedResult
	}
	return bridge.Passage{ItemGUID: target.ItemGUID, TakeGUID: target.TakeGUID, SourceStart: *target.SourceStart, SourceEnd: *target.SourceEnd}, nil
}

func addTakeFXVia(ctx context.Context, role dawport.FXManager, passage bridge.Passage, plugin string) WorkspaceFXResult {
	added, err := role.AddTakeFX(ctx, passage, plugin)
	if err != nil {
		return fxRefusal(err)
	}
	return WorkspaceFXResult{Outcome: "added", Plugin: added.Plugin, ItemGUID: added.ItemGUID, TakeGUID: added.TakeGUID, Splits: added.Splits}
}

func applyFXChainVia(ctx context.Context, role dawport.FXManager, track, chain string) WorkspaceFXResult {
	applied, err := role.ApplyFXChain(ctx, track, chain)
	if err != nil {
		return fxRefusal(err)
	}
	return WorkspaceFXResult{Outcome: "applied", Chain: applied.Chain, Track: applied.Track, Added: applied.Added}
}

// workspaceFXAnswer is WorkspaceListFX's payload: the installed plug-ins by name, as bridge.FXPlugins.
type workspaceFXAnswer struct {
	Names     []string `json:"names"`
	Truncated bool     `json:"truncated"`
}

func workspaceListFXIn(ctx context.Context, svc hostServices) (workspaceFXAnswer, error) {
	role := fxManagerFrom(svc)
	if role == nil {
		return workspaceFXAnswer{}, bridge.ErrUnavailable
	}
	plugins, err := role.ListFX(ctx)
	if err != nil {
		return workspaceFXAnswer{}, err
	}
	if plugins.Names == nil {
		plugins.Names = []string{}
	}
	return workspaceFXAnswer{Names: plugins.Names, Truncated: plugins.Truncated}, nil
}

// WorkspaceListFX lists REAPER's installed plug-ins by name (list_fx), for the passage menu. It changes nothing and is
// refused offline or before the DAW port's FX chains capability is on, as WorkspaceListFXChains is.
func (h *Host) WorkspaceListFX() (string, error) {
	return encodeBinding(workspaceListFXIn(context.Background(), h.services()))
}

// WorkspaceAddTakeFX splits the passage firstToken..lastToken of chapterID out of its item and puts one installed
// plug-in on the middle piece's take, in one undo step in REAPER (add_take_fx, ADR 0234). Refused, with nothing sent,
// for a selection that cannot be placed or a REAPER that is not listening.
func (h *Host) WorkspaceAddTakeFX(chapterID string, firstToken int, lastToken int, plugin string) (string, error) {
	svc := h.services()
	if svc.coverage == nil {
		return "", errNoProject
	}
	view, err := svc.coverage.Alignment(chapterID, coverageSettings(svc.settings).Alignment)
	if err != nil {
		return "", err
	}
	passage, refusedResult := resolveWorkspacePassage(view, firstToken, lastToken)
	if refusedResult != nil {
		return encodeBinding(*refusedResult, nil)
	}
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return encodeBinding(fxRefused(status.Connection, status.Message), nil)
	}
	role := fxManagerFrom(svc)
	if role == nil {
		return encodeBinding(workspaceFXNoRole(), nil)
	}
	return encodeBinding(addTakeFXVia(context.Background(), role, passage, plugin), nil)
}

// WorkspaceApplyFXChain puts one of the narrator's FX chains (a name WorkspaceListFXChains listed) on the track the
// chapter's newest check covered, in one undo step in REAPER (apply_fx_chain, ADR 0234). The page sends no track.
func (h *Host) WorkspaceApplyFXChain(chapterID string, chain string) (string, error) {
	svc := h.services()
	if svc.coverage == nil {
		return "", errNoProject
	}
	track := svc.coverage.ChapterTrackGUID(chapterID)
	if track == "" {
		return encodeBinding(fxRefused(refusedNoTrack, messageFXNoTrack), nil)
	}
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return encodeBinding(fxRefused(status.Connection, status.Message), nil)
	}
	role := fxManagerFrom(svc)
	if role == nil {
		return encodeBinding(workspaceFXNoRole(), nil)
	}
	return encodeBinding(applyFXChainVia(context.Background(), role, track, chain), nil)
}
