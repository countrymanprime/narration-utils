# 0105. The visual suite drives each state once and resizes through the viewports

- **Status:** Accepted
- **Date:** 2026-09-23
- **Related:** Amends [ADR-0023](0023-visual-suite-capture-contract-and-storybook.md): "each `{page, state, viewport}` is its own test"

## Context and problem

`quality / ui-visual` is the longest job on the critical path of a pull request and of a release (7 m 17 s in Prerelease
run 35796438255, 8 m 53 s on the pull request that started this; [CI pipeline speed](../prds/ci-pipeline-speed.prd.md)).
ADR 0023 made every `{page, state, viewport}` its own test, so each state was loaded and driven three times (four with the
Settings reflow width), once per viewport. Timing the capture on 138 of them (Home and Tracks) showed where a capture's own
time goes: loading the app 0.77 s, driving to the state 0.64 s, axe 0.45 s, settling, measuring, the screenshot and the
record 0.2 s together (medians, `scripts/ci/run-timings.mjs` for the job level). Loading and driving is two thirds of it,
and it gives the same state every time.

## Decision drivers

- `quality / ui-visual` is the longest job on the critical path of a pull request and of a release.
- Loading the app and driving to the state is two thirds of a capture's own time, and it gives the same state every time.
- A resized capture must be the same picture a fresh load would give, or the row reloads.

## Considered options

1. One test per `{page, state}`, driven once and resized through the viewports
2. Keep the status quo: one test per `{page, state, viewport}` (ADR 0023)

## Decision outcome

**Chosen option: one test per `{page, state}`, driven once and resized through the viewports**, because loading and driving is two thirds of a capture's own time and gives the same state every time.

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

### Consequences

- **Good:** A local run of the suite went from 4.9 to 3.2 minutes on the same machine (4 workers), with every capture, check and
  axe run still made. 124 of the 150 catalog rows are loaded and driven once instead of three or four times.
- **Bad:** A resize is not a fresh load. A new state whose picture depends on how it was reached at a width (a scroll offset, an
  open tooltip or popup, live progress) must get `reloadPerViewport`; the way to find one is the comparison above (run
  the suite with and without the flag on the row and compare its PNGs), and the kit's CHANGELOG (0.3.5) says so.
- **Neutral:** `-g` selects a state, not one viewport of it: a viewport is a step. A `reloadPerViewport` row still has a test per viewport.
- **Neutral:** A test now does three or four captures, so its timeout is the per-test timeout times the number of viewports.
- **Neutral:** Undoing this means one test per viewport again: set `reloadPerViewport` on every row, or supersede this ADR.

### Confirmation

Which rows reload was measured by comparing every PNG by hash between the old and the new suite on the same tree; a new state is checked the same way (run the suite with and without `reloadPerViewport` on the row and compare its PNGs). A row whose driver freezes the page clock fails its test, with that advice, if it does not reload.

## Pros and cons of the options

### Keep the status quo

- Bad, because each state is loaded and driven three times (four with the Settings reflow width), once per viewport.
