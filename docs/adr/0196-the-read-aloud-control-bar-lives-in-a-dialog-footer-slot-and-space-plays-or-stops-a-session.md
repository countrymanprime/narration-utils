# 0196. The read-aloud control bar lives in a Dialog footer slot, and Space plays or stops a session

- **Status:** Proposed
- **Date:** 2026-09-24
- **Related:** Amends [ADR-0094](0094-dialog-gains-a-full-size-variant-that-fills-the-viewport-with-a-margin.md) (a new `footer` slot) and [ADR-0119](0119-a-hand-scroll-pauses-following-until-the-current-word-is-back-in-the-band.md) decision 2 (Space is no longer always a scroll key)

## Context and problem

[Read Aloud Control Bar](../prds/read-aloud-control-bar.prd.md) Phase 3 replaces the read-aloud dialog's configuration
card - Microphone, Engine, Model and Start reading, a `Panel` that scrolls with the rest of the dialog body and is
sticky only once a session is active (`ReadAlongView.tsx`) - with a compact always-visible media bar, because the
owner reported losing the Start button while reading down a long chapter. Phase 1 already gave the reading panel a
full-height column and moved the resume prompt into the text column's own axis; Phase 2 added `Popover` as an
interactive layer above the dialog. This phase is the bar itself: where it lives in the dialog shell, what it puts in
front of a popover instead of inline, and how Space reaches it without also scrolling the page.

## Decision drivers

- The owner reported losing the Start button while reading down a long chapter.
- The configuration card scrolls with the rest of the dialog body and is sticky only once a session is active.
- Space must reach the bar without also scrolling the page.
- The PRD's Q10 A, the recommended answer the owner's mockups already assume.

## Considered options

1. A compact, always-visible media bar in a new `Dialog` footer slot, with Space playing or stopping a session
2. Keep the status quo: the configuration card, a `Panel` that scrolls with the dialog body
3. A bespoke footer region hand-rolled at the call site

## Decision outcome

**Chosen option: a compact, always-visible media bar in a new `Dialog` footer slot, with Space playing or stopping a session**, because the owner reported losing the Start button while reading down a long chapter.

1. **`Dialog` gains a `footer` slot** (`apps/ui/src/components/primitives/Dialog.tsx`): a `ReactNode` prop rendered in
   its own `flex-none` region, bordered on top, between the scrolling body and the existing `actions` row. It has no
   padding or alignment opinion of its own (unlike `actions`, which centres a button row) - a toolbar lays out its own
   content. Absent, nothing is drawn, so every other `Dialog` consumer is unaffected. This is additive to ADR 0094 the
   same way `size="full"` was additive to ADR 0001: a documented extension point on the one modal shell, not a
   bespoke region hand-rolled at a call site.
2. **`ReadingControlBar`** (`apps/ui/src/components/teleprompter/ReadingControlBar.tsx`) is a `toolbar` named "Reading
   controls", rendered in that footer slot by `ReadAloudDialog` (and, since it shares `ReadAlongView` with the
   standalone page, `sticky bottom-0` at the bottom of `TeleprompterPage`'s own column, which has no dialog shell of
   its own - Q11 A). Left to right: **Play** (renamed from "Start reading"; disabled while a session is active, since
   Pause is a later phase - there is no Pause button tonight) and **Stop reading** (always rendered, disabled while
   idle, unlike the old card which hid it entirely); the status text and word count, with "Following paused…" folded
   into the same region; the start-point chip while idle (the sibling PRD's resume prompt, via a `label`/`onClear`
   pair `ReadAloudDialog` derives from the chosen sentence); **Follow**, always shown during a session, enabled only
   while paused (unchanged from the old card); a **microphone** button named `Microphone: <device>` opening a
   `Popover` with the existing `MicrophoneField` (its device list and Refresh - no level meter, which is Phase 4);
   and a **Settings** `IconButton` opening a `Popover` with Engine (only when the host offers more than one) and
   Model as `ToggleGroup`s, both disabled while a session runs, and a "More in Settings" link to `/settings#teleprompter`.
   No "Record in REAPER" toggle (Phases 6-7, not built here).
