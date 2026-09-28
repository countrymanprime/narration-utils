# 0666. The book-consistency band draws the rule's bound as a dashed target zone, with one accent tick per file

**Status:** Proposed (Phase 14 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P14 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** none (`BookConsistency.tsx`'s track had no ADR; delivery-platform-profiles.prd.md Phase 10 shipped it without one)

## Context

`master/BookConsistency.tsx`'s `SpreadTrack` (delivery-platform-profiles PRD Phase 10, mockup 11 "Book consistency") shaded the **book's own measured min-to-max spread** in a 40%-tinted `--ok` band, with a small bordered circle per judged file and a separate accent tick for the median. Mock 05's "Book consistency · RMS by chapter" (mock fidelity PRD, D92) draws a different thing: a 371×26 band whose shaded region is the **rule's own pass/fail bound** (`min`/`max`, a fixed target zone the narrator is aiming for, not a summary of what was measured), filled with the Phase 0b `--ok-zone` token and dashed at its edges, with a plain 3×18 accent tick per file - no separate median mark.

`DeliveryRule.min`/`.max` (`api/contracts/deliveryProfiles.ts`) are the rule's inclusive pass/fail bounds already, the same values the per-file `LevelCell`s judge against - so the mock's "target zone" is exactly that bound, not a new figure the host needs to add.

## Decision

`SpreadTrack` draws the target zone from `rule.min`/`rule.max` (clamped to the track's own min/max scale; a boundless side draws no edge on that side) as `var(--ok-zone)` with dashed left/right borders in `var(--ok)`, height 1.625rem (26 px). Each judged file is a 3×18 px `var(--accent)` tick at its own position; there is no separate median tick (mock 05 draws none, and the rule's own bound already reads as the target). The row's descriptive text (min/max/median, spread, file count) is unchanged - only the track's drawing changes.

## Consequences

- The band now shows whether the book's files sit inside the rule's tolerance, not merely how spread out they are; a book whose files cluster tightly but outside the bound now visibly fails the zone, which the old min-to-max shading could not show.
- `MasterQcPage`'s "Chapter 01.wav · Why it fails" and the "book-spread" catalog state (six chapters, all within ACX's bounds) both read the new drawing without a data change.
- A rule with no bound on either side (`min` and `max` both null) draws ticks with no shaded zone, unchanged from before.
- A different zone shape or a restored median mark is a change to `SpreadTrack` and a new ADR superseding this one.
