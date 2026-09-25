# 0234. An FX chain is applied to a passage as take FX on a split-out piece, and is named only inside FXChains

**Status:** Proposed
**Date:** 2026-09-25

## Context

The [edit and proof workspace](../prds/edit-and-proof-workspace.prd.md) lets the narrator apply one of their REAPER FX chains to a passage (EP8 B and EP9 A, adopted by owner decision D39). This is a new trust boundary: until now only the allow-listed cleanup launcher made REAPER run anything (threat row 5h, [ADR 0146](0146-cleanup-launchers-open-an-allow-listed-reaper-action-found-by-its-name-and-change-nothing-themselves.md)). The reference says `TakeFX_AddByName` accepts a chain file by full path; no REAPER MCP server we read loads a chain by path (the cross-check in [the calls](../research/reaper-api-for-planned-commands.md#cross-check-against-the-reaper-mcp-servers)), so spike SF of the workspace PRD and the verification pass (rows A7, A8) are the only evidence to come.

## Decision

In `integrations/reaper/narration_workspace.lua`:

1. `list_fx_chains(run)` walks `<resource path>/FXChains` with `EnumerateFiles` and `EnumerateSubdirectories`, clearing each listing first, and answers `.RfxChain` files as paths relative to it with forward slashes, sorted, at most 500 and four folders deep, with a flag when a limit cut the list. No name with a separator, `.` or `..` is followed.
2. `apply_fx_chain(run, itemGuid, takeGuid, sourceStart, sourceEnd, name)` accepts a chain only by such a relative name and only if the listing holds it and its file exists; the full path is built here from REAPER's resource path. It re-resolves the item and take by GUID (`ITEM_STALE` otherwise), requires the take to be the one that plays, maps the source times to the item and refuses a passage the item no longer covers. Then, in one undo block ("Narration Utils: apply FX chain <name>"), it splits at the passage's end and start (skipping an edge within 0.5 ms of the item's), adds the chain to the middle piece's active take with `TakeFX_AddByName(take, path, -1)`, and checks the take's FX count grew. It answers the middle piece's item and take GUIDs, the number of splits and of FX added. A split or load that fails still closes the undo block, and the answer tells the narrator one Undo rejoins the item.
3. A passage that crosses items is refused by the host before it is sent (one item per request).
4. Both are experimental ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)); `bridge.Actions.ListFXChains` and `ApplyFXChain` also refuse a name that is not a plain relative `.RfxChain` path before anything is sent.

## Consequences

- Proposed, for the owner: multi-item passages (refused for now), favourites (EP8 B, a Settings row lane C adds), and whether a chain should be printed to a new take afterwards (EP9 B). The verification pass settles what REAPER does with a chain loaded by path, its split crossfade, and whether one Undo rejoins the pieces.
- A chain's plug-ins run inside REAPER: a same-user process that can write the command folder can apply any chain the narrator already has in `FXChains` to an item whose GUID it knows (threat row 5h). It cannot name a file outside the folder.
