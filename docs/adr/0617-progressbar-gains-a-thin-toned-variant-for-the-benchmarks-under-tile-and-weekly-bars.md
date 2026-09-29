# 0617. ProgressBar gains a thin, toned variant for the benchmark's under-tile and weekly bars

**Status:** Proposed (Phase 9 of the mock fidelity PRD, stream F-P9 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** none

## Context

Mock B01 draws two bars `ProgressBar`'s single existing look (16 px, `--accent` on `--surface-3`) doesn't match:

- the meter under a `StatTile` value (Finished audio): ≈8 px, fully rounded, `--ok` fill on a `--surface-2` track;
- the "this week" rows (Booth hours booked, Voice rest): 306 × 6-8 px, rounded, `--accent` or `--warn` on `--surface-2`, not built anywhere in the app today.

`ProgressBar`'s existing 16 px accent bar has real, unrelated consumers with no mock evidence either way (`WorkDialog`, `MasterQcPage`, `MasterToSpecPanel`, `DeliveryPackagePanel`, `MultiPlatformExportPanel`, `DiagnosticsSection`, `LocalAssetRow`, `EditingCheckPanel`): changing its default risks a regression nothing in this PRD measured. The PRD's own wording, "ProgressBar gains `size="thin"` (8 px) and a `tone`," is additive.

## Decision

`ProgressBar` takes two new optional props, defaulting to today's look: `size?: 'default' | 'thin'` (`'default'` keeps 16 px on `--surface-3`; `'thin'` is 8 px on `--surface-2`) and `tone?: 'accent' | 'ok' | 'warn'` (`'accent'` keeps the existing fill; `'ok'`/`'warn'` fill with `--ok`/`--warn`). `StatTile`'s own progress meter passes `size="thin" tone="ok"` (ADR 0616). No existing call site changes its props, so every one keeps its current 16 px accent look; the "this week" bars have no consumer yet (Phase 11 builds Production's weekly panel) and are demonstrated only in `ProgressBar.stories.tsx`'s `Thin`/`ThinWarn` stories until then.

## Consequences

- The benchmark's two thin-bar looks are available to any future consumer (`StatTile` already uses one) without touching the nine existing full-width consumers or their mock-unmeasured look.
- `size`/`tone` join the primitive's public API; a caller that needs the mock's exact 306 px "this week" width still sets it via `className`, same as every other `ProgressBar` consumer does today.
- A future default-look change (for example, if a later phase's mock evidence covers the 16 px bar) writes a new ADR superseding this one.
