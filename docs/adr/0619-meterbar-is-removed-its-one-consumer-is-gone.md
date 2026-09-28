# 0619. MeterBar is removed: its one consumer is gone

**Status:** Proposed (Phase 9 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P9 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** [ADR 0050](0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md)'s `MeterBar` clause only (its `Field` clause, unrelated to this primitive, stands)

## Context

ADR 0050 named `MeterBar`'s one call site as `AudiobookEstimatePanel.tsx`'s recording-progress row on the Home page. The Home page was later replaced by Production (D79, recorded in the mock fidelity PRD's evidence section); `AudiobookEstimatePanel.tsx` no longer exists in the tree, and a repo-wide search finds no other consumer — only `MeterBar.stories.tsx`, `MeterBar.test.tsx` and two stray comments (`Kbd.tsx`'s naming-precedent note and `chapterStatus.ts`'s consumer list) mention it. The mock fidelity PRD's Phase 9 spec table calls this out directly: "Phase 9 decides MeterBar's fate (it has no consumer); removing it is a new ADR," and names its dead CSS rule, `.progress-segment` (`styles.css`), as a `design-spec-guard` item to remove alongside it if it stays unused.

## Decision

`MeterBar.tsx`, `MeterBar.test.tsx` and `MeterBar.stories.tsx` are deleted. The `.progress-segment` CSS rule they alone used is removed from `styles.css`; `legacyCss.test.ts` moves `progress-segment` from `UNLAYERED_ALLOW_LIST` to `REMOVED_CLASSES`, so the guard now fails if anything reintroduces it rather than staying silent. `chapterStatus.ts`'s `STATUS_LABELS`/`STATUS_ORDER`/`STATUS_COLOR`/`STATUS_TONE` exports are untouched: the chapter list and `StatusBadge`'s tone map still use them.

## Consequences

- One fewer primitive to keep in sync with future token or primitive changes; nothing in the app draws a multi-segment, single-image meter today.
- A future feature that needs a segmented, no-single-value meter (ADR 0050's original reasoning: Base UI's `Meter`/`Progress` model one value in a range, and this shape doesn't) re-adds it, informed by whatever mock or spec motivates it, rather than resurrecting the unused primitive as-is.
- `Kbd.tsx`'s and `chapterStatus.ts`'s comments mentioning `MeterBar` go stale (they describe history that was true when written); both files belong to other phases' scope (Kbd: Phase 10; chapterStatus: shared), so this ADR does not edit them.
