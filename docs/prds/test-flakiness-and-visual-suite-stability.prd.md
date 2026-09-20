# Test Flakiness and Visual Suite Stability

**Supersedes:** `docs/design/known-ui-defects.md` (the "Tooling limits worth knowing" section: axe on stories only, no pixel baselines, and the CI-flake bullet, which is stale and deliberately not carried, see Evidence item 1; the file's last revision is `b613933`, recover it with `git show b613933:docs/design/known-ui-defects.md`)

**Reconciled 2026-09-20** with the owner decisions of [implementation-plan.md](implementation-plan.md) section 1 (stack S07, tracking issue #80): D1 (Base UI will make `ConfirmDialog` an `alertdialog` later, so the driver helper that waits for a confirm dialog accepts both roles), D11 (the docs change to match the live repository settings: code-owner review is required and no status check is, so Phase 5 says that and lists only job names that exist in `.github/workflows`), D22 (every open question adopts its recommendation) and the layout move ([ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md)). Three facts changed since the evidence was taken: (1) the visual suite captures no phone viewport ([ADR 0037](../adr/0037-visual-suite-captures-no-phone-viewport.md)), so the nav-drawer heuristic of Evidence 5b no longer exists in `apps/ui/tests/visual/app.drivers.ts`; it survives only in the kit scaffold (Phase 3); (2) the `go` job of `_quality.yml` runs on Windows only, so the Go guard of Phase 4 runs there; (3) Phase 1 found and fixed a second source of full-suite frontend failures that the evidence did not name: Testing Library's own 1 s limit on `findBy*` and `waitFor` (Evidence 3). Phases 1 to 5 are the scope of stack S07 (each phase's `Status` cell says whether it has landed); phases 6 and 7 are tail phases (see the status footer).

## Problem Statement

On 2026-09-19, 9 of the 40 most recent CI and Prerelease runs (22.5%) failed for reasons unrelated to the code under review: a Go shutdown test, a Go import test, two timing-limited frontend tests, and the visual suite's own validation. The working rule became "re-run once before investigating", which trains the maintainer to ignore red, delays merges, and hides real regressions (one of the ten red runs that day was real). Two documented tooling limits (axe never sees app states; no pixel baselines) cap how much the gate can prove. The cost of not fixing it is a gate nobody trusts.

## Evidence

All counts below were taken from `gh run view --log-failed` on 2026-09-19 (runs between 05:10Z and 18:45Z) and from reading the code at `b9d348d`. Re-checked at `d5cc994` (main after #42): the visual suite, drivers, kit code, `apps/desktop/teleprompter_test.go` and the manuscript test are unchanged; `_quality.yml` gained a `github-scripts` job (#37/#38) and `apps/desktop/go.mod` moved for a Dependabot bump (#41), neither related to the failures below.

| # | Check | Observed | Root cause or symptom | State at HEAD |
| --- | --- | --- | --- | --- |
| 1 | Go `TestShutdownStopsARunningTeleprompterWithoutDeadlocking` (`apps/desktop/teleprompter_test.go:103`) | Failed on 4 runs (15:01 and 15:04 on both Go jobs, 16:51 main Prerelease ubuntu, 17:09 ubuntu), always at 1.01s with "the teleprompter session should be stopped after Shutdown" | **Root cause found and already fixed.** Before #30, `Service.Close` returned when the child process exited (`child.Done()`), but the `watch` goroutine recorded the final "stopped" phase afterwards, so `Shutdown` could return while `Busy()` was still true. It was not the 20s deadlock the test message describes. #30 (`0e703d5`, 17:19Z) added the `finished` channel closed after the final state is recorded and `Close` waits on it | Fixed by #30; pinned by Phase 4. The guard `go test -cpu 1,4 -count=5` (the `test-schedules` target) fails on the pre-#30 `service.go`: the root package's shutdown test fails on every `-cpu 1` run and the `internal/teleprompter` close test on most runs at both settings, while the root package passes 20 of 20 on the default scheduler, which is why the bug hid |
| 2 | Go `TestImportJobReportsRealProgressAndLogs` (`apps/desktop/internal/manuscript/service_test.go:94`) | Failed once (windows-latest, 05:12Z): `percent 100 elapsed 0` | Symptom: asserts `Elapsed > 0`, computed as `ended.Sub(started)` from plain `time.Now()` (`service.go:248,286`); a sub-tick commit reads 0 on a coarse clock. Hypothesis (medium confidence): coarse Windows monotonic resolution. No clock injection exists | Fixed in Phase 4 (option a). The mechanism is confirmed on this machine: consecutive `time.Now()` readings are equal 99.9997% of the time and the smallest step is 515 microseconds, so 2951 of 3000 tiny file writes measure exactly 0. The failing run itself did not reproduce here (0 of 300; the commit takes 2 to 6 ms against a 0.5 ms tick on this machine, and the CI runner's tick is coarser), so the fix does not depend on it: the integration test asserts `Elapsed >= 0` and a new test pins the arithmetic with fixed times |
| 3 | `App.test.tsx` (frontend) | 3 runs failed by timeout at Vitest's default 5000 ms (plus the PR #21 occurrence in project memory): "opens Review Entry as a read-only overlay..." (17:20Z) and "Story Bible has no stale detection notice..." (05:22Z, 17:39Z). Two different tests, not one | Symptom: `vite.config.ts` sets no `testTimeout`. Locally these run in 1.1s and 1.5s (whole file: 18 tests, 5.5s of tests), so CI is 3-5x slower under parallel files. Cause underneath: each mounts the full app to Story Bible (large `GuideDetail`) in jsdom | Addressed in Phase 1 (`testTimeout` 15 s). Phase 1 also measured the full frontend suite: 2 of 25 consecutive runs on a quiet 32-core machine failed with three `Unable to find ...` errors at about 1.1 s each (Testing Library's default `asyncUtilTimeout` of 1000 ms, not Vitest's 5 s); with `asyncUtilTimeout: 5000` there was 60 of 60 consecutive full runs passed (Decisions Log). `vi.waitFor` (one test) is Vitest's own and keeps its 1 s default |
| 4 | `ProjectPicker.test.tsx` "moves focus to the next remaining entry after removing a project" (assertion ~line 126) and its last-project sibling | Flaked once in a full local `pnpm check` (per project memory); passes alone | **Test-side race, root cause clear.** `ProjectPicker.tsx` moves focus in an effect that runs only after `busy` returns to false; `setRecents` and `setBusy(false)` can land in separate commits (its own comment says so). The test waits for the row to disappear, then reads `document.activeElement` synchronously, so it can run between the two commits | Fixed in Phase 1: before, 5 of 48 runs failed under CPU load; after, 174 of 174 passed under the same load (the second batch of 72 with the reviewed fix that also waits for the second remove button to be enabled before clicking it) |
| 5a | Visual suite validation on CI | 2 `ui-visual` runs today went red after "300 passed": `identical screenshots at small-desktop / tablet: home/default == manuscript/overlapping-highlights` plus `sameAs no longer holds ... overlapping-highlights ... reader-text-medium` (PR #34 17:37Z, main Prerelease 17:41Z; each was followed by a green run) | **Root cause:** the `manuscript/overlapping-highlights` driver is only `goToPage(page, 'Manuscript')`. `clickVisible` returns after the click and nothing waits for the destination; `settleFrames` waits two frames or 300 ms. The capture photographs Home. `proofing/setup-default` and `tracks/default` end the same way and share the exposure; `teleprompter/setup-default` waits for text | Fixed in Phase 2. Reproduced on demand: with the old drivers and `UI_CPU_THROTTLE=20` (page CPU 20 times slower) the run fails with exactly the CI message, and the PNGs of `manuscript/overlapping-highlights`, `proofing/setup-default` and `tracks/default` show a page that had not finished rendering (21% to 49% of pixels differ from the settled shot). With the new drivers at 20x all 18 captures of the affected states pass and every one of the 282 PNGs is identical to the unthrottled baseline |
| 5b | Visual suite locally (user's memory: ~36 states, mostly mobile, timing out on unmodified main) | Recorded while working on PR B | Verified in git: at `9cf9249` (PR B's base) `clickVisible` opened the hamburger immediately whenever `target.count() === 0`, so a page still rendering got the nav drawer opened over it, and its `fixed inset-0 z-[70]` backdrop then intercepted the click until the test timed out. #28 (`efd913f`, merged 16:51Z, after PR B branched) replaced it with a 1.5 s `waitFor` before opening the drawer (ADR 0023 lists it) | **Moot for the app drivers.** The suite has no phone viewport ([ADR 0037](../adr/0037-visual-suite-captures-no-phone-viewport.md)), so the nav drawer is never opened and `clickVisible` in `apps/ui/tests/visual/app.drivers.ts` has no drawer heuristic. It survives in the kit scaffold template only (Phase 3) |

Other facts:
- CI: `.github/workflows/_quality.yml` runs `go -C apps/desktop test -race ./...` on windows and ubuntu, `ui-visual` (`pnpm --dir apps/ui run screenshots`, ubuntu, 20 min, 300 tests in 3.8 min with 4 workers), `ui-atlas`, `ui-atlas-kit`, `js` (`pnpm --dir apps/ui test`). `playwright.config.ts` sets `retries: 0`. Locally `-race` cannot run here (no cgo), so the Go conclusions above were reproduced without it.
- **Reproduction of item 1:** a copy of `apps/desktop/` with the pre-#30 `service.go`, run at `GOMAXPROCS=1`, fails `-count=300` 300 of 300 times with the CI message; the current code passes 300 of 300 at `GOMAXPROCS=1` (and 40 of 40 by default). So a schedule-perturbation run (`-cpu 1`) would have caught it deterministically.
- Stale docs found: `docs/operations/ci-and-releases.md` describes checks (`CI / Conventional Commit title`, `CI / Linux quality`, `CI / Format and lint`, changed-file classification, path-based package-job skipping) that are not in the current workflows (`ci.yml` calls only `_quality.yml` and `_build-native.yml`; `grep` finds none of those names); it never mentions `ui-visual`, `ui-atlas`, `ui-atlas-kit` or the new `github-scripts`. The retired `known-ui-defects.md` cited ADR 0021 for the atlas (it is ADR 0023, and 0021 is the live-speech-engine ADR) and listed the Go flake as unexplained ("failed once on both Go jobs with no Go changes ... timing-sensitive"); both statements are wrong (it failed on 4 runs, and item 1 has a root cause) and are not carried. ADR 0023 still says "Tailwind 3" in its spike note (the repo is on Tailwind 4); harmless history.
- The 10th red run (18:25Z, `docsGuide.test.ts`, a broken link on a docs branch) was a real failure fixed on the next push; it is not counted as flake.
- Tooling limits (from the retired `known-ui-defects.md` and ADR 0023): axe runs on stories only (`tests/atlas/atlas.spec.ts`), so page-level contrast, labels and dialog roles are checked only by eye, and axe also cannot judge gradients or low-contrast text over semi-transparent overlays (as the register stated; not re-verified here). The gate is therefore "no page errors, no sideways overflow, no blank screenshot, no undeclared duplicate", not "looks identical" (ADR 0023: it "cannot say a layout looks right"); a reviewer opening the PNGs is still the only check for per-control layout, which is how the Settings collapse was found (`settings-mobile-layout.prd.md`); `axe-core` 4.13.0 is already in `node_modules` via `@storybook/addon-a11y`. Pixel baselines are not adopted: 9 of 244 screenshots differed between two runs of identical code on Windows; ADR 0023 says baselines must come from a pinned Linux container. CI's `ui-visual` already runs on `ubuntu-latest` but not in a pinned image.
- Cross-reference: `docs/architecture/host-binding-concurrency.md` (the delivered host binding work) covered unlocked service-pointer reads in `apps/desktop/bindings.go`, now all read through `h.services()`. Item 1 does **not** share that root cause: `Host.Shutdown` already snapshots `h.teleprompter` under `RLock`, and the failure was an ordering bug inside `teleprompter.Service`, not a data race (and the test never tripped the race detector).
- Assumption - needs validation: run counts above cover one busy day and may overstate the steady-state rate; recompute from `gh run list` before setting the target.

## Proposed Solution

Fix each root cause instead of adding retries: make the visual drivers wait for their destination and open the nav drawer deterministically; correct the two frontend tests (wait for focus; a timeout policy for full-app tests); pin the Go failure class with a schedule-perturbation CI step and repair the wall-clock assertion; make the CI docs truthful. Then close the tooling gaps in order of value: measure axe on app states, and spike (not adopt) pixel baselines in a pinned container once the suite is stable.

## Key Hypothesis

We believe removing the identified root causes rather than re-running will bring non-code CI failures from about 22% of runs to under 2%, for the maintainer who merges on green. We'll know we're right when 50 consecutive CI and Prerelease runs (or 30 days) show no flake-attributed red, the visual suite passes a local Windows mobile run without timeouts, and `go test -cpu 1,4` on the teleprompter tests passes 100%.

## What We're NOT Building

- Test retries or a quarantine list - ADR 0023 decided "no retries" because a retry hides exactly this class of flake.
- Production Go changes for item 1 - already fixed by #30; only a guard and a clearer test message.
- Pixel-diff baselines now - a timeboxed spike only, after stability is proven (Open Questions).
- Page-wide fake clocks or `waitForTimeout` sleeps - ADR 0023 forbids them.
- A rewrite of `App.test.tsx` or `GuideDetail` for render cost - out of scope; a timeout policy is the fix here.
- The host-binding data-race fix (other PRD).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Flake-attributed red CI runs | Baseline 9 of 40 (22.5%); target 0 in 50 consecutive runs (or under 2% over 30 days) | `gh run list` + `--log-failed`, classified as in Evidence |
| Go shutdown class | `go test -cpu 1,4 -count=5 -run 'Teleprompter\|Shutdown\|CanAttach'` passes 100% on Windows (the only Go CI job) | New CI step (`test-schedules`) |
| Full-app frontend timeouts | 0 over 50 runs, whether Vitest's `testTimeout` or Testing Library's `asyncUtilTimeout` | CI history; 30 consecutive local full runs in Phase 1 |
| `ProjectPicker` focus tests | Pass 100 of 100 in a loop with CPU stress (before: 5 of 48 failed; after: 174 of 174) | Local loop |
| Visual driver determinism | 0 `identical screenshots` / stale `sameAs` failures in 50 runs; one local full visual run without click timeouts (no phone viewport, ADR 0037) | CI history; one manual run |
| Suite cost | No increase in `ui-visual` time | Job duration (3.8 min baseline) |
| Docs truthful | `ci-and-releases.md` names only workflows/jobs that exist | Review against `.github/workflows` |
| App-state axe baseline | Number of violations across 300 captures measured and recorded | One measured run |

## Open Questions

- [x] **1. Timeout policy for full-app frontend tests.** Options: (a) global `test.testTimeout: 15_000` in `vite.config.ts` (default 5 s is a unit-test value); (b) per-test timeouts only on the tests that mount Story Bible; (c) reduce render cost. Recommendation: (a), with `slowTestThreshold` left as is so genuine slowdowns stay visible. A per-test override hides the next test that gets slow on CI. **Decided (D22): (a).** `test.testTimeout: 15_000` in `vite.config.ts`, `slowTestThreshold` untouched. Phase 1 added `configure({ asyncUtilTimeout: 5_000 })` in `src/test-setup.ts` beside it, because Testing Library's own 1 s limit was the failure that actually showed up (Evidence 3).
- [x] **2. How should drivers navigate?** Options: (a) UI-driven as today, but deterministic: open the drawer only when the `Open navigation` button is visible (it is `max-md:inline-flex`), scope nav clicks to the nav, never open the drawer for in-page clicks, then wait for the destination; (b) keep the heuristic and raise 1.5 s; (c) navigate by URL (`page.goto('/manuscript')`). Recommendation: (a). The driver file states the suite is driven through real UI interaction; (c) would also re-enter the Manuscript deep-link effect that ADR 0023 says once looped. Callers that use `clickVisible` for nav items ("Home" in `navigate-away-confirm`, `theme-light`, `theme-dark`) must move to the nav helper. **Decided (D22): (a), built in Phase 2.** UI-driven and deterministic: nav clicks are scoped to the navigation `aside`, and every `goToPage` waits for the destination `h1`. The drawer half of the option is moot for the app drivers (no phone viewport, ADR 0037): the planned `clickNav` fails loudly if the "Open navigation" button is ever visible instead of guessing.
- [x] **3. What counts as "arrived"?** Options: the page's `h1` (`Heading`), `aria-current="page"` on the nav item, or a new `data-page` attribute. Recommendation: `getByRole('heading', { level: 1, name })` (Home is "Welcome back"); no app change needed, and it is what `App.test.tsx` already relies on. **Decided (D22): the level-1 heading** by role and exact name; no app change.
- [x] **4. Go guard for item 1.** Options: (a) add a CI step running the teleprompter/shutdown tests under `-cpu 1,4` and rewrite the misleading `t.Fatal` text; (b) only rewrite the text; (c) nothing, it is fixed. Recommendation: (a): it costs seconds and would have failed deterministically on the buggy code. **Decided (D22): (a), built in Phase 4.** A `test-schedules` Nx target of `narration-utils-shell` run by the `go` job (Windows, the only Go job) plus the clearer message.
- [x] **5. Wall-clock assertion in the manuscript test (item 2).** Options: (a) assert `Elapsed >= 0` (the intent is that the field is reported); (b) inject a clock into `Service`; (c) sleep briefly in the test's commit step. Recommendation: (a) unless reading `service.go` shows a clock seam already exists (none seen). Confirm the coarse-clock hypothesis first (TBD - needs a Windows run with `-count=200`). **Decided (D22): (a), built in Phase 4**, after confirming the coarse-clock hypothesis (Phase 4 records how).
- [x] **6. Axe on app states.** Options: (a) inject `axe-core` in the kit's `capture.ts`, report violations per capture, gate with an app-state debt ratchet like `A11Y_DEBT`; (b) a separate opt-in run (`UI_AXE=1`) that only reports; (c) skip. Recommendation: (b) first to measure the baseline (TBD count), then (a). Sequence after the dialog and palette PRDs, otherwise the first baseline is dominated by defects they are about to fix. Trace retention on failure and aria snapshots are not part of this PRD; they are Phases 11 and 12 of `verification-and-code-health-tooling.prd.md` (retries stay at 0 per ADR 0023). **Decided (D22): (b) then (a).** Queued as Phase 6 until the palette stack (S12) and a kit slot (S13 tail); nothing is built here.
- [x] **7. Pixel baselines.** Options: (a) keep ADR 0023's decision and defer; (b) a timeboxed spike: run `ui-visual` in a pinned Playwright container image on CI, store baselines outside the repo (artifact or orphan branch; committing about 300 PNGs bloats history), a manual "update baselines" workflow, a tolerance; (c) adopt fully. Recommendation: (a) now, (b) only after 50 stable runs, decision recorded as an ADR either way. **Decided (D22): (a) now.** Phase 7 stays a deferred spike (after 50 stable runs); the decision is recorded as an ADR either way.
- [x] **8. Kit changes and release cadence.** Phase 3 (scaffold parity) and Phase 6 (axe) change `tools/ui-atlas-kit` and need a version bump; `settings-mobile-layout.prd.md` Phase 2 also bumps the kit. Options: bundle into one kit release; or serialize. Recommendation: serialize, settings PRD first (it is smaller), then these. **Decided (D22): serialize.** Phase 3 bumps the kit to 0.3.2 in this stack; the settings-mobile-layout PRD (S12) and Phase 6 take the next versions after it.
- [x] **9. Does item 1 belong to the host-binding PRD?** Options: (a) unrelated, close it here (recommended by the evidence); (b) fold the `-cpu` guard into the host-binding PRD's `-race` work. Recommendation: (a), and mention the guard to that PRD's owner. **Decided (D22): (a).** Unrelated to the host-binding race (already delivered as [host-binding-concurrency](../architecture/host-binding-concurrency.md)); closed here.

## Users & Context

**Primary User**
- **Who**: the maintainer/developer who merges on green (the user), and agent sessions that must interpret a red run.
- **Current behavior**: re-runs red jobs once before looking; local Windows visual runs time out or need a fix-up; docs describe checks that do not exist.
- **Trigger**: every PR and every push to main.
- **Success state**: red means a real problem; one green run is enough.

**Job to Be Done**: When CI turns red, I want to know it is real without re-running it.

**Non-Users**: narrators are not affected (test-only and docs changes; no runtime behaviour changes).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | `ProjectPicker` tests wait for focus; timeout policy for full-app tests |
| Must | Visual drivers: deterministic nav helper and destination waits (`overlapping-highlights`, `setup-default`, `tracks/default` and every bare `goToPage`) |
| Must | Go schedule-perturbation step and clearer shutdown test message; manuscript elapsed assertion fixed |
| Should | Truthful `ci-and-releases.md`; the suite-limits statement in `docs/design/design-system.md` kept current as Phases 6 and 7 land |
| Should | Kit scaffold parity for the driver fix; measured axe baseline on app states |
| Could | Axe gate with app-state debt ratchet; pixel-baseline spike and ADR |
| Won't (here) | Retries; quarantine; render-cost refactor; production Go changes |

### MVP Scope

Phases 1, 2 and 4. Phases 3, 5, 6, 7 follow.

### User Flow

1. A developer pushes; CI runs; a red job is a real failure with a message that names the state or test.
2. Locally on Windows, `pnpm --dir apps/ui screenshots` completes without nav-drawer timeouts.
3. A new driver that forgets to wait for its page fails loudly (its own arrival wait) instead of producing a duplicate screenshot.

## Technical Approach

**Feasibility**: HIGH. Every fix is small and local; the only coordination cost is the shared kit release and the shared `_quality.yml`.

**Architecture Notes**
- Drivers (`tests/visual/app.drivers.ts`, project-owned): replace `clickVisible`'s drawer heuristic with `openNavIfCollapsed()` = `if (await hamburger.isVisible()) await hamburger.click()`, used only by a `clickNav(name)` helper that `goToPage` calls; in-page `clickVisible` becomes a plain `getByRole(...).click()` with Playwright's own auto-wait. `goToPage` then waits for the destination `h1`. Home needs a real navigation helper because `goToPage('Home')` is a no-op today. Waits stay condition-based (ADR 0023). `state-catalog.ts` rows and `sameAs` declarations are unchanged.
- Kit scaffold: `tools/ui-atlas-kit/plugin/templates/scaffold/tests/visual/app.drivers.ts` carries the same `clickVisible`; scaffold files are not synced, so this is a template fix plus a `CHANGELOG.md` "Adopt by hand" line and a version bump.
- Frontend: `ProjectPicker.test.tsx` uses `await waitFor(() => expect(document.activeElement).toBe(...))`; grep the other tests for a synchronous assertion straight after a `waitFor` on a different condition. `vite.config.ts` gains `test.testTimeout`.
- Go: a `test-schedules` Nx target of `apps/desktop/project.json` (`go test -cpu 1,4 -count=5` over the root package's teleprompter, shutdown and can-attach tests and the `internal/teleprompter` package), added to the `go` job's targets in `_quality.yml` (the `-race` test target stays); `teleprompter_test.go` failure text corrected to describe Shutdown returning while the session is still busy; `service_test.go` assertion per Q5, plus a fixed-time arithmetic test and a check that a finished job stops its clock; `knip.jsonc` lists the `go` binary.
- Axe on app states: `capture.ts` (kit core) could `page.addScriptTag` from `axe-core` and run `axe.run`, appending violations to `problems`; start report-only.
- ADR 0023 remains the governing contract; an ADR is only needed for the pixel-baseline decision or an axe gate.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Deterministic nav breaks a driver that relied on the old fallthrough | Medium | Run the whole suite locally and on CI; audit every `clickVisible(..., 'Home'|nav)` caller |
| Destination `h1` differs per page or is not unique | Low | Read the page components; use `level: 1` and exact name; `Heading` is the shared source |
| Raising `testTimeout` hides a real hang | Low | 15 s still fails hangs; keep `slowTestThreshold` reporting |
| Local Windows suite still slow or flaky for other reasons | Medium | One measured local run before claiming item 5b fixed (TBD) |
| Kit release collisions | Medium | Serialize per Q8 |
| Axe baseline is large and noisy | High | Report-only first; sequence after the dialog and palette PRDs |
| Pixel baselines drown in noise or repo bloat | High | Spike only, external storage, after stability |
| Flake rate figures are one day's sample | Medium | Recompute before setting targets |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Frontend test hygiene | `ProjectPicker` focus waits (+ scan for the same pattern), `test.testTimeout` and Testing Library `asyncUtilTimeout` for full-app tests | complete | Yes | - | [plan](implementation-plan.md) |
| 2 | Visual driver determinism | Deterministic nav helper, destination waits for every bare `goToPage`, Home navigation helper, `UI_CPU_THROTTLE` stress mode; verified locally under CPU throttle (there is no mobile run: no phone viewport) | complete | Yes | - | [plan](implementation-plan.md) |
| 3 | Kit scaffold parity | `clickVisible` is a plain click, `clickNav` opens the drawer only when the menu button is showing, `beforeCapture` carries `UI_CPU_THROTTLE`; skill wording, changelog, kit 0.3.2 | complete | No | 2 | [plan](implementation-plan.md) |
| 4 | Go flake guard and wall-clock test | `test-schedules` Nx target (`-cpu 1,4 -count=5`) run by the `go` job, clearer shutdown test message, manuscript `Elapsed` assertion fix and a fixed-time arithmetic test | complete | Yes | - | [plan](implementation-plan.md) |
| 5 | CI docs truthfulness | Rewrite the CI section of `ci-and-releases.md` to match the live settings (no required status check, code-owner review required, D11) and the job names that exist, add the flake policy, keep the suite-limits statement in `design-system.md` current (axe on stories only until Phase 6; no pixel baselines until Phase 7) | complete | Yes | 1, 2, 4 | [plan](implementation-plan.md) |
| 6 | Axe on app states | Report-only measured run, then a gate with an app-state debt ratchet if the user agrees | pending (tail: after the palette stack S12 and a kit slot, the S13 tail) | No | 2, 3 | - |
| 7 | Pixel baseline spike | Timeboxed spike in a pinned container; ADR adopt or defer | deferred (starts only after 50 consecutive stable CI runs, counted from the merge of this stack) | Yes (docs-only) | 1, 2, 4 plus 50 stable runs | - |

### Phase Details

**Phase 1 - Frontend test hygiene.** Goal: two frontend flake sources closed. Scope: `ProjectPicker.test.tsx` (both focus tests), `vite.config.ts` `test.testTimeout`, a grep for `expect(document.activeElement)` after a non-focus `waitFor`. Success signal: `ProjectPicker` tests pass 100 of 100 under CPU stress; `App.test.tsx` no longer times out at 5 s on a throttled run; `pnpm --dir apps/ui test` green.

**Phase 2 - Visual driver determinism.** Goal: drivers cannot photograph the wrong page or open the drawer over a rendering page. Scope: `tests/visual/app.drivers.ts` only (plus `state-catalog.ts` only if a `sameAs` reason text changes). Success signal: CI `ui-visual` green three times in a row with no validation failures; a local Windows run of `npx playwright test tests/visual -g "mobile"` completes with no nav-drawer timeouts; wall time not worse. Verify per CLAUDE.md that screenshots still show the intended states (spot check PNGs at all four viewports for the three affected states).

**Phase 3 - Kit scaffold parity.** Goal: repos scaffolded from the kit do not inherit the heuristic. Scope: `tools/ui-atlas-kit/plugin/templates/scaffold/tests/visual/app.drivers.ts`, `plugin/skills/ui-state-catalog/SKILL.md` wording, `CHANGELOG.md`, version files. Success signal: kit tests (`node --test tools/ui-atlas-kit/test/*.test.mjs`) green.

**Phase 4 - Go flake guard and wall-clock test.** Goal: pin the fixed class and remove the second flake. Scope: `apps/desktop/project.json` (the `test-schedules` target), `.github/workflows/_quality.yml` (`go` job), `apps/desktop/teleprompter_test.go` (message only), `apps/desktop/internal/teleprompter/service_test.go` (one wait, see the Decisions Log), `apps/desktop/internal/manuscript/service_test.go`, `knip.jsonc` and the target table of `ci-and-releases.md`. Success signal: the new target passes on Windows (the only Go job); running the buggy `service.go` under it fails (demonstrated once in the PR description, not committed).

**Phase 5 - CI docs truthfulness.** Goal: the docs describe what CI does. Scope: `docs/operations/ci-and-releases.md` (CI section; list `quality` jobs `js`, `ui-visual`, `ui-atlas`, `ui-atlas-kit`, `github-scripts`, `python`, `lua`, `go` and the native build; `paths-ignore: docs/**, **/*.md` on PRs), and the suite-limits statement in `docs/design/design-system.md` (the retired defects register's tooling limits, restated there as current-state facts). Docs-only PRs skip CI by `paths-ignore`, so review by reading.

**Phase 6 - Axe on app states.** Goal: page-level accessibility is visible to the gate. Scope: kit core `capture.ts` (and a debt file for app states) via kit release and `ui-atlas sync`. Success signal: a recorded baseline count; if gated, the debt list can only shrink.

**Phase 7 - Pixel baseline spike.** Goal: decide on evidence. Scope: a branch and a docs-only ADR; no gate change. Success signal: an ADR that adopts with a concrete storage and update design, or defers with the measured noise.

### Parallelism Notes

Phases 1, 2, 4 have disjoint files and can run concurrently. Phase 3 follows 2 and shares the kit release with other PRDs. Phase 5 is the last docs step for what has landed. Phase 6 waits for the dialog and palette PRDs (recommended) and a kit slot.

### Parallel-session compatibility

Files owned: `apps/ui/tests/visual/app.drivers.ts`, `apps/ui/src/components/project/ProjectPicker.test.tsx`, `apps/ui/vite.config.ts` (`test` block only), `apps/desktop/teleprompter_test.go` (message), `apps/desktop/internal/manuscript/service_test.go`, `.github/workflows/_quality.yml` (`go` job step; and `ui-visual` only for Phase 6), `tools/ui-atlas-kit/plugin/templates/scaffold/**` and `.../core/tests/visual/lib/capture.ts` (Phases 3 and 6), `docs/operations/ci-and-releases.md`, the suite-limits paragraph of `docs/design/design-system.md`, the Status cells of this PRD's phase table. Does NOT touch any primitive, `styles.css`, `Settings.tsx`, or `ScopedSetting.tsx`.
- Can run concurrently with: the dialog, a11y-components and palette PRDs (disjoint), the settings-layout PRD's Phase 1, and the delivered host binding concurrency work (`apps/desktop/app.go`, `apps/desktop/bindings.go`; this PRD edits only test files there).
- Do not run concurrently with: the settings-layout PRD's Phase 2 (kit release and `capture.ts`) or with this PRD's own Phases 3 and 6; any PRD adding visual states or drivers (`teleprompter-*`, `review-dashboard-*`, `diagnostics-*` add rows to `state-catalog.ts` and `app.drivers.ts`) should land its drivers after Phase 2 or rebase onto the new helper.
- Generated/shared files that always conflict: `docs/design/design-system.md` (other PRDs edit other rows), the kit version files and `CHANGELOG.md`, `.github/workflows/_quality.yml` if two phases edit it at once.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| The visual suite is a gate: no retries, waits are conditions, no page-wide fake clock (prior decision, ADR 0023) | Fix root causes; add no retries or sleeps | Retries, `waitForTimeout` | A retry hides the flake |
| Pixel baselines only from a pinned Linux container, not a developer machine (prior decision, ADR 0023) | Defer; spike after stability | Windows baselines | Sub-pixel drift measured at 9 of 244 |
| `sameAs`/`undriven` escapes need a real reason; fix the UI or the driver (prior decision, CLAUDE.md, ADR 0023) | Fix the driver | New `sameAs` | The pair was a driver race, not a true duplicate |
| Drivers use real UI interaction with accessible-name selectors (prior decision, `app.drivers.ts` header) | Keep UI-driven navigation | Navigate by URL | Q2 |
| Vendored suite files are edited in the kit, then synced (prior decision, kit header) | Kit change for axe and scaffold | Edit vendored files | Avoids drift failure |
| Re-run-once folk practice for flaky tests (working practice, project memory) | Retire once metrics hold | Keep | Trust in red |
| Nothing merges without the user (prior decision, CLAUDE.md) | One PR per phase | - | - |
| Shutdown flake is closed by #30; add a schedule-perturbation guard (proposed) | Option (a) of Q4 | Do nothing | Cheap, deterministic |
| Not a shared root cause with the host-binding data race (proposed, from evidence) | Unrelated | Fold in | Q9 |
| Global `testTimeout` of 15 s (proposed) | Option (a) of Q1 | Per-test overrides | Uniform CI slowness |
| Deterministic nav helper with destination waits (proposed) | Option (a) of Q2 | Bigger heuristic; URL navigation | Removes the race |
| Testing Library `asyncUtilTimeout` of 5 s beside the 15 s `testTimeout` (phase 1, measured) | Both set once, in `test-setup.ts` and `vite.config.ts` | `testTimeout` alone; per-test `{ timeout }` | 2 of 25 consecutive full runs failed at Testing Library's 1 s default with `testTimeout` already raised; 60 of 60 consecutive full runs passed after (two batches of 30, the second on the final test code), and 18 of 18 with three suites running side by side. Under about 15-fold CPU oversubscription (four suites plus 32 busy loops on 32 cores) 8 of 24 runs still hit the 15 s limit, all on the two Story Bible tests of `App.test.tsx`: that is the render-cost limit this PRD leaves alone. A wait ends when its condition holds, so the longer limit costs nothing on a passing run |
| Tests read state only after waiting for that state (phase 1) | `ProjectPicker` waits for focus; `App.test.tsx` and `GuideDetail.test.tsx` use `findBy*` where the next assertion depends on a later commit | Leave the two extra cases | The scan for a synchronous assertion straight after a `waitFor` on a different condition found them; same class as the reported flake |
| Drivers navigate through one scoped helper and wait for the destination heading (phase 2) | `clickNav` clicks inside the first visible `aside` (the navigation, before `<main>` in the DOM); `goToPage` then waits for the level-1 heading and, for the pages whose main content is the same in every state (Home, Manuscript, Proofing), for that content; states with per-state content (`tracks/*`, `overlapping-highlights`, `home/default`) wait for their own | The drawer heuristic; URL navigation; `aria-current` | Q2 and Q3. The heading alone photographs a Manuscript with no chapter yet, because the heading renders before the data |
| Confirm-dialog states wait for their dialog by name, accepting `dialog` or `alertdialog` (phase 2, owner decision D1) | `confirmDialog(page, name)` | Wait for `dialog` only | `ConfirmDialog` becomes an `alertdialog` in the Base UI foundation; the drivers must not need editing then |
| The suite can be run with a slowed CPU (phase 2) | `UI_CPU_THROTTLE=<factor>` through the kit's optional `beforeCapture` seam (Chromium `Emulation.setCPUThrottlingRate`), off by default | A CI-only stress job; no stress mode | A race that shows once in 20 CI runs shows on demand at 20x; it is how phase 2 was proven, and it is the check to run when adding a driver. At 20x the two Story Bible confirm states exceed Playwright's 30 s test timeout inside the capture's own steps (fail loudly, never a wrong picture); everything else passes |
| The docs follow the live repository settings (phase 5, owner decision D11) | `ci-and-releases.md` states that no ruleset requires a status check and that code-owner review is required (the owner exempt), lists the ten check names that exist, and says what has to be decided before requiring any; the `CODEOWNERS` comment and the `_quality.yml` comment no longer contradict the ruleset | Change the rulesets to match the old docs; add a `CI / gate` job | The owner decided the docs change (D11); requiring checks is an owner-only setting and the supply-chain PRD's `gate` design is moot |
| The pixel-baseline statement is restated from measurement (phase 5) | 282 of 282 PNGs byte-identical across repeated and throttled runs on one machine; still no baselines: nothing shows two machines agree | Keep "anti-aliasing still differs" | The old wording did not survive the phase 2 runs; the decision (pinned Linux container, ADR either way) is unchanged |
| The Go guard is an Nx target of the desktop project, run by the `go` job (phase 4, Q4) | `narration-utils-shell:test-schedules`: `-cpu 1,4 -count=5` over the root package's teleprompter, shutdown and can-attach tests and the whole `internal/teleprompter` package; not part of `pnpm check` | A bare `run:` step in `_quality.yml`; add it to the local gate | The Go job already runs its targets through `nx-run`, which scopes them to what a pull request affects; the guard costs about 20 s and only guards ordering bugs, so it stays in CI. Windows only, as the Go job is |
| The manuscript test asserts `Elapsed >= 0`, and the arithmetic has its own test (phase 4, Q5 option a) | `TestElapsedIsTheTimeBetweenStartAndEnd` uses fixed times for a finished, a running and an unstarted job, and the integration test checks that a finished job's elapsed time stops growing (it fails if the end time is never recorded; checked by deleting that line) | A clock seam in `Service`; a sleep in the commit step | The field's job is to be reported and correct; a sub-tick commit legitimately reads 0 on a coarse clock |
| The guard's own repeats exposed a rare race in a test, fixed in the test (phase 4, found by review) | `TestStopAsksTheSidecarToFinishAndEndsInStopped` waits for the stop file to be gone: the watcher publishes `stopped` and only then removes the file, so a poll in between saw it (1 in 1920 runs at 24 processes, `-cpu 1,4`) | Reorder `Service.watch`; leave it | The PRD builds no production Go change, and the test read a moment that is not part of the contract |
| Kit release 0.3.2 changes the scaffold only (phase 3, Q8) | Bump `plugin.json` and stamp `apps/ui/ui-atlas.config.json`; core files and their 0.3.1 headers stay (nothing in them changed); an "Adopt by hand" changelog item for the five other repositories | Re-stamp every vendored header; wait for the settings PRD's kit release | Serialized as Q8 decided: this stack goes first (it precedes S12), the settings-mobile-layout PRD and Phase 6 take the next versions |
| The scaffold's mobile-menu logic is decided by what the layout shows, not by a timeout (phase 3) | `clickNav` waits for the item or the menu button, whichever is visible, and opens the menu only if the menu button is showing and the item is not (a bounded wait, so a viewport where neither shows fails with a message that says so) | Keep 'wait 1.5 s then open the menu' with a longer timeout | Measured on this app at 375 px: a control that renders after 2.5 s makes the old helper open the drawer and time out on the backdrop (`subtree intercepts pointer events`); the new one passes, and `clickNav` walks the nav at 375, 1024 and 1440 px, also at 20x CPU throttle |

## Research Summary

**Market Context**: a flaky test is a test whose outcome changes without a code change; the standard remedies are to fix the timing assumption rather than retry, to make waits condition-based, and to run under varied schedulers (`-cpu`, `-count`) to expose ordering bugs. Playwright's pixel snapshots are documented as environment-sensitive and are best generated in the same pinned image that verifies them.

**Technical Context**: Go tests use the test binary as a fake sidecar (`teleprompter_test.go` `TestMain`); `teleprompter.Service` coordinates `Start`/`Stop`/`Close` with a `watch` goroutine and, since #30, a `finished` channel; frontend tests are Vitest 2 + jsdom (`vite.config.ts` has no `testTimeout` or `setupFiles`); the visual suite is `apps/ui/tests/visual/` (drivers project-owned, capture contract vendored from `tools/ui-atlas-kit`); CI is `.github/workflows/{ci,_quality,_build-native}.yml`; verification per CLAUDE.md (plan, change-impact-scan, TDD, `pnpm check`, Playwright visual suite with PNG review for any driver change, feature-cleanup); mark each phase `complete` in the same PR that lands it.

---

*Generated: 2026-09-19*
*Status: in delivery (stack S07, issue #80). Phases 1 to 5 are complete (stack S07). Phase 6 (axe on app states) waits for the palette stack (S12) and a kit slot and runs in the S13 tail; phase 7 (pixel baseline spike) stays deferred until 50 consecutive stable CI runs after this stack merges. The issue stays open and this PRD stays until those two are done or dropped.*
