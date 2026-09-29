# 0636. The mock-match tool scores the nav rail and header apart from the page

**Status:** Proposed (Phase 8 of the mock fidelity PRD, stream F-P8b on [#509](https://github.com/countrymanprime/narration-utils/issues/509); which mocks are the chrome's spec is for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Amends:** [ADR 0585](0585-mock-fidelity-is-a-pixel-match-at-the-mocks-own-size-and-theme-scored-by-a-tool-that-reports-and-does-not-gate.md) (what the tool reports)

## Context

Phase 8 changes the shell that every page sits in: the rail goes from 224 to 216 px and the header from 56 to 52 px ([ADR 0635](0635-the-nav-rail-and-header-take-the-benchmark-sizes-and-every-header-chip-is-one-headerchip-primitive.md)). The first draft of the phase lowered the whole-screen score of 54 of the 81 scored states, and the tool could not say why. A whole-screen score mixes the chrome with the page under it, and a chrome change shifts every pixel of that page.

The coordinator's rule for the phase (#509) says the chrome must not score lower against a mock than before, and that a page that still differs is acceptable when a later phase owns it. To apply that rule, the tool has to measure the chrome on its own.

The scored mocks draw three different shells:

- The benchmark set (D69, D92) draws a 216 px rail and a 52 px header, with rules at x 215 and y 51.
- The 2026-09-24 sets were drawn from the app of that day. They show a 224 px rail at 1400 px and wider, the 56 px icon rail from 768 px, no rail below that, and a 56 px header.
- Some mocks draw no shell at all: the full-screen Booth (benchmark 03), the companion panel crop (07), and the read-aloud dialog sets.

These numbers were found by scanning each mock for full-length rules.

## Decision

1. **Chrome regions.** `tests/visual/mock-match/mocks.ts` `chromeRegions(mock, width, height)` gives the mock's own rail and header rectangles. The geometry is the mock's, never the app's, so a before and an after are measured over the same pixels. A mock with no shell, or one compared through a `mockRegion`, has no chrome regions. A header crop uses the geometry of the window it was cut from (`viewport`).
2. **Scored apart.** The spec crops the mock and the capture to each region (`compare.ts` `crop`) and scores the region with the same `compareImages`. The record and the table get **Rail %** and **Header %** columns next to the whole-screen match.
3. **The chrome's spec is the benchmark set** (`isChromeSpec`). Where a benchmark mock and a 2026-09-24 set draw the chrome differently, the benchmark mock wins (D92, the PRD's Q1). A chrome region that falls is marked **(fell)**, a regression, only on a benchmark mock. On an older set it is marked **(old shell)**: still measured and shown, but not counted as a regression.
4. **Before and after.** Each run also writes `scores.json`. `MOCK_MATCH_BASELINE=<an earlier run's scores.json>` adds each score's change since that run to the table: whole screen, rail and header. This is the before-and-after table that every phase's pull request reports (PRD, "Phases 1–10", step 4). The baseline file must live outside `screenshots/mock-match/`, because each run clears that folder.

The tool still reports and does not gate (ADR 0585). `MOCK_MATCH_ENFORCE` still applies only to the whole-screen bar.

## Consequences

- A shell change can now be judged by its chrome, apart from the pages under it. Phase 8's result: the rail and header rise on every benchmark mock except mock 01's rail (see ADR 0635 item 3). They fall on the 2026-09-24 sets, which draw the replaced shell.
- A page phase (11–15) reads its page's whole-screen score with the chrome's share visible beside it.
- Classifying the chrome of the 2026-09-24 sets as "old shell" is a judgement under D92, so it is listed on #510. If the owner rules otherwise, `isChromeSpec` is the one place to change.
- `src/mockMatch.test.ts` covers `crop`, the three shell geometries, the no-shell cases and the baseline marks.
