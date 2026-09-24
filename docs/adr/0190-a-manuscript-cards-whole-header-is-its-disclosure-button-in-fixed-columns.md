# 0190. A Manuscript card's whole header is its disclosure button, in fixed columns

**Status:** Accepted
**Date:** 2026-09-24

## Context

[Manuscript Chapter Header Alignment](../prds/manuscript-chapter-header-alignment.prd.md) and
[Manuscript Credits Card Parity](../prds/manuscript-credits-card-parity.prd.md) both change the same header and land
together (the parity PRD's Phase 1 preferred sequence): the owner reported that the chapter header's stat block and
Read aloud button zigzag down the page because the stat block sits at the right edge with the button to its left, and
that "the opening credits panel ... needs to work the same" as a chapter card, which only its title text opens and
closes today.

The chapter card was inline JSX in `Manuscript.tsx`; the credits card was a separate component, `CreditsEntry.tsx`,
which copied the chapter card's frame but none of its header behaviour. Neither had `aria-expanded`/`aria-controls` on
a toggle that covered the header (the chapter header's button was a plain `<button className="text-left">` around the
title only; the credits header's button wrapped just its title text, so only that text opened the card).

## Decision

- **One shared component, `apps/ui/src/components/manuscript/ReaderCard.tsx`** (not a primitive: used only by the
  Manuscript page), renders both a chapter card and a credits card. `CreditsEntry.tsx` supplies only its own body
  content (rendered credits text, per-line rows, unresolved-token chips); `ReaderCard` owns the frame, the header and
  the disclosure.
- **The whole header is the toggle, drawn with one native `<button>`, not a second control layered over it.** A
  control inside a button is not valid HTML (the rule `primitives/Disclosure.tsx` already records for its own
  disclosure shape). The toggle button wraps the eyebrow (credits only) and the title; its `::after` pseudo-element is
  stretched over the entire header (`after:absolute after:inset-0`), with **no `position:relative` on the button
  itself**, so the pseudo-element's containing block is the header's own `sticky` positioning context, not the
  button's small content box. A press anywhere in the header — the padding, the stat block, the chevron — lands on
  that overlay and toggles the card. The bookmark and Read aloud controls are separate elements, positioned
  `relative z-[1]` above the overlay, so they keep their own presses and keyboard focus; the toggle reports
  `aria-expanded` and `aria-controls`, and its accessible name stays the title (the eyebrow is `aria-hidden`), so an
  exact-name lookup ("Opening credits", "Chapter 2 — The Pool of Tears") keeps working.
- **A card with no bookmark (credits; a chapter header's leading column) still renders an empty leading grid cell,
  not an absent one.** The header is `grid-cols-[1.4rem_minmax(0,1fr)_auto]`; a React child that is entirely absent
  (`{condition && <X/>}` when `condition` is false) is not a grid item at all, so CSS grid auto-placement shifts every
  later item one column left and the last column's `auto` track collapses to `0` — the stat block, action slot and
  chevron then render flush against the title instead of at the header's own right edge. This broke only in a real
  browser: every jsdom/Vitest test still passed, since jsdom does no layout. `ReaderCard.test.tsx` pins the header's
  child count instead, and the Playwright driver for `manuscript/chapter-header-columns` presses real pixels.
- **The header's right side is one fixed order: an optional Retail sample tag, the stat block (word count, read
  time), a fixed-width action slot, then a chevron.** The stat block is `min-width` (not `width`) sized to fit
  "99,999 words"; an unusually long count grows only that row instead of overflowing. The action slot is a fixed
  width with its button (if any) right-aligned inside it, rendered on every row whether or not that row has an
  action, so a buttonless row (Front Matter, a credits card) still lines up with the rows that have one. Because the
  header is `justify-self-end` in its own grid track (the grid's last column, right-anchored to the header's own
  padding edge), and every item in the cluster after the optional tag has a fixed width, each item's position
  relative to that right edge is constant down the page regardless of digit count or button presence — no page-wide
  `subgrid` is needed.
- **Read time is one helper, `readTimeLabel` in `apps/ui/src/state.ts`**, used by every card: seconds under a minute
  (`~2 s read`), minutes at and above it (`~16 min read` — the same number the old chapter-only formula gave for a
  chapter-length count, since the round trip through seconds cannot move a large count's minutes by one).
- **A credits card's open state is not host reader state.** A credits id is never sent to `readerStateSave`
  (`expandedChapters`) or `manuscriptParagraphs`; it is a per-project browser-storage preference
  (`creditsExpandedStorage.ts`), open by default, wrapped in `try`/`catch` so a blocked or full store still renders
  correctly (the choice just does not persist). Expand all and Collapse all set the chapters and the credits together.

## Consequences

- Every Manuscript card (chapter or credits) now opens and closes from anywhere on its header, announces its state to
  a screen reader, and lines up its stats and its action column with every other card on the page.
- The whole-header toggle only works through the CSS overlay; a future change to the header's markup (a new column, a
  repositioned control) must keep the toggle button un-positioned (no `relative`) and keep the other controls'
  `relative z-[1]`, or the overlay stops covering the header, or stops yielding to the other controls' clicks.
- The "empty child instead of an absent one" rule applies to any future optional leading/trailing grid cell in this
  header; a reviewer adding a new conditional column here should render a placeholder, not omit the branch.
- `CreditsEntry.tsx`'s own raw `<button>` (`src/rawNatives.test.ts`) is gone; its ceiling entry is deleted rather than
  set to 0.
- A future third kind of Manuscript card (if one is ever added) extends `ReaderCard`'s slots rather than writing a
  third hand-rolled header.
