# 0234. FX chains go on tracks, and a passage of a take gets one plug-in at a time

**Status:** Accepted (the owner, 2026-09-25)
**Date:** 2026-09-25

## Context

The [edit and proof workspace](../prds/edit-and-proof-workspace.prd.md) lets the narrator add effects from the app (EP8 and EP9). The first design (this ADR while Proposed) applied a whole `.RfxChain` as take FX to a split-out passage. Reviewing it, the owner decided: **FX chains are applied only to tracks, including the master track; takes and items get single FX. They can add several, one at a time, but never a chain.**

REAPER can tell the two apart. A chain is a `.RfxChain` file under `<resource path>/FXChains`; a single plug-in is an entry of `EnumInstalledFX`, which also lists REAPER's FX container (ident `Container`, the thing a chain lives in) and its video processor, which are not single plug-ins ([the calls](../research/reaper-api-for-planned-commands.md)). No REAPER MCP server we read loads a chain by path, so the verification pass (rows A7, A8) is the first evidence of what REAPER does with one.

## Decision

In `integrations/reaper/narration_workspace.lua`:

1. **Chains, on tracks.** `list_fx_chains(run)` lists `.RfxChain` files under `FXChains` by relative name (forward slashes, sorted, at most 500, four folders deep). `apply_fx_chain(run, track, name)` takes a track GUID, or `master` (or the master track's GUID) for the master track, and a chain name the listing holds; the full path is built on the Lua side, never taken from the command. It adds the chain with `TrackFX_AddByName(track, path, false, -1)` in one undo block ("Narration Utils: apply FX chain <name> to <track>"), checks the track's FX count grew, and answers `FX_CHAIN_APPLIED|run|name|track|added`. It never touches an item or take, refuses while REAPER records, and a track that is gone answers `TRACK_STALE`.
2. **Single plug-ins, on a passage.** `list_fx(run)` lists `EnumInstalledFX` names, sorted, at most 2000, without the FX container or the video processor. `add_take_fx(run, item, take, sourceStart, sourceEnd, name)` accepts only a name that listing holds, so never a chain file, a path or a container. It re-resolves the item and take by GUID (`ITEM_STALE` otherwise), requires the take to be the one that plays and the passage to lie inside the item, then in one undo block ("Narration Utils: add take FX <name>") splits at the passage's end and start (skipping an edge within 0.5 ms of the item's), adds the plug-in to the middle piece's take with `TakeFX_AddByName(take, name, -1)`, and checks exactly one FX was added. It answers `TAKE_FX_ADDED|run|name|itemGuid|takeGuid|splits`. Sending it again for the same piece adds another plug-in without splitting again. A failed split or add still closes the undo block, and the answer says one Undo rejoins the item.
3. A passage that crosses items is refused by the host (one item per request).
4. All four are experimental ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)). `bridge.Actions.ApplyFXChain(track, chain)` (with `bridge.MasterTrack`), `ListFXChains`, `ListFX` and `AddTakeFX(passage, plugin)` also refuse a chain name that is not a plain relative `.RfxChain` path, and a plug-in name that is empty or a chain file, before anything is sent.

## Consequences

- A chain changes a whole track's sound (or the whole mix, on the master track), which is where the narrator's multi-plug-in chains belong; a passage gets a targeted plug-in, which is visible and removable in its own take FX window.
- The workspace's effects menu needs two lists: chains for a track, plug-ins for a selection. Favourites (EP8 B) apply to both and are a Settings row lane C adds.
- A chain's and a plug-in's code runs inside REAPER: a same-user process that can write the command folder can add any chain the narrator keeps in `FXChains` to a track, or any installed plug-in to an item whose GUID it knows (threat row 5h). It cannot name a file outside `FXChains`.
- Open for the verification pass: what REAPER does with a chain loaded by path onto a track and the master track, its split crossfade, and whether one Undo rejoins the pieces.
