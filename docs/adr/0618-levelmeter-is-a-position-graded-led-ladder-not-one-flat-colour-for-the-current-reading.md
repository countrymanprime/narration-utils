# 0618. LevelMeter is a position-graded LED ladder, not one flat colour for the current reading

**Status:** Proposed (Phase 9 of the mock fidelity PRD, stream F-P9 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** none (extends [ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md) Q2's peak/RMS ballistics, which are unchanged)

## Context

`LevelMeter` fills from 0% to the current reading's width in a single flat colour, chosen by the *current* reading's zone (`zoneFor(rmsValue, ceiling)`): a reading in the hot zone paints the whole filled bar orange. Mock B03's Booth input meter (231 × 10 px) instead draws a classic hardware LED ladder: the bar is graded green (body) through yellow (hot) to red (over) by *position* along the floor-ceiling range, and the current reading only says how many of those fixed-position segments are lit. A single flat fill cannot draw that; a per-segment DOM node can, but re-renders on every level update (about every 100 ms) and needs the caller's rendered width to size segments, which `LevelMeter` doesn't control (`className` does).

## Decision

`LevelMeter` draws a full-width `linear-gradient` fixed to `floor`/`ceiling` (body → hot → over, using the same zone boundaries `zoneFor` uses internally, exposed as `zoneBoundaries()` in `levelMeter.ts`), then covers the unlit remainder (`100 - width`%) with `--meter-floor`, revealing more of the fixed gradient as the reading rises — the gradient's colour stops never move, only how much shows. A `mask-image: repeating-linear-gradient(...)` (segment width/gap per `size`: compact 3/1 px, regular 4/2 px, booth 5/2 px, chosen to keep segments roughly square at each height, since the mock gives the bar's own size, not a segment count) cuts that into discrete LEDs. The mask wraps only the fill/cover pair; the peak tick is a sibling outside it, so it stays one continuous line rather than being chopped into segments itself, and widens from 1 px (`w-px`) to 2 px (`w-0.5`, mock B03's measured tick width).

The popover level meter mock B03 also names (10×18 px segments, 1-2 px gap, lit ≈`--character`) has no consumer in the app today — no companion popover exists yet (Phase 13, Booth transport and companion, builds it) — so this ADR does not add an unused vertical variant for it; that is Phase 13's decision once it has a real call site to measure against.

## Consequences

- Every `LevelMeter` consumer (`BuiltinRecorder.tsx`, `ReadingControlBar.tsx`, `BoothView.tsx`) inherits the graded, segmented look without its own change, at every size it already uses.
- The peak-hold ballistics, throttled announcement and accessible `role="meter"` semantics (ADR 0360 Q2) are unchanged; only the visual fill construction moved from one DOM node with a flat colour to a masked gradient pair.
- The segment pitch is a documented approximation (the mock measures the bar's overall size, not its segment count); a future measurement that pins an exact pitch, or a vertical popover variant once Phase 13 has a real consumer, writes a new ADR superseding this one.
