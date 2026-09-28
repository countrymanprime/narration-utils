# 0615. StatStrip is a new primitive drawing the benchmark's one-card KPI row

**Status:** Proposed (Phase 9 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P9 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); the 16 px tile padding and the stacking below `sm` are superseded by [ADR 0645](0645-the-production-board-draws-mock-01s-cells-columns-and-layout-and-the-mock-wins-the-open-audit-layout-questions.md), which wraps the strip into full rows)
**Date:** 2026-09-28
**Supersedes:** none

## Context

Mock B01 (`docs/prds/mockups/stage-navigation-and-page-replacement/01-production-home-concept.webp`) draws Production's six KPI figures as one card, the tiles divided by a 1 px `--border` rule. The app draws six separate cards instead (`ProductionPage.tsx`'s `Figures`: one bordered `<li>` per `StatTile`), which the baseline mock-match run measured as one of the largest differences at that state (83.27% match, "six separate cards; mock: one card, six tiles with dividers" among the listed causes).

`StatTile` itself has no opinion on how many of it sit together or what wraps them; giving it one would make it responsible for two things ("draw one figure" and "arrange several figures"). The mock fidelity PRD's Phase 9 calls for "a `StatStrip` (a new primitive, or `StatTile group`)" for exactly this reason: a second, small primitive that lays several `StatTile`s out as one card, so any page with a KPI row inherits the same look instead of hand-rolling its own wrapper (as `ProductionPage.tsx` and `RecordingCheckCard.tsx` each did).

## Decision

A new primitive, `apps/ui/src/components/primitives/StatStrip.tsx`, renders a labelled `<ul>` of `StatTile`s (`StatStripItem[]`: a `StatTile`'s own props plus a `key`) as one card: `rounded-[var(--radius-card)]` border and `--shadow`, each tile ≈195 px (`min-w-[12.1875rem]`) with 16 px padding, divided by a 1 px `--border` rule. Below the `sm` breakpoint the strip stacks vertically with horizontal rules instead of wrapping horizontally, since Tailwind's `divide-x` marks every non-first child and a wrapped row would otherwise draw a stray leading rule.

`proof/RecordingCheckCard.tsx`'s hand-drawn `<dl>` of two figures (Recorded, Length) is migrated onto it, in place of its own `dt`/`dd` markup and ad hoc Barlow Condensed styling. `production/ProductionPage.tsx`'s six-card `Figures` list is not touched here — Phase 11 (Production board and KPI strip) owns that file and migrates it onto `StatStrip` when it lands.

## Consequences

- Any page needing a one-card row of figures gets the benchmark's look and the accessible list semantics for free, instead of re-deriving the card, the dividers and the sizing by hand.
- `StatTile` stays a single-figure primitive; `StatStrip` is the only place that knows how several of them share a card.
- Production's own KPI strip still draws six separate cards until Phase 11 migrates it onto `StatStrip`; the mock-match score for `production/on-pace` improves only as far as the shared primitives (`StatTile`, `ProgressBar`) move it, not to the one-card layout itself.
- A future change to the strip's card look (radius, padding, breakpoint) writes a new ADR superseding this one.
