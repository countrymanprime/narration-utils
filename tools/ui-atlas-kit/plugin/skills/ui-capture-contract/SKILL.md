---
name: ui-capture-contract
description: Use when the same UI state produces different screenshots on identical code, before adding retries or sleeps to a visual test, or when changing the capture pipeline or considering pixel baselines.
---

# ui-capture-contract

## Why this exists

Measured on identical code, 9 of 244 screenshots differed between two runs of the reference suite (ADR 0023). Noise
is worse than annoying here: duplicates are found by exact bytes, so a capture that jitters can hide two states that
render the same, and a retry hides the jitter itself. The contract keeps a capture reproducible so that a difference
means the UI changed.

## When to use this

- Two runs on the same commit give different PNGs, or a capture fails intermittently.
- Someone proposes `retries`, `waitForTimeout`, a page-wide fake clock, or checked-in pixel baselines.
- Changing `lib/capture.ts`, `helpers/settle.ts`, the Playwright configs, or `.storybook/preview-head.html`. The first
  three are vendored (headed `ui-atlas-kit ... vendored`): change the kit template, then `ui-atlas sync`.

## What to do

1. Check the invariants still hold: `retries: 0` in both Playwright configs (a capture that passes on the second try is
   flaky, and a retry hides that); one test per `{page, state, viewport}` or `{story, theme, viewport}`; no
   `waitForTimeout` anywhere in `tests/`; `workers` capped (the app suite shares one dev server, and heavy parallelism
   causes `page.goto` timeouts, not byte diffs).
2. Check the capture sequence in `captureState` is intact and in order: set viewport, `goto('/')`, `settlePage`
   (injects CSS zeroing animation/transition/caret, `emulateMedia({ reducedMotion: 'reduce' })`, awaits
   `document.fonts.ready` and `networkidle`), the driver, `settleFrames` (fonts, then two animation frames raced
   against a 300 ms real-time cap so a frozen clock cannot hang it), park the pointer, then
   `page.screenshot({ animations: 'disabled', caret: 'hide', mask })`.
3. Park the pointer at `(width - 1, height - 1)` unless the row says `pointer: 'keep'`. A pointer left under a control
   paints its hover style, and whether that lands before the shot is a race. `keep` is only for states that show a
   hover or focus (tooltips), and those drivers must wait for the visible result.
4. Freeze timers per state, never page-wide: `freezeClock` (`page.clock.install()`, then `pauseAt(now + 10)`) only in the
   driver whose real timer races the shot (the 2.25 s toast). A page-wide fake clock stops React 19 transitions (the
   mobile drawer stopped closing after navigation). Mask genuinely live regions (clocks, playback position) with `mask`
   instead of freezing them.
5. Measure before fixing. Run twice and compare bytes:
   ```bash
   cd <ui-root>
   npx playwright test tests/visual
   cp -r screenshots/app screenshots/app-run1
   npx playwright test tests/visual
   diff -rq screenshots/app-run1 screenshots/app
   ```
   `ui-atlas init` adds `screenshots/` to `.gitignore`; check it is there. Each listed file is a nondeterministic capture. For one state, loop it and
   hash: `for i in 1 2 3 4 5; do npx playwright test tests/visual -g "<page> / <state>" && sha256sum screenshots/app/<page>/<state>/*.png; done`.
   For the atlas, do the same with `<pm> run atlas` and `screenshots/atlas`.
6. Attribute each unstable capture to a cause and fix it at the cause:
   - Hover or focus painted late: parked pointer, or `keep` with a wait for the tooltip/focus ring.
   - Scroll position: a driver that only checks `scrollY > 0` after a wheel delta has not fixed a position; scroll to a
     computed one (`scrollIntoView({ block: 'center' })`, as the formatted-text driver does) and wait for it.
   - Fonts: not loaded or swapped after the shot; `document.fonts.ready`, and remember webfonts fetched from the
     network (`preview-head.html`) make a capture depend on that request.
   - Timers and clocks: a state that changes with wall time; freeze that state only, or mask the region.
   - Motion: a transition or infinite animation still running; the injected CSS and `animations: 'disabled'` cover it,
     so a survivor is usually an element painted by script (canvas, JS-driven style), which needs a condition to wait for.
   - Data: the mock returning time- or order-dependent values; make the fixture deterministic.
7. Re-run step 5. A fix is done only when the second run's `diff -rq` is empty for that state.
8. Pixel baselines: not adopted in the reference (the suite is a validated camera, not a pixel diff), and Windows runs
   still showed sub-pixel anti-aliasing differences. If added, produce them only in a pinned Linux container with
   pinned fonts and browser, never on a developer machine. Do not add a diff tolerance to hide noise.

## What this skill is not

It does not decide whether a state is missing or misnamed (`ui-state-catalog`), write stories (`ui-story-authoring`),
or judge a design (`ui-visual-review`). It does not add CI (`ui-atlas-ci`). It never recommends retries, sleeps
or looser thresholds as the fix; those are the failure modes it exists to remove. The `ui-flake-doctor` agent is
meant to follow this playbook; this skill defines it.

## Lessons from the first six rollouts

- A fixed, rounded or shadowed element that flickers by one or two colour levels between identical runs is Chromium's
  partial raster. The scaffold and the vendored atlas config already launch with `--disable-partial-raster`; if a repo
  wrote its own config, add `launchOptions: { args: ['--disable-partial-raster'] }`. Measure it the way that found it: run the
  suite twice and diff the PNGs byte for byte.
- `net::ERR_ABORTED` is not a failed request: it is the browser cancelling a fetch the app abandoned (React StrictMode's
  dev double-effect). The vendored capture ignores it; every other failed request or HTTP >= 400 still fails the state.
- A third-party embed (a live map, chat widget, analytics) makes captures depend on someone else's server. Stub it in the
  optional `beforeCapture(page)` export of `tests/visual/app.drivers.ts`, which runs before the app loads.
- Renamed or removed states no longer leave stale PNGs behind: `global-setup.ts` prunes `screenshots/app/<page>/<state>`
  directories that are not in the catalog.
- Never rely on axe alone for contrast: it misses low-contrast text over semi-transparent overlays and gradients, and it
  runs on app states only when the project declares `axeDebt` (kit 0.3.4; `UI_AXE=1` measures without failing). Look at the
  dark theme with your eyes.

