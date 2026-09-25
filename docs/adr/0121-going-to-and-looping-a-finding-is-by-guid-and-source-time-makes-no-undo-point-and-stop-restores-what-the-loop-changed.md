# 0121. Going to and looping a finding is by GUID and source time, makes no undo point, and Stop restores what the loop changed

- **Status:** Proposed
- **Date:** 2026-09-23
- **Deciders:** the owner

## Context and problem

`docs/prds/review-dashboard-and-findings-adoption.prd.md` Phase 6 asks the REAPER bridge to go to a finding, loop its
context and say whether it is listening. The owner answered Q6 on 2026-09-23: Loop sets REAPER's time selection to
the finding's context window, turns repeat on and starts playback, and an explicit Stop puts back the time selection
and repeat the narrator had. Four things were still open:

- **What a finding is found by.** The only navigation so far, `jump_to_compare_marker`, looks a row up in a Lua table
  that holds live item pointers and a project time; it dies with the launcher and would point at whatever sits at that
  time once anything moved. `findings-contract.md` says GUIDs are preferred and positions are a fallback;
  `daw-integration.md` says a stale GUID must never operate on an adjacent item.
- **Undo.** The PRD's Architecture Notes say every mutating REAPER call is wrapped in an undo block. Navigation and
  looping change item selection, the edit cursor, the time selection, the loop points, repeat and the transport, but
  no project content. An undo point per click would sit between the narrator and their last real edit: Ctrl+Z after
  listening would undo "go to finding" instead of the cut they just made.
- **What repeat actually loops.** REAPER repeats the loop points, not the time selection. The two are linked by a
  preference that is on by default in REAPER 7.80 (the Phase 6 scripted check) but can be turned off.
- **What Stop restores when the narrator has changed something meanwhile,** and what happens when the script ends
  with a loop still running.

## Decision drivers

- The owner's answer to Q6: Loop sets the time selection to the context window, turns repeat on and starts playback, and Stop puts back the time selection and repeat the narrator had.
- GUIDs are preferred and positions are a fallback (`findings-contract.md`), and a stale GUID must never operate on an adjacent item (`daw-integration.md`).
- An undo point per click would sit between the narrator and their last real edit.
- REAPER repeats the loop points, not the time selection, and the preference that links them can be turned off.

## Considered options

1. Item and take GUID with a source time, no undo point, and Stop restoring only what is still the loop's
2. Keep the status quo: `jump_to_compare_marker`'s Lua table of live item pointers and a project time
3. An undo point per navigation or loop command

## Decision outcome

**Chosen option: item and take GUID with a source time, no undo point, and Stop restoring only what is still the loop's**, because a GUID and source time follow the item when the narrator moves it and never land on a neighbour, and navigation and looping change no project content.

1. **Identity is the item GUID, optionally the take GUID, and a time inside that take's source.** `navigate_item`,
   `loop_context` (`integrations/reaper/narration_navigation.lua`) resolve the item by GUID (case and braces do not
   matter) and the take by GUID when one is given (the active take otherwise), and map the source time to the
   timeline with the take's current offset and rate, so a finding follows its item when the narrator moves it. A GUID
   that does not resolve, a take no longer on the item, and a spot the item no longer covers are each answered
   `FINDING_STALE|run|guid|item|take|range` and change nothing. No project time is ever sent or used as a fallback:
   the host refuses a finding without an item GUID (`bridge.ErrNoItemIdentity`) before anything is sent.
   Transcript Compare now records each row's item, take and track GUIDs when the comparison is prepared (the audio the
   row describes) and appends them to `COMPARE_MARKER` after `srcpos`, never reordering it; the findings adapter puts
   them in `source`.
2. **Navigation and looping make no undo point.** They change selection and transport state only. Items are
   deselected one by one with `SetMediaItemSelected` (a scripted run saw `SelectAllMediaItems` leave an "Unselect all
   items" undo point once). The scripted REAPER 7.80 check found no undo point and no dirty project after any of the
   four commands. The rule "every command that changes the project is one undo block" is unchanged: these do not
   change the project.
3. **Loop sets both the time selection and the loop points** to the window, turns repeat on, moves the edit cursor to
   the window start and presses Play (stopping first if REAPER was playing), so it loops whether or not the two are
   linked. The window is the finding's source range padded by `bridge.ContextPaddingSeconds` (2 s) either side and
   kept inside the item by REAPER.
4. **Stop puts back only what is still the loop's.** The first `loop_context` remembers the narrator's time selection,
   loop points and repeat; a second one re-targets but keeps that memory. `stop_loop` stops the transport only if a
   loop of ours is held and REAPER is not recording, then puts back each of the three that still has the value the
   loop set, keeps any the narrator changed while listening, and answers
   `LOOP_STOPPED|run|restored|kept`. With no loop held it changes nothing and answers `0|0`. When the launcher script
   ends (terminated, or REAPER quitting) with a loop held, a `reaper.atexit` handler puts the same state back.
5. **Nothing moves while REAPER is recording.** `navigate_item` and `loop_context` refuse with an `ERROR` instead of
   selecting, seeking or restarting the transport.
6. **`ping` answers `PONG|run|version|looping|playing`.** An older script answers "Unsupported workspace command",
   which the host reports as `bridge.ErrScriptOutdated`. The periodic `PROJECT_STATUS` heartbeat (ADR 0092) stays the
   reachability signal; `ping` proves the script can execute these commands.
7. **The host side is `bridge.Navigator`** (`apps/desktop/internal/bridge/navigation.go`): one command, one awaited
   answer (routed by run ID, 3 s timeout, `ErrNoAnswer`, `ErrUnavailable` without a bridge), typed results, and a
   `StaleError` that `errors.Is(ErrStale)`. It is not wired to a binding yet (Phase 7).

### Consequences

- **Good:** A stale finding is reported in plain words and never lands on a neighbour; the mutation checks in
  `integrations/reaper/tests/mutations.json` break each of those guards and the harness catches every one.
- **Bad:** Because the loop state lives in the running script, a launcher restart forgets it: Stop then answers `0|0` and the
  narrator's time selection stays as the loop left it. The narrator can also stop REAPER themselves; the loop state is
  kept for Stop, and `ping` reports `looping` with `playing` 0.
- **Neutral:** Hearing the loop, REAPER's own Stop button and `ping` after a REAPER restart need audio hardware or the owner; they
  are in the manual checklist of `docs/architecture/reaper-navigation.md`. If Stop's restore turns out unreliable in
  real use, the PRD's fallback is the in-app raw-source loop.
- **Neutral:** `jump_to_compare_marker` is unchanged and still uses `SelectAllMediaItems` and the run table; Phase 7 moves the
  Review page to `navigate_item`.

### Confirmation

The mutation checks in `integrations/reaper/tests/mutations.json` break each stale-finding guard and the harness catches every one; a scripted REAPER 7.80 check found no undo point and no dirty project after any of the four commands; hearing the loop, REAPER's own Stop button and `ping` after a REAPER restart are in the manual checklist of `docs/architecture/reaper-navigation.md`.

## Pros and cons of the options

### Keep the status quo

- Bad, because the table dies with the launcher and would point at whatever sits at that time once anything moved.

### An undo point per navigation or loop command

- Bad, because Ctrl+Z after listening would undo "go to finding" instead of the cut the narrator just made.
