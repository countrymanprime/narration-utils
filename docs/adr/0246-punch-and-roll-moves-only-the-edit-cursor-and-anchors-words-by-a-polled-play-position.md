# 0246. Punch and roll moves only the edit cursor, and anchors words by a polled play position

**Status:** Proposed
**Date:** 2026-09-25

## Context

The teleprompter PRD's Phase 12 ("Punch from here") needs two things from REAPER. First, the project time of a word the narrator read, taken from live anchors (the owner chose live anchors first on 2026-09-23, with offline alignment as the fallback). Second, a command that puts the edit cursor at that word minus a pre-roll. REAPER has two play positions: `GetPlayPosition`, what the narrator hears, and `GetPlayPosition2`, what REAPER is processing, ahead by the output latency. Which of the two anchors a word is spike S4's question, and S4 needs the owner and audio hardware. Moving the edit cursor changes no project data, and `jump_to_compare_marker` already moves it without an undo block (the PRD's question on the undo block, answered (a)).

## Decision

- **`play_position`** (`narration_punch.lua`) is read-only. It answers the play state, **both** play positions and the edit cursor, so the host can anchor with whichever S4 picks without a new script. The host polls it during a live reading; each call is one file-bridge round trip (about 50-100 ms), so the poll rate is bounded by the host and the anchor's accuracy is stated, not assumed.
- **`punch_to(time, preroll)`** moves only the edit cursor, to `max(0, time − preroll)`, and scrolls the view there. It opens no undo block, never starts or moves playback, and refuses while REAPER records. It refuses a time or pre-roll it cannot read, and a pre-roll over 10 s (the range of the `Teleprompter.punch_preroll_seconds` fallback setting).
- Both are experimental ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)) until the verification pass, and their Go client is `bridge.Actions.PlayPosition` and `PunchTo`.
- REAPER's own pre-roll preference is not read yet. How to read it is a REAPER API check the PRD reserves for the owner's go-ahead, so the host passes the pre-roll (the fallback setting until then).

## Consequences

- Nothing in REAPER's project or undo history changes on a punch. The narrator records over the word with REAPER's own pre-roll or punch settings.
- The anchor source stays open until S4. A wrong choice costs the output latency (typically tens of milliseconds) in the cursor position, which the UI shows before moving.
- The host's anchor poll, the anchors file, the offline-alignment fallback, the setting and the "Punch from here" UI build on these commands in the teleprompter lane.
