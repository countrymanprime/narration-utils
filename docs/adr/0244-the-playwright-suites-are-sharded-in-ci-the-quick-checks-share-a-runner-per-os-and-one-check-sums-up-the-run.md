# 0244. The Playwright suites are sharded in CI, the quick checks share a runner per OS, and one check sums up the run

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** the owner

## Context and problem

After [ADR 0105](0105-the-visual-suite-drives-each-state-once-and-resizes-through-the-viewports.md) (one load per state),
`quality / ui-visual` was still the whole wait of a pull request that touches the UI. CI run 36130938887 (2026-09-25):

| Job | Time | Where it went |
| --- | --- | --- |
| `ui-visual` | 10 m 35 s | 356 Playwright tests on 4 workers, 9.4 min; the mock build 3 s; `aria` 26 s |
| `ui-atlas` | 7 m 17 s | 1068 tests on 4 workers, 6.4 min; the Storybook build 4 s |
| `go` (Windows) | 5 m 50 s | setup 73 s, lint 44 s, tests 161 s, `test-schedules` 45 s, one after another |
| `js` | 4 m 29 s | Vitest 213 s; lint, format and the import rules 24 s together |
| six more | under 1 m 20 s each | `setup-toolchain` about half of each |

The [CI pipeline speed PRD](../prds/ci-pipeline-speed.prd.md) put per-test fixes before sharding (D3: a shard costs a job
slot, and the free plan's 20 concurrent jobs are what a burst of pushes queues on) and made sharding its Phase 5 "if
Phase 3 or 4 misses 4 minutes". Phase 3 missed it by more than half. The owner asked for the suites to be sharded, the
jobs reorganised for parallelism, and one summary check (2026-09-25).

## Decision drivers

- `quality / ui-visual` was still the whole wait of a pull request that touches the UI (10 m 35 s).
- The CI pipeline speed PRD put per-test fixes before sharding (D3: a shard costs a job slot, and the free plan's 20 concurrent jobs are what a burst of pushes queues on).
- Sharding was Phase 5 "if Phase 3 or 4 misses 4 minutes", and Phase 3 missed it by more than half.
- The owner asked for the suites to be sharded, the jobs reorganised for parallelism, and one summary check.

## Considered options

1. Shard the Playwright suites, share a runner per OS for the quick checks, and sum up the run in one check
2. Keep the status quo: one job per suite
3. Split `js`'s lint steps into a job of their own

## Decision outcome

**Chosen option: shard the Playwright suites, share a runner per OS for the quick checks, and sum up the run in one check**, because `ui-visual` was still the whole wait of a pull request that touches the UI, and per-test fixes missed the 4-minute target by more than half.

`.github/workflows/_quality.yml` and `ci.yml`:

1. **The visual suite runs in three shards** (`ui-visual (shard i/3)`, `playwright test --shard=i/3`). The per-capture
   checks run in each shard as before. The checks that judge the whole run (a blank capture, two states identical without
   `sameAs`, a `sameAs` that no longer holds) can pair states in different shards, so a shard defers them
   (`UI_VISUAL_SHARDED=1`) and uploads its capture records, and the `ui-visual` job judges the merged records
   (`pnpm --dir apps/ui run visual:check-run`: `tests/visual/whole-run.check.ts` through `playwright.visual-run.config.ts`,
   no browser). It also fails if any capture the catalog expects has no record, so a lost shard cannot shrink what the
   duplicate checks compare. The checks live once, in `tests/visual/run-checks.ts`; an unsharded local run still applies
   them in `global-setup.ts`'s teardown. `aria` runs in shard 1.
2. **The atlas runs in two shards** (`ui-atlas (shard i/2)`). Each story is judged on its own, so nothing is merged.
3. **The sub-minute checks share a runner per OS**, a step each with `!cancelled()` so a red step does not hide the rest:
   `quick-ubuntu` (repo-scripts, docs-site, python, the REAPER harness) and `quick-windows` (the REAPER harness on Windows
   and Go lint). The Go tests are `go-test`, without lint in front of them.
4. **`js` stays one job.** Its lint steps are 24 s of 4 minutes; a job of their own would buy 24 s for a slot.
5. **One check sums up a CI run:** `CI passed` needs every other job, runs `always()`, and fails when any of them failed
   or was cancelled (skipped counts as passed). It is the check a ruleset should require (#544) instead of jobs by name.

### Consequences

- **Good:** Critical path of a pull request that touches the UI, estimated from the step times above: about 5 minutes (the Windows
  build and `go-test`), from 10 m 40 s; `ui-visual`'s shards are about 4 minutes and its merge about 40 s. A Go-only pull
  request loses about 45 s (lint off `go-test`). To be measured on real runs (`scripts/ci/run-timings.mjs`).
- **Neutral:** Job slots per CI run go from 12 to 14: five Playwright shards and the merge against four folded jobs and the kit's
  (ADR 0243). On a pull request that does not touch the UI, the shards stop after setup (about 25 s each) and the merge is
  skipped, so the extra slots are brief; a UI pull request holds them for about 4 minutes instead of one job for 10.
- **Neutral:** A job name a person or an agent watches changed: `ui-visual` is now the merge (the shards carry the captures and the
  screenshots artifacts, one per shard), `go` is `go-test`, and `repo-scripts`, `docs-site`, `python` and `lua` are steps
  of `quick-ubuntu` and `quick-windows`. `docs/operations/ci-and-releases.md` lists them.
- **Bad:** Requiring `CI passed` is not enough on its own: `ci.yml` skips documentation-only pull requests (`paths-ignore`), so a
  required `CI passed` would wait forever on them until that trigger changes.
- **Neutral:** Going back to one job per suite is removing the matrix and `UI_VISUAL_SHARDED`; the whole-run checks then run in the
  teardown as before.

### Confirmation

The `ui-visual` job judges the merged capture records (`visual:check-run`) and fails if any capture the catalog expects has no record; `CI passed` fails when any other job failed or was cancelled. The timings are to be measured on real runs (`scripts/ci/run-timings.mjs`).

## Pros and cons of the options

### Shard the Playwright suites, share a runner per OS for the quick checks, and sum up the run in one check

- Bad, because a shard costs a job slot, and the free plan's 20 concurrent jobs are what a burst of pushes queues on.

### Keep the status quo: one job per suite

- Bad, because `ui-visual` alone took 10 m 35 s, the whole wait of a pull request that touches the UI.

### Split `js`'s lint steps into a job of their own

- Bad, because its lint steps are 24 s of 4 minutes, so a job of their own would buy 24 s for a slot.
