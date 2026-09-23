# 0105. The visual suite drives each state once and resizes through the viewports

**Status:** Accepted (amends [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md): "each `{page, state, viewport}` is its own test")
**Date:** 2026-09-23

## Context

`quality / ui-visual` is the longest job on the critical path of a pull request and of a release (7 m 17 s in Prerelease
run 35796438255, 8 m 53 s on the pull request that started this; [CI pipeline speed](../prds/ci-pipeline-speed.prd.md)).
ADR 0023 made every `{page, state, viewport}` its own test, so each state was loaded and driven three times (four with the
Settings reflow width), once per viewport. Timing the capture on 138 of them (Home and Tracks) showed where a capture's own
time goes: loading the app 0.77 s, driving to the state 0.64 s, axe 0.45 s, settling, measuring, the screenshot and the
record 0.2 s together (medians, `scripts/ci/run-timings.mjs` for the job level). Loading and driving is two thirds of it,
and it gives the same state every time.

## Decision

1. `apps/ui/tests/visual/app.spec.ts` (vendored from `tools/ui-atlas-kit`, 0.3.5) makes **one test per `{page, state}`**
   (`<page> / <state>`). `lib/capture.ts`'s `captureAcrossViewports` loads the app at the first viewport, drives the state
   once, then for each viewport of the default matrix resizes, settles and makes the same captures and checks as before,
   in a `test.step` named after the viewport. Every viewport is captured and checked even when an earlier one fails, and
   the failure names the viewport. The screenshot path, the per-capture record and the end-of-run checks
   (`global-setup.ts`) are unchanged.
2. **A fresh load stays where a resize is not the same picture.** A row's `extraViewports` (the Settings reflow width,
   ADR 0061) always get a fresh load: below `md` the layout switches (the section tab strip scrolls to its active tab on
   load), which a resize from a wide window does not reproduce. A state whose driver freezes the page clock (the two toasts)
   reloads per viewport: axe lets time run again after the first shot, and Playwright's fake clock belongs to the browser
   context, so it cannot be frozen twice in one test; the test fails with that advice if such a row does not reload. A row with `reloadPerViewport: true`
   (`lib/types.ts`) keeps the old shape, a test per viewport on a fresh page each, and says why through the constant it
   spreads in `state-catalog.ts`: `TOOLTIP_CLOSES_ON_RESIZE`, `KEEPS_DESKTOP_SCROLL`, `POPUP_ANCHORED_AT_FIRST_WIDTH`,
   `LIVE_PROGRESS_MOVES_ON`, `FREEZES_THE_CLOCK`.
3. **Which rows reload was measured, not guessed.** The old suite and the new one ran on the same tree and every PNG was
   compared by hash. Two runs of the new suite differed on 2 captures (live playback and a failed-download state); those
   are noise. Of the rest, 24 rows differed at a resized viewport and now reload: 4 tooltips (closed by the resize), 18
   states whose driver scrolled something (a dialog body, a table, a tab strip) at desktop width, 1 selection popup, and
   proofing's running view (its progress had moved on). Eight rows differ only in a spinner or a level meter a few pixels
   across (a 7 x 9 px spinner, a 25 x 3 px strip in the read-aloud rows): a live animation caught at a different moment, not
   a different state. They share one load.

## Consequences

- A local run of the suite went from 4.9 to 3.2 minutes on the same machine (4 workers), with every capture, check and
  axe run still made. 124 of the 150 catalog rows are loaded and driven once instead of three or four times.
- A resize is not a fresh load. A new state whose picture depends on how it was reached at a width (a scroll offset, an
  open tooltip or popup, live progress) must get `reloadPerViewport`; the way to find one is the comparison above (run
  the suite with and without the flag on the row and compare its PNGs), and the kit's CHANGELOG (0.3.5) says so.
- `-g` selects a state, not one viewport of it: a viewport is a step. A `reloadPerViewport` row still has a test per viewport.
- A test now does three or four captures, so its timeout is the per-test timeout times the number of viewports.
- Undoing this means one test per viewport again: set `reloadPerViewport` on every row, or supersede this ADR.
