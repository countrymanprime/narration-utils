# 0119. A hand scroll pauses following until the current word is back in the band

**Status:** Proposed
**Date:** 2026-09-23
**Amends:** [ADR 0024](0024-teleprompter-highlight-follows-the-sidecars-spans.md) (its last consequence, that a narrator who scrolls by hand can be pulled back)

## Context

The shared reader (`ReaderText`, used by the Teleprompter page and the read-aloud dialog through `ReadAlongView`) scrolls the
current word to the middle whenever it leaves the 25%-70% band of the viewport, on every cursor change while a session runs.
ADR 0024 records the consequence: a narrator who scrolls to look ahead or back is pulled back at the next word.
`docs/prds/teleprompter-engines-and-input-devices.prd.md` Phase 10 asks for manual scroll without the pull-back, and the owner
answered its open question on 2026-09-23: pause on a user scroll, resume automatically when the current word is back inside
the follow band, plus a visible Follow control, with scroll intent detected from input rather than from scroll events.

## Decision

1. Following lives in one hook, `useFollowCursor` (`components/teleprompter/useFollowCursor.ts`), called by `ReadAlongView`, so
   both surfaces get it; `ReaderText` keeps its `follow` prop and scrolls only while it is true. The band check and the
   reduced-motion behaviour (an instant jump instead of a smooth one) are unchanged and shared by the pause logic.
2. A pause comes only from input: a wheel or a touch drag inside the reader's scroll container, a press on that container's
   own scrollbar, or a scrolling key (Page Up/Down, Home, End, the vertical arrows, Space) that no field, widget or button
   took. Scroll events never pause, because the reader's own follow scrolling fires them too.
3. While paused, following resumes by itself as soon as the current word is inside the band: checked on every cursor step
   and once a scroll has been still for 150 ms. The 150 ms is not a resume timer; it waits out a wheel's smooth scroll or a
   touch's momentum so the word passing through the band mid-scroll does not resume following. With the word outside the
   band the reader stays paused for as long as it takes.
4. A Follow button sits beside Stop in the sticky status bar for the whole session, enabled only while paused, with
   "Following paused" under the status. Pressing it resumes and scrolls straight back to the word. Each session starts
   following.

## Consequences

- A narrator can scroll ahead or back and read there; the text is never pulled away from them. Scrolling past the word so it
  sits above the band means following resumes by itself once reading brings the word down into it.
- A wheel or touch over another scrolling area inside the same container (the read-aloud rail) also pauses, but the word is
  still in the band then, so following resumes at the next step without anything moving.
- Other ways of scrolling (a find-in-page jump, a screen reader's virtual cursor) are not detected and are pulled back as
  before; they can be added to the input list if they turn out to matter.
- The band is still measured against the window, not the scroll container, as ADR 0024's reader did.
