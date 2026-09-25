# 0233. The app may make a take active, by GUID, in one undo step

**Status:** Accepted
**Date:** 2026-09-25

## Context

Take review decided that the app never sets the active take and left an explicit, confirmed "Make active" for later ([take review](../utilities/take-review.md), Decisions). The [edit and proof workspace](../prds/edit-and-proof-workspace.prd.md) asks for it (EP7, recommendation A, adopted by owner decision D39): "Use this take" makes the chosen take the item's active take in REAPER.

## Decision

A new bridge command, `set_active_take(run, itemGuid, takeGuid)` in `integrations/reaper/narration_workspace.lua`, makes the named take active with `SetActiveTake`, followed by `UpdateItemInProject`, inside one undo block ("Narration Utils: use take"). The item and take are found by GUID; an item that is gone, or a take no longer on it, answers `ITEM_STALE` and changes nothing; nothing changes while REAPER records; a take that is already active is answered `changed` 0 with no undo point. It is the only bridge command that calls `SetActiveTake`; `create_take` still never does. The Go client is `bridge.Actions.SetActiveTake`, experimental ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)) until the verification pass (row A6).

## Consequences

- Take review's "never sets the active take" now holds for take review only: the workspace's confirmed "Use this take" is the one way the app changes what an item plays.
- One Undo in REAPER restores the previous take, per the reference; the verification pass confirms it.
