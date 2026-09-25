package bridge

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// The edit and proof workspace's REAPER actions (narration_workspace.lua; edit-and-proof-workspace PRD Phases 6, 8
// and 9): make a take active, list the narrator's FX chains, and apply one to a passage. All three are experimental
// (actions.go) until the verification pass has confirmed them in a real REAPER.

// ActiveTakeSet is the item and take REAPER now plays, and whether the request changed anything.
type ActiveTakeSet struct {
	ItemGUID, TakeGUID string
	Changed            bool
}

// FXChains are the chains under REAPER's FXChains folder, as paths relative to it with forward slashes, sorted.
// Truncated says the bridge's depth or count limit left some out.
type FXChains struct {
	Names     []string
	Truncated bool
}

// Passage is a stretch of one take's source audio, in source seconds, on the item that holds it.
type Passage struct {
	ItemGUID, TakeGUID     string
	SourceStart, SourceEnd float64
}

// FXChainApplied is the piece of the item the chain went on (a new item and take when the passage was split out),
// how many splits it took (0 to 2) and how many FX the chain added.
type FXChainApplied struct {
	Chain              string
	ItemGUID, TakeGUID string
	Splits, Added      int
}

// ErrBadChainName: the chain is not a plain .RfxChain name relative to FXChains, so nothing was sent.
var ErrBadChainName = errors.New("that is not the name of an FX chain in REAPER's FXChains folder")

// SetActiveTake makes takeGUID the active take of itemGUID in one undo step. An item or take that is gone is a
// *StaleError (reason "item" or "take"); nothing changes while REAPER records (ErrRecording).
func (a *Actions) SetActiveTake(ctx context.Context, itemGUID, takeGUID string) (ActiveTakeSet, error) {
	if itemGUID == "" || takeGUID == "" {
		return ActiveTakeSet{}, ErrNoItemIdentity
	}
	events, err := a.request(ctx, "set_active_take", []string{"ACTIVE_TAKE_SET", "ITEM_STALE"}, itemGUID, takeGUID)
	if err != nil {
		return ActiveTakeSet{}, err
	}
	event := events[len(events)-1]
	if event.Tag == "ITEM_STALE" {
		return ActiveTakeSet{}, &StaleError{GUID: event.Fields[2], Reason: event.Fields[3]}
	}
	if event.Fields[2] != normalizeGUID(itemGUID) || event.Fields[3] != normalizeGUID(takeGUID) {
		return ActiveTakeSet{}, fmt.Errorf("REAPER answered for another item or take than the one this app asked about")
	}
	return ActiveTakeSet{ItemGUID: event.Fields[2], TakeGUID: event.Fields[3], Changed: event.Fields[4] == "1"}, nil
}

// ListFXChains lists the narrator's FX chains by name. It changes nothing.
func (a *Actions) ListFXChains(ctx context.Context) (FXChains, error) {
	events, err := a.request(ctx, "list_fx_chains", []string{"FX_CHAINS_LISTED"})
	if err != nil {
		return FXChains{}, err
	}
	chains := FXChains{Names: []string{}}
	for _, event := range events {
		switch event.Tag {
		case "FX_CHAIN":
			chains.Names = append(chains.Names, event.Fields[2])
		case "FX_CHAINS_LISTED":
			chains.Truncated = event.Fields[3] == "1"
		}
	}
	return chains, nil
}

// ApplyFXChain splits the passage out of its item and adds the chain, named as ListFXChains names it, to the middle
// piece's active take, in one undo step (EP9 A). The Lua resolves the name inside FXChains itself and refuses one it
// would not list; this refuses a name that could not be one before anything is sent.
func (a *Actions) ApplyFXChain(ctx context.Context, passage Passage, chain string) (FXChainApplied, error) {
	if passage.ItemGUID == "" || passage.TakeGUID == "" {
		return FXChainApplied{}, ErrNoItemIdentity
	}
	if !finite(passage.SourceStart) || !finite(passage.SourceEnd) || passage.SourceEnd <= passage.SourceStart {
		return FXChainApplied{}, ErrNoSourceTime
	}
	if !plainChainName(chain) {
		return FXChainApplied{}, ErrBadChainName
	}
	events, err := a.request(ctx, "apply_fx_chain", []string{"FX_CHAIN_APPLIED", "ITEM_STALE"},
		passage.ItemGUID, passage.TakeGUID, formatSeconds(passage.SourceStart), formatSeconds(passage.SourceEnd), chain)
	if err != nil {
		return FXChainApplied{}, err
	}
	event := events[len(events)-1]
	if event.Tag == "ITEM_STALE" {
		return FXChainApplied{}, &StaleError{GUID: event.Fields[2], Reason: event.Fields[3]}
	}
	return FXChainApplied{
		Chain: event.Fields[2], ItemGUID: event.Fields[3], TakeGUID: event.Fields[4],
		Splits: int(numberAt(event.Fields, 5)), Added: int(numberAt(event.Fields, 6)),
	}, nil
}

// plainChainName reports whether chain is a relative .RfxChain name with forward slashes and no empty, "." or ".."
// part: the shape list_fx_chains answers.
func plainChainName(chain string) bool {
	if !strings.HasSuffix(strings.ToLower(chain), ".rfxchain") || strings.ContainsAny(chain, `\:`) {
		return false
	}
	for _, part := range strings.Split(chain, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}
