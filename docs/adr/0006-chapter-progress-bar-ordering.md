# 0006. Chapter progress bar ordered finalized-to-not-started, left to right

**Status:** Accepted
**Date:** 2026-09-17

## Context

The audiobook completion progress bar (`AudiobookEstimatePanel.tsx`) rendered its segments in `STATUS_ORDER` (`not_started, recording, editing, proofing, finalized`), left to right — meaning finished work appeared on the right and unstarted work on the left. The user wants it to read like a device-storage indicator: done/used space on the left, free/remaining space on the right.

## Decision

The segmented meter (now the `MeterBar` primitive, `shared/ui/src/components/primitives/MeterBar.tsx`) renders segments in whatever order its caller passes. `AudiobookEstimatePanel.tsx` reverses `STATUS_ORDER` specifically for this render call (`[...STATUS_ORDER].reverse()`). The shared `STATUS_ORDER` constant itself (`ChapterNav.tsx`) is **not** reversed, because it also drives the per-chapter status `<select>` and the legend, where chronological reading order (not-started → finalized) is still correct.

## Consequences

- Any future caller of `MeterBar` controls its own segment order; there is no implicit "correct" order baked into the component.
- If another UI needs the chronological order for a meter-style display, it should NOT reuse a reversed `STATUS_ORDER` — reverse at the call site as done here, keeping the shared constant's canonical order intact.
