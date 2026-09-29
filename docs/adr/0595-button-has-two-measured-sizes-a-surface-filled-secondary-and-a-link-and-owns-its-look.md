# 0595. Button has two measured sizes, a surface-filled secondary and a link, and owns its look

**Status:** Proposed (Phase 1 of the mock fidelity PRD, stream F-P1 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); its Q1 and Q2 recommendations were taken per D22 and are for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Supersedes:** nothing. [ADR 0053](0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md) (IconButton is 32 px) stands: the mocks draw 32 px icon buttons.

## Context

The owner found that the merged pages' buttons don't match the approved mocks (D91). `Button` set no height, so it was 38.4 px from its padding and inherited line-height. Every benchmark mock draws 32 px. About 30 call sites shrank it through `className`, in 7 recipes (`text-xs`, `px-3 py-1`, `px-2.5 py-1 text-xs`, `SMALL`, `px-2! py-1!` and others), so no two small buttons matched. The outlined button (`ghost`) had no fill, so on the page background it showed `--bg`; the mocks fill it `--surface`. Six underlined text actions inside sentences were raw `<button>`s, because `Button` had no look for them.

The mocks were measured again for this phase with sharp on `docs/research/mockups/audiobook-studio-benchmark/`:

- **Mock 01's header** (Export status report, Start session): both are 32 px from border to border, with 12 px from the border to the ink on each side. The secondary is filled `#fff` (`--surface`) inside a `--border` line. The label's cap height is 9 px, which is Barlow Condensed at 13 px.
- **Mock 07's companion** (Punch & roll here, Resolve, Waive): both are 28 px, again 12 px to the ink. The secondary is filled `#211e18`, dark `--surface`.

## Decision

`apps/ui/src/components/primitives/Button.tsx` draws the measured spec and nothing else draws a button's look:

- **Sizes.** `size="md"` (the default) is `--button-height`, 32 px including the 1 px border. `size="sm"` is `--button-height-sm`, 28 px, for the companion and dense rows (a table row's actions, a list row's Hear). There is no `lg`: no mock draws one. The height is a minimum, so a label that wraps grows the button instead of spilling out of it.
- **Chrome.** 12 px each side, `--radius-button`, Barlow Condensed at `--font-size-sm`, 600, uppercase, `--tracking-button` (0.06 em), `leading-none`, centred. Disabled is 55% opacity (the PRD measured a disabled benchmark primary at `#d5a384`, about 55% of `--accent`).
- **Variants.** `primary` is filled `--accent`. `secondary` is outlined `--border` and filled `--surface`, so it reads the same on the page and in a card; it replaces `ghost` at every call site. `ghost` stays, the same button with no fill, for one that sits on a tinted surface. `danger` is unchanged. `link` is an underlined text action inside a sentence: it takes the sentence's font, size and colour, draws no chrome and ignores `size`. The six raw link `<button>`s use it now.
- **`className` is for layout only**: margin, width, flex, visibility, and colour on a `link`. `apps/ui/src/buttonOverrides.test.ts` reads every `<Button>` outside the primitives and fails one whose `className` sets padding, type size or weight, height, leading, tracking, radius, border or case. The files that later phases of the PRD own (the Booth, the Script rail, the shell's zoom readout, the Stage summary's chips, the selection menu) have a ceiling that may only come down.
- **IconButton** takes `size="sm"` (28 px) beside a small Button, the button radius token and the same 55% disabled. Icon-only Buttons (the Proof transport's Play, the built-in recorder's take Play) are IconButtons now, and `ProjectPicker`'s two hand-drawn clones are an IconButton and a Button.

A button and a text field in one row no longer share a height (40.8 px `--control-height` against 32 px). The benchmark mocks never put them side by side (the PRD's Q2).

## Consequences

- Every page's buttons are one of two heights and one look, and a new call site can't drift, because the guard fails it.
- The dark sets drawn on 2026-09-24 draw 38 px buttons, so a state scored against one of them can lose a little match (the PRD's Q1: the benchmark mocks win). The PR that landed this lists every state that moved.
- A caller that needs a different button shape (the selection menu's joined buttons, the zoom readout's mono number) now needs a primitive for it, not a class string: the PRD's Phases 5, 8 and 10 own those.
- Changing a size or the look again is a change to this file and its story, and a new ADR that supersedes this one.
