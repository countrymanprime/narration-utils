# 0248. Pause is a pause and resume pair on the control file, and a paused session stays running

**Status:** Accepted (amends ADR-0104)
**Date:** 2026-09-25

## Context

The Read Aloud control bar ([read-aloud-control-bar PRD](../prds/read-aloud-control-bar.prd.md) Phase 5) gives the narrator Pause for a drink, a page turn or a cough without ending the session. The owner approved Q3 A (D39): Pause keeps the session alive but ignores audio, the tracker holds its word and does not report `waiting`, the status says "Paused", Stop ends the session and keeps its flags, and there is no separate mute. The alternative, Pause as Stop plus a resume through `startWord`, would end a session, keep its flags and reload the model (a few seconds) on every pause. [ADR 0104](0104-seek-reaches-a-running-teleprompter-session-through-a-tailed-control-file.md) already gives the host a way to reach a running sidecar: a control file it tails once per chunk, with one command, `seek`.

## Decision

- **Two more commands on the same channel.** `{"cmd": "pause"}` and `{"cmd": "resume"}` join `seek` in the control file (`control_channel.pause_state`). No new file, flag or process.
- **While paused, the sidecar drops what it hears.** Chunks are still read from the device (it stays open, so a resume is instant) and their level is still reported ([ADR 0247](0247-the-input-level-comes-from-the-sidecars-own-capture-and-a-model-free-meter-child-runs-before-start.md)), so the meter shows the microphone is live. They never reach the engine (`gated` in `live_asr.py`). The stop file and seek still work while paused.
- **The tracker's clock stands still.** `StreamClock` stops at the pause and runs on after the resume without the paused time, so the tracker's 1.5 s pause timeout never counts a pause the narrator asked for, and no `waiting` is reported for it.
- **The state is a flag, not a phase.** The host's snapshot keeps `phase: "running"` and gains `paused: true | false` (always present, false when idle, starting or ended), with the message "Paused." (`Service.Pause`, binding `TeleprompterPause(paused)`, host API 55). A flag keeps every "is a session running" check (`Busy`, the meter's refusal, detach from REAPER, Seek) unchanged, where a new phase would have to be added to each. A UI reading an older host's snapshot defaults `paused` to false.
- **Only a running session pauses.** Pausing a paused session, or resuming a listening one, writes nothing.
- **Auto-stop is not armed while paused.** A pause cancels a pending auto-stop ([ADR 0106](0106-a-teleprompter-session-stops-itself-five-seconds-after-the-tracker-reports-done.md)), and a `done` position that arrives while paused does not arm one. A resume arms it again if the last position is still `done`.
- **Flags are unchanged** ([ADR 0117](0117-live-flags-are-kept-as-suspected-findings-merged-per-chapter-when-a-session-ends.md)): they are kept when the session ends (Stop, auto-stop, exit), never on a pause.

## Consequences

- A pause costs nothing to resume from: no model load, no new session, no second set of flags.
- A segment that was open when the narrator paused stays open until they speak again. Its words so far are confirmed when it closes, as before.
- The recorded REAPER take is not paused by this. What Pause does to a recording the app started is Phase 7's (Q8, owner answer: a pause is a take boundary), built on this command.
- Pause in the bar, its tooltip and the Space shortcut are the UI half, built on this binding by the UI lane.
