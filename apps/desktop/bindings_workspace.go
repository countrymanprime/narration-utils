package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// The chapter workspace's REAPER navigation (edit-and-proof-workspace.prd.md Phase 3): Go to and Loop for a chapter
// token, over the same bridge.Navigator, the same navigate_item and loop_context commands, and the same connection
// status and refusal order as the Review page's FindingsGoTo/FindingsLoop (bindings_navigation.go, ADR 0121;
// docs/architecture/reaper-navigation.md, "From the workspace"). No new Lua command: what is new is resolving a
// token, in the host, to the item GUID, take GUID and source time bridge.Target needs, from the chapter's stored
// alignment (WorkspaceAlignment, ADR 0242) checked against the saved project - the page sends only a chapter id and
// token indices, never a GUID or a time, exactly as the Review page sends only a finding id (threat model row 5f).

// workspaceRefusal turns an error from resolving or sending a workspace target into a refused FindingNavigation, in
// the workspace's own words (a word, not "this finding" - bridge.StaleError.Error() is worded for the Review page, so
// a stale item or take is reworded here rather than by editing that shared type, docs/architecture/reaper-navigation.md
// "From the workspace"). Every other error (no bridge, a stale heartbeat, REAPER recording, an old script, anything
// else) is REAPER's own answer, worded exactly as refusal() already words it for the Review page - none of those
// messages name a finding.
func workspaceRefusal(err error) FindingNavigation {
	var stale *bridge.StaleError
	switch {
	case errors.As(err, &stale):
		return refused(refusedStale, capitalized(workspaceStaleMessage(stale.Reason))+messageStaleSuffix)
	case errors.Is(err, bridge.ErrNoItemIdentity):
		return refused(refusedNoItem, messageWorkspaceNoItem)
	case errors.Is(err, bridge.ErrNoSourceTime):
		return refused(refusedNoSourceTime, messageWorkspaceNoSourceTime)
	}
	return refusal(err)
}

const (
	messageWorkspaceNoItem       = "This word wasn't heard in the recording, so there's nothing to go to. Run the check again if the chapter has changed."
	messageWorkspaceNoSourceTime = "This word has no time in its audio to loop. Go to it instead."
)

// workspaceStaleMessage is bridge.StaleError's reason in the workspace's words, mirroring what StaleError.Error()
// says for a finding: reason is "item", "take" or "range" (bridge.StaleError, reaper-navigation.md).
func workspaceStaleMessage(reason string) string {
	switch reason {
	case "item":
		return "this word's item is no longer in the REAPER project"
	case "take":
		return "this word's item no longer has the take it was heard on"
	case "range":
		return "this word's item no longer covers where it was heard (it was trimmed or moved within)"
	}
	return bridge.ErrStale.Error()
}

// WorkspaceGoTo selects tokenIndex's item in REAPER and puts the edit cursor on the spot it was heard, exactly as
// FindingsGoTo does for a finding: navigate_item, sent only once the token resolves to an item REAPER can be asked
// about and REAPER is listening.
func (h *Host) WorkspaceGoTo(chapterID string, tokenIndex int) (string, error) {
	return h.navigateWorkspace(chapterID, tokenIndex, tokenIndex, false, goTo)
}

// WorkspaceLoop loops the chapter passage from firstToken to lastToken (inclusive, both heard on the same item) in
// REAPER: the time selection and loop points around it, repeat on, and Play, exactly as FindingsLoop does.
// FindingsStopLoop stops it - the workspace holds no loop state of its own, sharing the one app loop
// findingNavigation already tracks.
func (h *Host) WorkspaceLoop(chapterID string, firstToken int, lastToken int) (string, error) {
	id := fmt.Sprintf("workspace:%s:%d-%d", chapterID, firstToken, lastToken)
	return h.navigateWorkspace(chapterID, firstToken, lastToken, true, loopFor(id))
}

// navigateWorkspace resolves [firstToken, lastToken] of chapterID's stored alignment to a bridge.Target and sends it
// exactly as navigateFinding does for a finding: refused before anything is sent for a token that cannot be placed
// (no_item), for a loop with no source time (no_source_time), or a REAPER that is not listening; nothing in REAPER
// changes for a refusal. A token index outside the alignment, or a passage whose tokens were heard on two different
// items, is the caller's error, not a refusal: the page already has the tokens it sends, from WorkspaceAlignment.
func (h *Host) navigateWorkspace(chapterID string, firstToken, lastToken int, needsTime bool,
	send func(*findingNavigation, bridge.Target) FindingNavigation) (string, error) {
	svc := h.services()
	if svc.coverage == nil {
		return "", errNoProject
	}
	view, err := svc.coverage.Alignment(chapterID, coverageSettings(svc.settings).Alignment)
	if err != nil {
		return "", err
	}
	target, err := resolveWorkspaceTarget(view, firstToken, lastToken)
	if err != nil {
		return "", err
	}
	if target.ItemGUID == "" {
		return encodeBinding(workspaceRefusal(bridge.ErrNoItemIdentity), nil)
	}
	if needsTime && target.SourceEnd == nil {
		return encodeBinding(workspaceRefusal(bridge.ErrNoSourceTime), nil)
	}
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return encodeBinding(refused(status.Connection, status.Message), nil)
	}
	return encodeBinding(send(svc.navigation, target), nil)
}

