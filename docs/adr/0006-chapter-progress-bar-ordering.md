# 0006. Chapter progress bar ordered finalized-to-not-started, left to right

- **Status:** Accepted
- **Date:** 2026-09-17

## Context and problem

The audiobook completion progress bar (`AudiobookEstimatePanel.tsx`) rendered its segments in `STATUS_ORDER` (`not_started, recording, editing, proofing, finalized`), left to right — meaning finished work appeared on the right and unstarted work on the left. The user wants it to read like a device-storage indicator: done/used space on the left, free/remaining space on the right.

## Decision drivers

- The user wants the bar to read like a device-storage indicator: done/used space on the left, free/remaining space on the right.
- The per-chapter status `<select>` and the legend still need chronological reading order (not-started → finalized).

## Considered options

1. Reverse `STATUS_ORDER` at the `AudiobookEstimatePanel.tsx` call site only
2. Keep the status quo: render segments in `STATUS_ORDER`, with unstarted work on the left
3. Reverse the shared `STATUS_ORDER` constant itself

## Decision outcome

**Chosen option: reverse `STATUS_ORDER` at the `AudiobookEstimatePanel.tsx` call site only**, because the bar should read like a storage indicator while the shared constant keeps the chronological order its other uses need.

The segmented meter (now the `MeterBar` primitive, `shared/ui/src/components/primitives/MeterBar.tsx`) renders segments in whatever order its caller passes. `AudiobookEstimatePanel.tsx` reverses `STATUS_ORDER` specifically for this render call (`[...STATUS_ORDER].reverse()`). The shared `STATUS_ORDER` constant itself (`ChapterNav.tsx`) is **not** reversed, because it also drives the per-chapter status `<select>` and the legend, where chronological reading order (not-started → finalized) is still correct.

### Consequences

- **Neutral:** Any future caller of `MeterBar` controls its own segment order; there is no implicit "correct" order baked into the component.
- **Neutral:** If another UI needs the chronological order for a meter-style display, it should NOT reuse a reversed `STATUS_ORDER` — reverse at the call site as done here, keeping the shared constant's canonical order intact.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Reverse the shared `STATUS_ORDER` constant itself

- Bad, because the constant also drives the per-chapter status `<select>` and the legend, where chronological reading order is still correct.
