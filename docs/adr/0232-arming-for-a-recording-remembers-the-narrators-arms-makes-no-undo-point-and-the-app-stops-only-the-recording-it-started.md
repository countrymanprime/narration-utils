# 0232. Arming for a recording remembers the narrator's arms, makes no undo point, and the app stops only the recording it started

**Status:** Proposed
**Date:** 2026-09-25

## Context

Owner decision D28 ([implementation plan](../prds/implementation-plan.md), section 6) answers the Read Aloud control bar's Q7 to Q9 ([PRD](../prds/read-aloud-control-bar.prd.md), Phase 7): arming the chapter's track disarms every other track and remembers the previous arms, restoring them when a recording the app started stops; the app only stops recordings it started. How REAPER treats a track arm, what starts a recording, and when `GetPlayState` reports it are not in the reference ([the calls](../research/reaper-api-for-planned-commands.md)); the two REAPER MCP servers that are file-polling Lua bridges like ours (TwelveTake-Studios/reaper-mcp and danishaft/reaper-mcp, both MIT; read for approach only) wrap an arm in an undo block and check nothing after pressing record.

## Decision

In `integrations/reaper/narration_transport.lua`:

1. `arm_only(run, trackGuid)` sets `I_RECARM` 1 on the named track and 0 on every other armed one, and **opens no undo block**: the PRD's evidence is that a track arm is not in REAPER's undo history, so an undo block would add an empty "Narration Utils" point between the narrator and their last edit. The first `arm_only` remembers every track's arm; a later one keeps that memory and only changes the target. It is refused while REAPER records.
2. The remembered arms are put back when a recording the app started stops, whether `record_stop` stops it or the narrator stops it in REAPER (a defer watch notices and answers `RECORD_ENDED` on the start's run). Only an arm still as `arm_only` left it goes back; an arm the narrator changed during the take is theirs and is kept; a track removed or added since is left alone. The memory is used once.
3. `record_start(run, trackGuid)` records only when REAPER is stopped (not playing, paused or recording) and exactly one track is armed, the named one. It presses `CSurf_OnRecord` once (a toggle, so only after seeing REAPER stopped; never `Main_OnCommand`, which stays inside the allow-listed cleanup launcher, threat row 5h) and answers `RECORD_STARTED` once `GetPlayState` reports recording, waiting up to 30 defer cycles; otherwise `ERROR` "REAPER did not start recording.", and the toggle is never pressed again.
4. `record_stop(run)` stops only the recording this bridge started (`OnStopButton`, which leaves REAPER's own "save recorded media" prompt to the narrator); anything else answers `RECORD_NOT_OURS` and nothing is stopped. A stop while REAPER is still starting cancels the start, and a start that arrives late is stopped.
5. All three are experimental ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)); `bridge.Actions` exposes `ArmOnly`, `RecordStart`, `RecordStop` and `OnRecordEnded`, with a sentinel error per refusal.

## Consequences

- Proposed, for the owner and the verification pass (rows A4, A5 and B2 to B6): that an arm is not undoable (if it is, `arm_only` should become one undo block, as the MCP bridges do); that `CSurf_OnRecord` honours the project's record mode; how many cycles REAPER takes to report recording; what the "save recorded media" prompt does to the defer loop while it is open.
- A narrator who arms by hand between `arm_only` and the recording keeps that arm (it is theirs); the rule never overwrites a change it did not make.
- Nothing arms, records or stops without a host request, and the host sends none of these until the experimental switch is on and a binding (lane C's control bar) asks.
