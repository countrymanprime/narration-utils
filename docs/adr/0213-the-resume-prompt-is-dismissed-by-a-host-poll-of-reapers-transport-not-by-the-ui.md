# 0213. The resume prompt is dismissed by a host poll of REAPER's transport, not by the UI

**Status:** Proposed
**Date:** 2026-09-26

## Context

[Read Aloud Resume from the DAW](../prds/read-aloud-resume-from-daw.prd.md) Phase 5 (RD7) asks for the resume prompt
to go away the moment the narrator starts playing or recording in REAPER, without the narrator clearing it by hand.
The owner's own words: "it should go away if we start playing." The PRD's architecture note prefers the poll live in
the host ("one poll per open dialog, cancelled on dismiss") over the dialog itself, so the read is bounded and does
not race the dialog's own render cycle, and so it stops immediately once the dialog no longer needs it.

## Decision

1. `resumeWatch` (`apps/desktop/teleprompterresumewatch.go`) is a small, standalone poll, independent of
   `teleprompter.Service`'s session state machine: it never runs while a session is active (the dialog stops it
   before Start reading, per the sibling PRD's UI contract) and touches none of that service's locked state, so it
   carries no risk to the well-tested session lifecycle.
2. Two bindings: `TeleprompterWatchResume(trackGUID)` starts polling that track about once a second (replacing any
   watch already running), and `TeleprompterUnwatchResume()` stops it. Both read-only, both silent no-ops when there
   is nothing to trust (no live bridge, REAPER not connected, no track GUID) - the same refusal-reads-as-absence rule
   Phase 4's `recordedEndFor` already follows.
3. The poll asks `chapter_track_state` (the same command Phase 4 uses, ADR 0212) and, the moment REAPER answers
   playing or recording, emits one `teleprompter:resumeLive` event (no payload - the dialog already has everything it
   showed) and stops itself. A transient refusal (a momentary unavailability, a stale track) never stops the poll;
   only playing, recording, an explicit stop, or its own 10-minute safety timeout does.
4. The dialog's sequencing (starting the watch on open, stopping it on Start reading, on a choice, or on close) is
   lane C's to build (`read-aloud-resume-from-daw.prd.md`'s own "host complete, UI pending" pattern, as Phase 3
   shipped before it). RD6 (re-syncing the locate when the cursor moves while idle) is not built: it is the PRD's own
   "Could" item and needs the poll to also carry the cursor's position, not just play/record, which nothing yet asks
   for.

## Consequences

- No REAPER bridge or Lua change: `chapter_track_state` (ADR 0231) already answers everything this poll reads.
- A dialog that never calls `TeleprompterWatchResume` (today, since lane C's wiring is pending) sees no behaviour
  change at all; the safety timeout means an already-open watch a crashed session forgets to stop still ends within
  ten minutes rather than polling forever.
- Binding-level tests use the same `trackStateReader`-fake boundary as Phase 4 (ADR 0212), not a real bridge client;
  `resumeWatch`'s own tests inject a poll interval seam so they run in milliseconds, not the real one-second cadence.
