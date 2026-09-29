# 0585. Mock fidelity is a pixel match at the mock's own size and theme, scored by a tool that reports and does not gate

**Status:** Proposed (the owner set the 90% bar in D91 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); how the percentage is computed is this ADR's choice, for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510); the nav rail and header are also scored apart since [ADR 0636](0636-the-mock-match-tool-scores-the-nav-rail-and-header-apart-from-the-page.md))
**Date:** 2026-09-28
**Supersedes:**

## Context

On 2026-09-28 the owner found that merged pages don't line up with their approved mocks, mostly in style, and set a bar (D91 on #509): every screen or state an approved mock covers reaches **at least 90% pixel match** against it, captured at the mock's own size with the app driven to the mock's state. Before this, a pull request's Mockup check (D46) was a sentence per mock ("matches", "differs because…"), and the visual mockup divergence audit (deleted 2026-09-29, D96) found checks that described the wrong theme and "matches" rows that did not match.

A percentage needs a definition. Comparing two screenshots byte for byte fails on any sub-pixel text shift; comparing them by eye is what D46 already did. The visual suite deliberately has no pixel baselines ([ADR 0023](0023-visual-suite-capture-contract-and-storybook.md), [#153](https://github.com/countrymanprime/narration-utils/issues/153)), because two machines may rasterise differently; a score against a mock has the same limit, but it compares against a fixed picture, not against a previous run, and the bar is 90%, not 100%.

## Decision

1. **The score is pixelmatch's measure.** `apps/ui/tests/visual/mock-match/compare.ts` counts a pixel as matching when its YIQ colour difference from the mock's pixel is at most **0.1** of the largest difference (pixelmatch's default threshold), after blending by alpha onto white; a differing pixel that is anti-aliasing in either image (Vysniauskas's detector, as pixelmatch does) is forgiven. **Match % = matching pixels ÷ all pixels**, to two decimals. The algorithm is written out in the file (about 150 lines, pixelmatch is ISC) rather than added as a dependency.
2. **The capture is taken at the mock's own pixel size and in the mock's theme**, with the visual suite's own driver for the state (`tests/visual/mock-match/mocks.ts` names each approved mock's target state). A capture that is not the mock's size is cropped from its top left or padded with magenta, never scaled, so a size difference counts as different pixels. A mock that draws something that is not the app (mock 07 draws REAPER beside the companion) names the region of the mock that is compared.
3. **Ink match is reported beside it, never instead.** A mostly empty screen matches well on its background alone (Proof scores 89.55% against mock 04 although its notes table is drawn differently), so the tool also reports the match over the pixels that are not the page background in either image. The 90% bar is on match %, as D91 says; ink match helps read a score, and a later ADR may add a floor for it if the owner asks.
4. **The tool reports; it does not gate.** `pnpm --dir apps/ui mock-match` scores every approved mock with a target and writes `apps/ui/screenshots/mock-match/scores.md` and a diff picture per state (gitignored, as the visual suite's screenshots are). It passes whatever the scores are, so one run measures everything; `MOCK_MATCH_ENFORCE=1` fails a state under 90%, the setting a mock-fidelity phase runs for the states it owns. It is not in CI: the scores on `main` are under the bar today, and the pixels depend on the rasteriser (#153).
5. **Only approved mocks are scored.** The seven benchmark mocks (D69) and the per-PRD sets the owner approved on 2026-09-24 and 2026-09-27, less their `before` and `alt` pictures and the copies of the benchmark mocks. A mock of a page that was replaced (Home, the Manuscript page, the read-aloud dialog) is listed with the reason it is not scored.

## Consequences

- A Mockup check (D46) has a number: mock | capture | match % | remaining differences ([agent train](../operations/agent-train.md), D91), and the mock fidelity PRD holds the baseline.
- The number is lenient on sparse screens and strict on text: the mocks' sample data differs from the app's mock data (the benchmark's "names and numbers are invented"), so a state that draws the same components with different words still loses points. A phase that can't reach 90% because of data says so on #510, which D91 allows; a tooling limit is not a reason.
- Scores taken on different machines can differ by the rasteriser's anti-aliasing; forgiving anti-aliased pixels keeps that small, but a score near 90% should be re-run on the machine the PR's check was run on, and the PR says where.
- Changing the threshold, the anti-aliasing rule, the capture size rule or the gate is a new ADR that supersedes this one, and the PRD's baseline is re-run with the new rule.