// resolveWorkspaceTarget reads firstToken and lastToken out of view (WorkspaceAlignment's own shape) and joins them
// to the item the view already resolved against the saved project: the target's ItemGUID and TakeGUID come from that
// item, SourceStart from firstToken's start and SourceEnd from lastToken's end, both in the item's source seconds
// (the same coordinate space bridge.Target already uses for a finding's TimeRange). A token nothing was heard for
// (Item == nil) answers a target with no ItemGUID, which navigateWorkspace turns into the no_item refusal, exactly as
// an item-less finding does.
func resolveWorkspaceTarget(view coverage.AlignmentView, firstToken, lastToken int) (bridge.Target, error) {
	first, err := alignedToken(view, firstToken)
	if err != nil {
		return bridge.Target{}, err
	}
	last, err := alignedToken(view, lastToken)
	if err != nil {
		return bridge.Target{}, err
	}
	if first.Item == nil || last.Item == nil {
		return bridge.Target{}, nil
	}
	if *first.Item != *last.Item {
		return bridge.Target{}, fmt.Errorf("this passage crosses two REAPER items; loop one item's words at a time")
	}
	item, ok := alignmentItemAt(view.Items, *first.Item)
	if !ok || item.ItemGUID == "" {
		return bridge.Target{}, nil
	}
	target := bridge.Target{ItemGUID: item.ItemGUID, TakeGUID: item.TakeGUID}
	if first.Start != nil {
		target.SourceStart = first.Start
	}
	if last.End != nil {
		target.SourceEnd = last.End
	}
	return target, nil
}

// alignedToken is view.Tokens[index], or an error naming why it cannot be read: an index outside the chapter's
// stored alignment means the caller's copy of it is out of date.
func alignedToken(view coverage.AlignmentView, index int) (coverage.TokenLine, error) {
	if index < 0 || index >= len(view.Tokens) {
		return coverage.TokenLine{}, fmt.Errorf("token %d is not in this chapter's alignment; reload the workspace", index)
	}
	return view.Tokens[index], nil
}

// alignmentItemAt is the view's AlignmentItem for a token's item index (WorkspaceAlignment joins every analyzed
// item, so the index a heard token names is always one of them, unless the stored data disagrees with itself).
func alignmentItemAt(items []coverage.AlignmentItem, index int) (coverage.AlignmentItem, bool) {
	for _, item := range items {
		if item.Index == index {
			return item, true
		}
	}
	return coverage.AlignmentItem{}, false
}

// FX discovery (edit-and-proof-workspace.prd.md Phase 8, EP8 B, ADR 0234): a read-only list of the narrator's own
// FX chains, over the DAW port's FXManager role (list_fx_chains; internal/dawport/roles.go), so it is gated and
// refused exactly as ApplyFXChain will be once Phase 9 sends it (dawport.CapFXChains, ADR 0230, ADR 0304). The
// narrator's favourites are a Settings row (DAW.fx_favourites), not part of this read: the effects menu Phase 9
// builds combines the two client-side, since a favourite is just a name this listing (or a future FX plug-in
// listing) already lists.

// fxManagerFrom is svc's FX chains role, or nil exactly as silenceTrimmerFrom is nil (bindings_cleanup.go): no DAW
// port resolver, no adapter, the capability toggled off, or REAPER unreachable right now.
func fxManagerFrom(svc hostServices) dawport.FXManager {
	if svc.dawPortResolver == nil {
		return nil
	}
	role, err := dawport.Role[dawport.FXManager](svc.dawPortResolver, dawport.CapFXChains)
	if err != nil {
		return nil
	}
	return role
}

// workspaceFXChainsAnswer is WorkspaceListFXChains' payload: bridge.FXChains as the UI receives it.
type workspaceFXChainsAnswer struct {
	Names     []string `json:"names"`
	Truncated bool     `json:"truncated"`
}

func workspaceListFXChainsIn(ctx context.Context, svc hostServices) (workspaceFXChainsAnswer, error) {
	role := fxManagerFrom(svc)
	if role == nil {
		return workspaceFXChainsAnswer{}, bridge.ErrUnavailable
	}
	chains, err := role.ListFXChains(ctx)
	if err != nil {
		return workspaceFXChainsAnswer{}, err
	}
	if chains.Names == nil {
		chains.Names = []string{}
	}
	return workspaceFXChainsAnswer{Names: chains.Names, Truncated: chains.Truncated}, nil
}

// WorkspaceListFXChains lists the narrator's FX chains from REAPER's FXChains folder (list_fx_chains), by relative
// name, sorted, capped. It changes nothing and is refused (bridge.ErrUnavailable) offline or before the DAW port's
// FX chains capability is on, exactly as list_fx_chains itself already is (ADR 0230, ADR 0234).
func (h *Host) WorkspaceListFXChains() (string, error) {
	return encodeBinding(workspaceListFXChainsIn(context.Background(), h.services()))
}
