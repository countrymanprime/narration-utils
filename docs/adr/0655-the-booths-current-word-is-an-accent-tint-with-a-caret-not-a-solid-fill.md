# 0655. The Booth's current word is an accent tint with a caret, not a solid fill

**Status:** Proposed (Phase 13 of the mock fidelity PRD, stream F-P13 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Amends:** `primitives/Highlight.tsx`'s `Cursor` kind (introduced undated, before this PRD)

## Context

Mock 03 (`docs/prds/mockups/stage-navigation-and-page-replacement/03-booth-concept.webp`, D92) draws the Booth's current word on `--accent-soft`, about 42 px tall at the mock's 26 px/48 px line, radius 4, with a 2 px accent caret at its leading edge. The app drew it as a solid `--accent` fill with `--accent-contrast` text — a stronger, block-like mark, closer to a selection highlight than a reading position.

`Highlight`'s `Cursor` kind has exactly one consumer: `booth/ReaderText.tsx`'s current-word span. No other reader (Manuscript, Script) uses it, so moving its look does not change fidelity anywhere else the primitive is used.

## Decision

`Cursor`'s style in `primitives/Highlight.tsx` becomes `background: var(--accent-soft)`, `color: var(--accent-strong)` (the same fill/text pair `StatusBadge`'s `accent` tone already uses and `paletteContrast.test.ts` already checks), `border-radius: 0.25rem`, and a 2 px leading caret drawn as `boxShadow: inset 2px 0 0 var(--accent)` — the same inset-box-shadow technique the adjacent `Extra` flag kind already uses for its own insertion bar. The cancelling negative margin that keeps cursor movement from reflowing a line is unchanged.

No new token: `--accent-soft`/`--accent-strong` are Phase 0b's existing pair.

## Consequences

- The current word reads as a position marker inside the line rather than a filled block, matching the mock.
- `Highlight.stories.tsx`'s `Cursor` story and its atlas capture change; no other `HighlightKind` story is affected.
- A future reader that wants the old solid-fill look would need its own kind or an override; nothing currently asks for it.
