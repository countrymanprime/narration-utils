# 0668. A flush Table inside a scrolling ancestor puts the bleed on the scroll wrapper, not the table

**Status:** Proposed (Phase 14 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P14 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** none (`Table`'s `flush` prop, [ADR 0605](0605-table-and-stage-grid-share-the-mocks-row-and-header-sizes-and-cells-sit-in-the-middle-of-the-row.md), did not anticipate a scrolling ancestor)

## Context

`Table`'s `flush` prop (Phase 3, ADR 0605) runs the table to a `Panel`'s edges with a negative margin read off the ambient `--panel-pad` custom property (`-mx-[var(--panel-pad,1rem)] w-[calc(100%+2*var(--panel-pad,1rem))]`), on the assumption that nothing between the table and the `Panel` body clips or scrolls. `master/PerFileChecks.tsx` is Phase 14's first real consumer of `flush`, and it sits inside `MasterQcPage.tsx`'s `tabIndex={0} overflow-x-auto` wrapper (needed so the table's own horizontal scroll, when a narrow window can't fit every column, is keyboard-reachable). Combining `Table flush` with that wrapper broke visibly: the wrapper's own box is the table's un-bled width, so the table's negative-margin bleed on both sides became unreachable overflow rather than a visual bleed - the left edge (`--panel-pad`, 16 px) was clipped outright (an `F` read as nothing, cutting "FILE" to "ILE"), and the right edge's matching extra width pushed real content (the Result column) past the visible, unscrolled area.

## Decision

When a flush table needs a horizontally-scrolling wrapper for narrow viewports, the wrapper carries the bleed (`-mx-[var(--panel-pad,1rem)] w-[calc(100%+2*var(--panel-pad,1rem))] overflow-x-auto`) and the `Table` itself does not take `flush` (it renders `w-full` inside the already-bled, already-scrollable wrapper). `Table`'s own `flush` prop is unchanged and still correct for the common case: a flush table with no scrolling ancestor of its own.

## Consequences

- `PerFileChecks.tsx` passes no `flush` prop; the bleed and the keyboard-reachable scroll both live in `MasterQcPage.tsx`'s wrapper, next to each other, so a future reader sees why.
- Any later page phase that wants a flush table inside a horizontally-scrolling region (Phase 15's script prep rail tables are a likely candidate) follows this same split rather than passing `flush` straight through and re-discovering the clipping bug.
- `Table`'s own component and its story are unchanged; this is a composition pattern for callers, not a primitive change.
- If `Table` later grows scroll-awareness of its own (an internal wrapper that owns both the bleed and the scroll), that removes the need for this pattern and supersedes this ADR.
