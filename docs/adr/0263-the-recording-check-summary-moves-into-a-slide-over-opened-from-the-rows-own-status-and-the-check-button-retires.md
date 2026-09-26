# 0263. The recording check summary moves into a slide-over opened from the row's own status, and the Check button retires

**Status:** Proposed
**Date:** 2026-09-26

## Context

[DAW Chapter-Track Auto-Sync](../prds/daw-chapter-track-auto-sync.prd.md) Phase 6 ("Status without a click", S14)
retires Home's per-row **Check** button in favour of a status that is always there: `chaptersync:state` already
carries, per narration chapter, whether its check is `current`, `stale` (with reasons) or `never`, when it was
checked, whether one is running, and when its track last changed (host-complete before this PR). [Recording Check
Summary](../prds/recording-check-summary.prd.md) RS7 (D26, owner 2026-09-24) answered where the summary goes once the
button is gone: "a chapter slide-over opened from the row's check-status cell or track button", built in the same
change that retires the button "so the dialog is never unreachable" — the two PRDs deliberately left this as one
piece of work rather than two.

`ChapterTrackButton`/`ChapterTrackPanel` ([Chapter Track Link Control](../prds/chapter-track-link-control.prd.md)
Phase 2, already merged in #534) already opens a slide-over for the chapter's *track* facts and links from a button in
the same row. A second, independent trigger for the chapter's *check* summary was needed beside it, since a track's
link state and a check's freshness are different questions (a chapter can be linked and stale, or unlinked and never
checked) and the row already has a dedicated column for each.

## Decision

1. **A new pure derivation, `chapterCheckStatus`** (`apps/ui/src/components/home/chapterCheckStatus.ts`), decides what
   the row's Recording check cell shows: the track-link's own trouble first (`missing`, `needs_track`, `suggested`,
   `not_linked`, from the same `chapterTrackButtonState` the track button already uses), and only once the chapter has
   a confirmed track does it read the check's own freshness (`current`, `stale` with its first reason, `never`) from
   `ChapterSyncState.chapters[]`. A check running now (in the foreground or the background, ADR 0211) always wins,
   showing "Checking N%". A track's freshness means nothing until there is a track to check, so link trouble is never
   hidden behind a plain "Never checked".
2. **The cell is always clickable, in every state**, including `not_linked` and `missing`: it opens the same chapter
   panel a working check does, which already shows the in-place track-link prompt for a refused check (ADR 0100's
   confirm-in-place pattern). A narrator with no track yet is never left with a dead cell.
3. **`RecordingCheck.tsx` becomes a `SlideOver` instead of a `Dialog`**, mounted the same way the dialog was
   (conditionally, by the caller, so a reopened chapter is always a fresh mount — a run left going in the background,
   or a stale refusal from the last time it was open, is never shown twice). Its one action, **Check recording** /
   **Check again**, moves out of the dialog's action bar (a slide-over has none) into the body: right after the
   chapter's figures and before **Pickups**, matching the approved mockups
   (`docs/prds/mockups/recording-check-summary/01-slideover-not-complete.webp`) for a result with a report, and at the
   top of the body for `never`/refused states that have no report yet to attach it to.
4. **Home re-reads its chapter list and stage suggestions on every `chaptersync:state` event**, not only on window
   focus: the event already fires after every sync, every watched save, and every check that ends, so it is a strictly
   more complete trigger than the focus-only read [Home Stage Check Line](../prds/home-stage-check-line.prd.md) Q2
   proposed as a stop-gap. The first event (the initial subscribe) is skipped, since the chapter list and stage
   suggestions already load once on their own.

## Consequences

- Home's "Recording check" column now reads as a status, never a bare button; a narrator sees which chapters are
  current, out of date (and why), never checked, or blocked on a track, at a glance, matching the owner's original
  request ("I should never have to click 'Check' to know the status of the tracks").
- `RecordingCheck.test.tsx`'s `openCheck` helper and `tests/visual/app.drivers.ts`'s `openRecordingCheck` now click the
  row's status cell (`Recording check for <chapter>: ...`) instead of the retired `Check recording of <chapter>`
  button; both still find the same panel by its title.
- The panel's aria snapshot moved from `dialog-recording-check.aria.yml` to `slide-over-recording-check.aria.yml`
  (its title element is now an `<h3>`, matching every other `SlideOver`, rather than the `Dialog` shell's own level).
- A future change that wants the check's action back in a fixed bottom bar (rather than inline with the figures) would
  need its own decision; nothing here prevents it, since `RecordingCheckReport`'s `actionsSlot` prop is a plain
  insertion point, not a layout rule.
