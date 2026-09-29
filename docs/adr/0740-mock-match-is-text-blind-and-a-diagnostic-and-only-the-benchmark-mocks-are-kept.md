# 0740. Mock match is text-blind and a diagnostic, and only the benchmark mocks are kept

**Status:** Accepted (owner rulings D96 and D97 on [#509](https://github.com/countrymanprime/narration-utils/issues/509), 2026-09-29; stream N-M1)
**Date:** 2026-09-29
**Supersedes:** the 90% bar of D91 and the pass-or-fail marks in [ADR 0585](0585-mock-fidelity-is-a-pixel-match-at-the-mocks-own-size-and-theme-scored-by-a-tool-that-reports-and-does-not-gate.md) (its measure, capture and no-gate decisions stand)

## Context

Workers kept building towards the per-PRD mocks under `docs/prds/mockups/`, drawn before the redesign, although only the seven benchmark mocks are the spec. The owner ruled (D96) that every other mock is deleted, and that the repo keeps only mocks for work being built now plus the current-state screenshots in `docs/images/ui/`.

The mock-match score also punished the wrong things: different sample words at the same size, weight and position lowered it, and the 90% bar with its written reasons and region tables (D91) pushed workers to chase the number. The owner ruled (D97) that the number is a diagnostic, that features and styles are what matter, and that there are no D91 reasons.

## Decision

1. **`docs/prds/mockups/`, `docs/research/mock-fidelity/`, `docs/research/visual-audit/` and the visual mockup divergence audit are deleted,** with every link to them. A new mock is added only for work being built now, under `docs/prds/mockups/<prd>/`, and is deleted in the PR that merges that work. A PRD links the benchmark mock and never copies it.
2. **The headline match is text-blind.** `apps/ui/tests/visual/mock-match/glyphs.ts` (`flattenGlyphs`) paints every glyph-like mark (a short, sparse, connected area of one quantised colour, or a speck) in the colour around it, in both the mock and the capture, before `compareImages` runs. Fills, cards, pills, borders, rules and spacing stay. The flattening is pure and deterministic.
3. **The plain pixel match stays in the report** as `pixelMatchPercent` beside the text-blind `matchPercent` and the ink match, so nothing is hidden.
4. **There is no bar.** `MATCH_BAR_PERCENT`, `MOCK_MATCH_ENFORCE` and the "under 90" mark are removed; no PR writes a reason for a score, a region-attribution table or a Mockup check table. The screenshots-in-PR rule is unchanged.

## Consequences

- Words and sample data no longer move the score, so it points at layout, features and style. Baselines were re-recorded in `docs/operations/verification-tooling.md`; they are not comparable with earlier numbers.
- An outlined icon reads as a glyph, so an icon the app lacks is not scored, and a heavy heading taller than 32 px stays in the score. The owner's own look at the screenshots covers what the number cannot.
- A deleted mock can be read from `git log`, but it is not a spec.
- To change the method or restore a bar, write an ADR that supersedes this one.
