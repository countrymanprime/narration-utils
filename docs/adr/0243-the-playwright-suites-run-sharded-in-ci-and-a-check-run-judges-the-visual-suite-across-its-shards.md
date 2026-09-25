# 0243. The Playwright suites run sharded in CI, and a check run judges the visual suite across its shards

**Status:** Accepted
**Date:** 2026-09-25
**Amends:** [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md) (the suite's run-wide checks run in its own teardown); decision D3 of [CI pipeline speed](../prds/ci-pipeline-speed.prd.md) ("fix per-test cost before sharding")

## Context

[ADR 0105](0105-the-visual-suite-drives-each-state-once-and-resizes-through-the-viewports.md) cut the visual suite's cost
per state (a local run went from 4.9 to 3.2 minutes over 150 catalog rows). Two days later the catalog had 260 rows, and
`quality / ui-visual` took 7 m 43 s in CI run 36095186043, about what it took before 0105. `quality / ui-atlas` took
6 m 33 s. They were the two longest jobs of a pull request. The CI pipeline speed PRD put sharding last (D3: fix the
per-test cost first, because sharding spends job slots and slots are what the queue is short of);
[ADR 0242](0242-a-pull-request-stacked-on-another-skips-the-playwright-suites-and-the-windows-build-until-it-targets-main.md)
and the merged `quick` job give back more slots than sharding spends. Larger GitHub runners are sold only to
organisations on the Team or Enterprise plans, and this repository belongs to a personal account.

The visual suite cannot simply be split: its teardown (`apps/ui/tests/visual/global-setup.ts`) fails the run on two
states that render identically and on a `sameAs` declaration that no longer holds, and a shard sees only a third of the
captures.

## Decision

1. `quality / ui-visual-shard` runs the visual suite on three runners (`--shard=i/3`, a matrix in
   `.github/workflows/_quality.yml`). Each shard's teardown judges its own captures (blank screenshots, the axe summary) and
   skips the comparisons across captures; the per-capture checks are unchanged. Each shard uploads `apps/ui/screenshots`
   with the hidden `.run` records. The first shard also runs the aria snapshots.
2. `quality / ui-visual` downloads every shard's screenshots and records into one `apps/ui/screenshots` and runs a
   **check run**: `UI_VISUAL_CHECK_RUN=1 playwright test tests/visual --pass-with-no-tests`. `apps/ui/playwright.config.ts`
   then selects no test and starts no server. The global setup keeps the records instead of clearing them, and the
   teardown judges all of them with every run-wide check. It also checks that every `{page, state, viewport}` the catalog
   drives has a record (`findMissingCaptures`), so a shard that never ran fails the check instead of passing unseen. The
   job runs when a shard failed and fails when any shard did. This is ui-atlas-kit 0.3.7 (vendored `global-setup.ts` and
   `lib/validators.ts`).
3. `quality / ui-atlas` runs on two runners (`--shard=i/2`). Each atlas test judges one story variant on its own, so it
   needs no check run.
4. The repository variables `PLAYWRIGHT_RUNNER` and `PLAYWRIGHT_WORKERS` set the runner label and Playwright's `--workers`
   for both suites (default `ubuntu-latest` and 4), so a larger runner is one setting away if the repository moves to a plan
   that has one.

## Consequences

- The visual suite's wall clock becomes the slowest shard plus the check run: about 3 minutes per shard (a local shard of
  119 tests on 4 workers took 170 s) and under a minute for the check run. The atlas halves to about 3.5 minutes.
- A full CI run still takes twelve job slots: the `quick` job absorbed five, and the shards and the check run add five.
  A pull request that leaves the UI alone still starts the shard jobs, which skip their steps after `nx-affected`, as the
  unsharded jobs did.
- A local `pnpm --dir apps/ui run screenshots` is unsharded and judges everything in its teardown, as before. A local
  sharded run needs the check run over the combined records to be complete.
- The screenshots of a run are the `ui-visual-screenshots` artifact of the `ui-visual` job (all shards, as a local run lays
  them out); each shard's own artifact, records included, lives one day.
- Undoing this means running the suites unsharded again (one job each, no check run); the check-run mode can stay, since
  an unsharded run never enters it.
