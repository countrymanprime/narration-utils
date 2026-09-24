# 0193. Home's Actual recorded is the linked track's recorded length from the saved project, and never an estimate

**Status:** Accepted
**Date:** 2026-09-24
**Supersedes:** the "The recorded column names its source" clause of [ADR 0130](0130-the-home-recording-check-opens-on-the-stored-result-runs-only-on-a-press-and-labels-the-recorded-length-measured-or-estimated.md); Q12 of `docs/utilities/recording-coverage.md`

## Context

The owner reported that Home's **Actual recorded** column never showed a recorded time: before a recording check it multiplied the chapter's *estimated* finished length by a fixed share taken from the status the narrator picked (half for Recording, all of it from Editing on), and even the "measured" case was the recording check's word share times the same word-count estimate, not a duration. `docs/prds/actual-recorded-column.prd.md` traces the guess to `RECORDED_FRACTION` (`AudiobookEstimatePanel.tsx`) and records the owner's report and the evidence in full; this ADR records only the decision and what it changes going forward.

## Decision

- **The cell shows one thing: the chapter's linked REAPER track's recorded audio in the saved project, as a time, or a plain dash.** Nothing else ever fills it. The value is `recordedSeconds` on the chapter payload (Phase 2): the union of the unmuted items on playing lanes of the chapter's one confirmed track, from the saved `.rpp`, project seconds. No transcription, no sidecar, no live REAPER read.
- **A chapter with no usable link shows "—" with a reason, never a caption naming a source.** `recordedUnavailable` says why: `unlinked` (no REAPER track linked), `multiple_tracks` (linked to more than one, matching a confirmed link being exactly one track per ADR 0130's D5), `track_missing` (the linked track is no longer in the saved project), or `no_project` (no project could be read). The reason is the dash's tooltip and its accessible name; there is no visible caption under the number either, unlike the "measured"/"estimated from status" labels this supersedes.
- **The chapter's status never touches this column.** Changing a row's status leaves its Actual recorded cell and the headline stat unchanged; a status update in the UI explicitly keeps the row's own `recordedSeconds`/`recordedUnavailable` rather than letting a partial API response blank them.
- **The recording check's word share (`recordedFraction`) leaves this column for good.** It answers "is all the text read", a different question from "how much audio exists"; it stays on the chapter payload for the stage engine and the recording check dialog, which are unaffected.
- **The headline "Actual recorded" stat sums only the real times of linked chapters**, with a tooltip stating how many of the book's chapters that covers ("From N of M chapters with a linked track, as of the saved REAPER project. Nothing here is estimated."), and drops to a dash when none are linked. This is expected to lower the number for every existing user who has not linked tracks yet; that is the intended honesty (ADR 0015).
- **The column header carries the definition** ("The audio on the chapter's linked REAPER track: its unmuted items, overlaps counted once, as of the saved project. A dash means no track is linked.") so the one-word header stays "Actual recorded" rather than becoming "Recorded length".

## Consequences

- A narrator who has linked no tracks yet sees an all-dash column and a dashed headline stat; this is accurate, not broken, and each dash explains itself on hover or focus.
- The number can never be gamed by picking a status, and never regresses when a check goes stale (there is no check dependency left to go stale).
- Home's chapter-track link button and REAPER Automation's chapter-track sync (sibling features) become the way a narrator turns dashes into times; this ADR does not change how a link is made, only what the column does with one.
- A future change that wants to show a *raw* take time (including trimmed retakes) alongside the current length, instead of only the union of unmuted playing-lane items, needs a new ADR: this one fixes the definition to the union, matching what the recording check already reads.
