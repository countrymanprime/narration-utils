# CI Pipeline Speed

**Source:** timings of the Prerelease run [35809927272](https://github.com/countrymanprime/narration-utils/actions/runs/35809927272) and the Prerelease and CI runs of 2026-09-22/23 around it (numbers below). No brief or PRD is replaced.

## Problem Statement

A pull request waits about 9 minutes for CI when the runners are idle, and a merge to `main` waits 13 to 14 minutes for its release candidate. When several pull requests are pushed together (a rebase sweep, a stack), the same work takes 25 to 55 minutes because jobs sit in GitHub's queue. The owner merges in bursts, so the slow case is the common case: feedback arrives after the context is gone, and a red `main` is found out a quarter of an hour late.

## Evidence

Uncontended Prerelease run [35796438255](https://github.com/countrymanprime/narration-utils/actions/runs/35796438255) (13 m 33 s):

| Job | Runner | Time | What dominates |
| --- | --- | --- | --- |
| `quality / ui-visual` | ubuntu | 7 m 17 s | `pnpm run screenshots`: 487 Playwright tests on 4 workers, 8.0 min in [35809927272](https://github.com/countrymanprime/narration-utils/actions/runs/35809927272); 3.5 to 7.9 s per test |
| `quality / ui-atlas` | ubuntu | 6 m 45 s | `pnpm run atlas`: 988 tests (story x light/dark x wide/narrow) on 4 workers, 5.8 min; the Storybook build itself is seconds |
| `Windows build and release` | windows | 6 m 8 s | `build-native` 5 m 29 s: `prepare-resources.py --clean` freezes the three Python sidecars with PyInstaller from scratch, then `wails build -nsis` and the smoke test |
| `quality / go` | windows | 2 m 42 s to 4 m 48 s | lint, race tests, `test-schedules`; `setup-toolchain` alone is 36 to 69 s (Go downloaded and unzipped each time) |
| `quality / js` | ubuntu | 2 m 18 s to 3 m 20 s | vitest 120 s over 125 files, then knip |
| 7 other jobs | mixed | 17 to 85 s each | `setup-toolchain` (13 to 36 s) is half of every one of them |

The Windows release job starts only when every `quality` job is green (`needs: [quality, ui-dist, version]`), so the critical path is **ui-visual then the Windows build, in series**: 7 m 17 s + 6 m 8 s.

Queueing, not compute, is the slow case. Job start offsets from the run's creation:

| Run | Wall clock | Jobs started after | Cause |
| --- | --- | --- | --- |
| [35796438255](https://github.com/countrymanprime/narration-utils/actions/runs/35796438255) | 13 m 33 s | 3 s | idle |
| [35804156705](https://github.com/countrymanprime/narration-utils/actions/runs/35804156705) | 25 m 16 s | 138 s, last at 1079 s | runner cap shared with ~15 PR runs |
| [35805559325](https://github.com/countrymanprime/narration-utils/actions/runs/35805559325) | 55 m 26 s | 1966 s, last at 3144 s | same |
| [35808623316](https://github.com/countrymanprime/narration-utils/actions/runs/35808623316) | 19 m 15 s | 632 s | waited on the `prerelease` concurrency group (previous run finished at 02:11:02, this one started 02:11:04) |

The repository is public on the free plan: 20 concurrent hosted jobs across the account. One CI run takes 13 job slots (12 quality/ui-dist + Build (Windows)), one Prerelease run 14. Two runs in flight fill the cap; the rebase sweep of 2026-09-23 01:55 to 02:12 created 20 CI runs, about 260 jobs, most of them cancelled after queueing for up to 10 minutes.

Deliberate constraints that stay:

- `--skip-nx-cache` in `nx-run`: "a green check must mean the checks ran". Test results are never restored from a cache.
- No retries (ADR 0023): a flaky capture fails the run.
- The visual suite and atlas are gates, not cameras (ADR 0060, 0064).

## Proposed Solution

Cut the critical path and the number of job slots, without caching test verdicts:

1. **Overlap the Windows build with quality.** The build needs only `ui-dist` and `version`; only publishing needs `quality`. Split the release job into *build* (starts at once, uploads `release-assets`) and *publish* (needs build and quality, attests, prunes, creates the prerelease). Critical path becomes max(ui-visual, build) + ~1 min.
2. **Make the two Playwright suites faster per test.** Visual: one navigation per `{page, state}`, then resize through the viewports in the same page, instead of a fresh page per `{page, state, viewport}` (487 tests become ~165 test bodies making the same captures and checks). Atlas: the same for the 4 theme x width variants of a story. Measure first; if navigation and state driving are not most of the per-test time, shard instead (Phase 5).
3. **Cache build outputs that are pure functions of their inputs.** The frozen PyInstaller sidecars are keyed on a hash of `sidecars/`, `libs/python`, `uv.lock` and `prepare-resources.py`; a hit skips the freeze. This caches a build artifact, not a test result, and the smoke test still runs on the packaged app every time. Same for the Go toolchain on Windows.
4. **Spend fewer job slots.** Fold the five sub-minute ubuntu jobs (`repo-scripts`, `ui-atlas-kit`, `docs-site`, `python`, `lua (ubuntu-latest)`) into one `quick` job that runs them as separate steps with `if: !cancelled()`, so one red step does not hide another. 13 slots per CI run become 9.
5. **Stop queuing superseded work.** Prerelease keeps `cancel-in-progress: false` for a run that is publishing; a pending run is already replaced by a newer push (GitHub keeps one pending run per group). Document that, and add `concurrency` with `cancel-in-progress: true` to the PR-triggered workflows that lack it.

On splitting into separately built and published libraries: see Decisions Log D1.

## Key Hypothesis

If the Windows build runs beside quality and the Playwright suites drop to about 4 minutes each, a merge to `main` produces its release candidate in about 7 minutes and a pull request goes green in about 5, and with 9 job slots per run instead of 13, two runs fit under the cap with room left before anything queues.

## What We're NOT Building

- **Restoring test results from any cache** (Nx Cloud, remote cache, "tested this tree before"). The `--skip-nx-cache` rule stays.
- **Splitting the repo or publishing internal libraries to npm, PyPI or a Go proxy** to "build only on change" (D1).
- **Paid or self-hosted runners.** Larger runners would help Playwright, but they cost money, and a self-hosted runner on a public repo runs untrusted fork code (see `docs/architecture/threat-model.md`). Revisit only if the free-tier changes are not enough (Open Question 3).
- **Dropping any check, viewport, story variant or axe run.** Every capture and assertion the suites make today is still made.
- **A pixel-diff gate.** Out of scope, as today.

## Success Metrics

Median of 5 runs each, idle runners, compared with the Evidence table:

| Metric | Today | Target |
| --- | --- | --- |
| Prerelease push to release published | 13 m 33 s | 8 min or less |
| CI pull request to all green (UI affected) | ~9 min | 5 min or less |
| `quality / ui-visual` job | 7 m 17 s | 4 min or less |
| `quality / ui-atlas` job | 6 m 45 s | 4 min or less |
| Windows `build-native` with sidecar cache hit | 5 m 29 s | 3 min or less |
| Job slots per CI run / Prerelease run | 13 / 14 | 9 / 10 |
| Checks run | all | all (no capture, story variant, axe run or test removed) |

## Open Questions

1. **Push-to-main scope.** Pushes to `main` run every project (`scripts/ci/nx-scope.sh`). Should they run only what the merge affects compared with the last green Prerelease commit? It would save most of the Prerelease quality time, but a squash merge is not the tree the PR tested (no merge queue), so it trusts the PR run for the untouched projects. Recommendation: no, keep full runs on `main`; Phase 1 already takes quality off the release's critical path. **Answered (owner, 2026-09-24): further than asked. `prerelease.yml` runs no quality jobs at all; the pull request's CI run is the gate, and the owner, the only one who can merge, decides whether a red one merges. Making those checks required is [#544](https://github.com/countrymanprime/narration-utils/issues/544).**
2. **Merge queue.** GitHub's merge queue would test the merged tree once and make the push run's quality redundant. It changes how the owner merges (and stacks). Worth it?
3. **Larger runners.** If Phases 3 to 5 land and ui-visual is still above 4 minutes, is a paid 8-core Linux runner for the two Playwright jobs acceptable?
4. **Release job split and provenance.** With build and publish split, the publish job attests the downloaded artifact by digest. Confirm that still meets the SLSA Build L2 claim in `docs/operations/ci-and-releases.md`, or keep attest in the build job and let publish only upload.

## Users & Context

The owner (sole maintainer) merging stacks of agent-authored PRs several times a day, and the agent sessions that wait on `gh pr checks` before they can report done. Both lose the most time in bursts: rebase sweeps and stacked merges.

## Solution Detail

**Must**

- Windows build runs in parallel with quality; publishing still waits for a green quality (Phase 1). Superseded by the answer to open question 1: the Prerelease has no quality jobs to wait for.
- Sidecar freeze cached on a content hash; smoke test unchanged (Phase 2).
- Visual suite captures all viewports of a state from one navigation (Phase 3).
- Every check that runs today still runs and can still fail the run.

**Should**

- Atlas groups a story's four variants into one test (Phase 4).
- The quick ubuntu jobs share one job (Phase 6).
- Go toolchain cached on Windows (Phase 2).

**Could**

- Shard ui-visual / ui-atlas across 2 jobs if Phases 3 and 4 miss the target (Phase 5).
- A `run-timings` script that prints the Evidence table for any run id, for regression tracking (Phase 0).

**Won't** (this PRD): see What We're NOT Building.

**MVP:** Phases 0 to 2. They take the Windows build off the critical path and shrink it, with no change to any test.

**Flow after the change (Prerelease):** push → `ui-dist`, `version`, the quality jobs and `windows-build` start together → `windows-build` uploads `release-assets` (~3 min on a cache hit) → quality finishes (~4 min after Phases 3 and 4) → `publish` attests, prunes, creates the prerelease and dispatches macOS/Linux (~1 min).

## Technical Approach

**Feasibility:** workflow YAML, the Playwright spec/driver layer, one cache step and a `--reuse` flag in `prepare-resources.py`. No product code changes.

**Architecture notes**

- *Build/publish split (Phase 1).* `prerelease.yml`: `windows-build` (`needs: [ui-dist, version]`, `if: release == 'true'`, runs `build-native`, uploads `release-assets/` and `narration-utils.exe`) and `publish` (`needs: [quality, windows-build, version]`, downloads them, attests, prunes, writes notes, `gh release create`, dispatches). `contents: write` and the attest permissions move to `publish` only, so the job that runs third-party build tooling no longer holds a write token: a threat-model improvement to record in `docs/architecture/threat-model.md`. `ci.yml`'s `Build (Windows)` already runs beside quality.
- *Sidecar cache (Phase 2).* `actions/cache` on each sidecar's PyInstaller output, key `sidecars-${{ runner.os }}-${{ hashFiles('sidecars/**', 'libs/python/**', 'uv.lock', 'scripts/release/prepare-resources.py') }}`. On a hit, `prepare-resources.py --reuse <dir>` copies instead of freezing. `THIRD-PARTY-NOTICES` reads the frozen tables of contents, so it works on cached bytes. Only `main` pushes save the cache (PRs only restore), so a PR cannot poison what a release is built from; record that in the threat model too.
- *Visual suite (Phase 3).* `app.spec.ts` generates one test per `{page, state}`; the body drives the state once, then for each viewport: `setViewportSize`, settle, the overflow / collapsed-control / axe checks, screenshot to the same path as today. Blank and duplicate detection in `global-setup.ts` reads the same files, so the gate is unchanged. Failures still name the viewport (`test.step` per viewport). Catalog rows with `extraViewports` (the Settings `reflow` width) and `pointer` keep working; states whose driving depends on the viewport (tablet navigation) opt out per row and keep a fresh page per viewport.
- *Atlas (Phase 4).* Same idea in `tests/atlas`: switch theme through Storybook globals and resize instead of reloading, where the story renders the same after a switch. `play()` mutates the story, so stories with one may still reload per variant.
- *Quick job (Phase 6).* One job, one `setup-toolchain` with Python and pnpm, a step per former job. Job names listed in `docs/operations/ci-and-releases.md` change; no ruleset requires them (per `_quality.yml`'s header).

**Risks**

| Risk | Mitigation |
| --- | --- |
| Resizing inside one page keeps state from the previous viewport (open menus, measured layouts) and hides a bug a fresh load shows | Run the old and new suites side by side on one PR and diff the PNGs; any difference is a finding. Rows can opt back into a fresh page |
| A stale sidecar cache ships old code | The key covers every input; the smoke test runs the packaged app every time; a `workflow_dispatch` input forces a cold freeze |
| Publishing from a separate job attests bytes other than the ones built | Attest by digest of the downloaded artifact and check it against the `.sha256` files `assets.mjs` wrote in the build job |
| The merged quick job hides a second failure behind the first | `if: !cancelled()` on every step |
| Renamed jobs confuse the owner or agents watching checks | Update `docs/operations/ci-and-releases.md` in the same PR |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Baseline | `scripts/ci/run-timings.mjs <run-id>` prints per-job and per-step times and queue offsets; profile one visual and one atlas test (navigation vs driving vs checks vs screenshot) | complete (profile: load 0.77 s, drive 0.64 s, axe 0.45 s, rest 0.2 s per capture; ADR 0105) | - | - | - |
| 1 | Build beside quality | Split `release` in `prerelease.yml` into `windows-build` and `publish`; write permissions only on `publish`; threat-model row | complete (the red-quality check is moot: open question 1 removed quality from the Prerelease) | with 2, 3, 4 | 0 | - |
| 2 | Cache the sidecar freeze and Go | Content-hash cache of PyInstaller output, `--reuse` in `prepare-resources.py`, saved on `main` only; Go toolchain cache on Windows (dropped, D4) | in-progress (implemented; cold vs hit comparison on one commit pending) | with 1, 3, 4 | 0 | - |
| 3 | Visual suite: one load per state | One test per `{page, state}` with a step per viewport; diff old vs new output once | in-progress (implemented, ADR 0105; 24 rows reload per viewport; local run 4.9 to 3.2 min; CI timing pending) | with 1, 2, 4 | 0 | - |
| 4 | Atlas: one load per story | Group a story's four variants; reload only where `play()` needs it | pending (not needed for the target now: the atlas is sharded in Phase 5; still worth doing if the shards grow past 4 min) | with 1, 2, 3 | 0 | - |
| 5 | Shard if still slow | Only if 3 or 4 misses 4 min: `--shard` across 2 jobs, merged report | in-progress (implemented, [ADR 0243](../adr/0243-the-playwright-suites-run-sharded-in-ci-and-a-check-run-judges-the-visual-suite-across-its-shards.md): visual 3 shards and a check run, atlas 2 shards; `PLAYWRIGHT_RUNNER`/`PLAYWRIGHT_WORKERS` for a larger runner; CI timing pending) | - | 3, 4 | - |
| 6 | Fewer job slots | Fold the five sub-minute ubuntu jobs into `quick`; cancel-in-progress on PR-triggered workflows; update `docs/operations/ci-and-releases.md` | in-progress (implemented: `quick`; stacked pull requests skip the Playwright suites and the Windows build until they target `main`, [ADR 0242](../adr/0242-a-pull-request-stacked-on-another-skips-the-playwright-suites-and-the-windows-build-until-it-targets-main.md); `ci.yml` already cancels in progress; CI timing pending) | with 1 to 4 | 0 | - |
| 7 | Steady state | Measure against Success Metrics; ADR for the build/publish split and the build-output cache rule; move the rules to `docs/operations/ci-and-releases.md`; delete this PRD | pending | - | 1 to 6 | - |

### Phase Details

- **0.** Without the profile, Phases 3 and 4 are guesses. If navigation plus state driving is under half of a test's time, go to Phase 5 for that suite instead.
- **1.** The biggest single win (~6 min off every release) with no test change. ~~Verify on a `workflow_dispatch` run that a red quality job leaves no release and no tag.~~ Moot since the Prerelease runs no quality jobs (open question 1).
- **2.** Check that a cache hit and a cold build on the same commit give the same sidecars (or explain the difference: PyInstaller embeds timestamps).
- **3.** Keep the layout `apps/ui/screenshots/app/<page>/<state>/<viewport>.png`: `CLAUDE.md`, `doc-screenshot-sync` and `visual-catalog-sync` depend on it.
- **6.** Last, because it renames jobs that the other phases' PRs are watched by.

### Parallelism Notes

Phases 1 and 2 both touch the Windows build but different files (`prerelease.yml` against `build-native` / `prepare-resources.py`). Phases 3 and 4 touch disjoint test trees. Phase 6 edits `_quality.yml`, which Phases 3 and 4 do not need.

### Parallel-session compatibility

| Phase | Files | Collides with |
| --- | --- | --- |
| 0 | `scripts/ci/run-timings.mjs` (new) | none |
| 1 | `.github/workflows/prerelease.yml`, `docs/architecture/threat-model.md` | any release-pipeline PR; the pipeline phases of [Release Readiness](release-readiness-provisioning-and-docs-site.prd.md) |
| 2 | `.github/actions/build-native/action.yml`, `.github/actions/setup-toolchain/action.yml`, `scripts/release/prepare-resources.py` | sidecar packaging changes (Moonshine provisioning in [Teleprompter Engines](teleprompter-engines-and-input-devices.prd.md)) |
| 3 | `apps/ui/tests/visual/app.spec.ts`, `app.drivers.ts`, `state-catalog.ts`, `global-setup.ts` | every UI PR that adds a catalog row (mostly a rebase, not a conflict) |
| 4 | `apps/ui/tests/atlas/**`, `apps/ui/playwright.atlas.config.ts`, possibly the vendored core in `tools/ui-atlas-kit` | the kit's drift check: change the kit and `apps/ui` together |
| 6 | `.github/workflows/_quality.yml`, `docs/operations/ci-and-releases.md` | any PR adding a quality job |

## Decisions Log

| # | Decision | Why |
| --- | --- | --- |
| D1 | Do not split the code into separately published packages (npm / PyPI / Go module) to build "only on change". | It is already one Nx monorepo with affected-only runs on PRs (`nx-run`, `nx-affected`). The slow jobs are not library builds: they are the Playwright suites over the whole UI and the Windows packaging, which any UI change or any release needs regardless. Publishing internal packages adds versioning, release and supply-chain surface (a registry the build trusts) and saves no time on those paths. The useful half of the idea, "don't rebuild what did not change", is Phase 2's content-hash cache of build outputs. |
| D2 | Cache build outputs, never test verdicts. | Keeps the `nx-run` rule that a green check means the checks ran; a cached build output is still exercised by the smoke test every run. |
| D3 | Fix per-test cost before sharding. | Sharding multiplies job slots, and slots are what the queue is short of. |
| D4 | No Go toolchain cache on Windows. | `setup-go` (v5.6.0, `cacheWindowsDir`) extracts Go to `D:` and leaves a junction in the `C:` tool cache, so an `actions/cache` of the tool cache stores the link, not Go. Doing it anyway means copying `setup-go`'s internals; revisit only if Phase 0's timings show `setup-toolchain` still costs a minute on the Windows jobs. |
| D5 | Shard the Playwright suites now (overrides D3). | The catalog grew from 150 to 260 rows in two days after Phase 3, and `ui-visual` was back at 7 m 43 s (run 36095186043). The slots sharding spends are paid for by D6 and the `quick` job. Larger runners were the alternative; GitHub sells them only to organisations on Team or Enterprise plans, so they stay a repository variable away (ADR 0243). |
| D6 | A stacked pull request skips the Playwright suites and the Windows build until it targets `main`. | On 2026-09-25 a five-deep stack started 40 CI runs in two hours, none green; the slow jobs' verdict on a child is against its parent's branch and is redone after the parent merges (ADR 0242). |
| D7 | The Go job stays one job. | Its Nx step was 4 m 10 s (lint 45 s, race tests 2 m 38 s, `test-schedules` 46 s); it ends with `Build (Windows)` anyway, so a split buys no wall clock for one more Windows runner. |

## Research Summary

- Job and step timings from the GitHub Actions API for Prerelease runs 35796438255, 35803076550, 35804156705, 35805559325, 35808623316 and 35809927272, and CI runs of 2026-09-23 01:47 to 02:12.
- Playwright summaries from the logs: visual 487 tests / 4 workers / 8.0 min; atlas 988 tests / 4 workers / 5.8 min; aria 12 tests / 14.9 s.
- GitHub-hosted runner limits for a public repository on the free plan: 20 concurrent jobs (5 macOS); ubuntu and windows runners have 4 vCPUs.
- Run 35809927272 was red for reasons unrelated to speed: `internal/manuscript` Go coverage 78.8% under its 79% floor, a knip finding, and one failed visual capture (`global / toast / desktop`). Its Windows release was skipped, as designed.