3. **`useFollowCursor` moves up a level.** `ReadAlongView` no longer calls it: the bar's Follow button needs the same
   `following`/`resume` state the reader text does, and the bar now renders outside `ReadAlongView` (the dialog's
   footer is a sibling of the body, not a descendant), so `ReadAloudDialog` and `TeleprompterPage` each call
   `useFollowCursor` once and pass the result to both `ReadAlongView` (`follow` prop, replacing its own internal
   call) and `ReadingControlBar`.
4. **`MicrophoneField`'s Refresh becomes a `Button`** (`variant="ghost"`), not a raw `<button>` (ADR 0053's ratchet;
   `rawNatives.test.ts`'s ceiling for this file drops to zero) - a cosmetic change inside the popover, same accessible
   name and behaviour.
5. **Space plays or stops a session**, amending ADR 0119 decision 2 for this dialog: when focus is not in a field, a
   button, a tab or another interactive widget (the same target check `isScrollKey` already makes - `EDITABLE`,
   `SPACE_ACTIVATES`, `KEY_WIDGET_ROLES`, now exported from `useFollowCursor.ts` for reuse), `ReadingControlBar`'s own
   `keydown` listener calls `preventDefault` and toggles Play/Stop instead. `isScrollKey`'s own document listener
   already skips a prevented event (`useFollowCursor.ts`), so Space stops being read as a scroll-and-pause key
   wherever this bar is mounted, without touching `isScrollKey` itself or any other scroll key.

### Consequences

- **Good:** The control bar is visible in every dialog state, idle or active, at any scroll position, which is metrics rows 1
  and 2 of the PRD: the narrator never loses Play, Stop or the microphone by scrolling down a long chapter.
- **Neutral:** `Dialog`'s footer slot is a second `flex-none` region alongside `actions`; a future dialog that wants a persistent
  toolbar reuses it instead of inventing another one-off layout, and a change to what the slot means should supersede
  this ADR (the same posture ADR 0094 took for `size`).
- **Neutral:** Engine, Model and the microphone move from always-visible fields to popovers: one more click to change them, traded
  for the bar staying compact at every width (metrics row 2, `read-aloud-mic-popover` and `read-aloud-settings-popover`
  visual rows). The standalone Teleprompter page gets the same bar for free (Q11 A) without a REAPER toggle, since it
  has no fixed chapter until one is chosen.
- **Bad:** Space no longer scrolls the page inside this dialog outside of a field or widget; a narrator who relied on Space to
  page down the reader text while idle (unusual - the reader tracks the cursor for them during a session) now plays
  or stops the session instead. This is the PRD's Q10 A, the recommended answer the owner's mockups already assume.
- **Neutral:** Pause, the level meter, REAPER's live transport state and "Record in REAPER" are unbuilt: Play is simply disabled
  during a session rather than becoming a Pause toggle, and the bar's mic popover and Settings popover show no meter
  and no REAPER row. Phases 4-7 extend this same bar; they should not need to change its layout, only add to it.

### Confirmation

Point 4: `rawNatives.test.ts`'s ceiling for `MicrophoneField` drops to zero (ADR 0053's ratchet). The popovers are the `read-aloud-mic-popover` and `read-aloud-settings-popover` visual rows.

## Pros and cons of the options

### A compact, always-visible media bar in a new `Dialog` footer slot, with Space playing or stopping a session

- Good, because the narrator never loses Play, Stop or the microphone by scrolling down a long chapter.
- Bad, because Engine, Model and the microphone take one more click to change.

### Keep the status quo: the configuration card, a `Panel` that scrolls with the dialog body

- Bad, because the narrator lost the Start button while reading down a long chapter.

### A bespoke footer region hand-rolled at the call site

- Bad, because it is not a documented extension point on the one modal shell.
