# Best-in-Class Testing and CI for Narration Utils, and How to Get There

**Status:** research note, 2026-09-26. Nothing here is a decision. Each recommendation that changes a recorded decision
(an ADR, an owner decision in the [implementation plan](../prds/implementation-plan.md), or the "Not built, on purpose"
list in [verification tooling](../operations/verification-tooling.md#not-built-on-purpose)) needs its own PRD or ADR before
it is built.

**Question:** what would a best-in-class test suite and CI look like for this codebase as it is planned (the roadmap, the
open PRDs and the benchmark train), and what is the path from here to there?

**Confidence: medium-high on the repository facts, medium on the external practice.** The inventory of tests and CI was
read from the code on 2026-09-26 (counts from `find`/`grep`, so approximate). The external findings come from web
searches. The egress proxy blocked direct reads of docs.github.com, github.blog, playwright.dev, testing.googleblog.com,
research.google, arxiv.org and several others, so many claims rest on search-engine extracts of the cited page rather than a
read of it. Pages read in full are marked *(read)*. A claim with one source is marked *(single source)*. Pricing, plan limits
and product availability change often: each is dated and must be checked before it drives a decision.

## Summary

- **The suite is already well above typical.** It has about 7,300 unit and integration tests across five languages; a
  coverage *ratchet* rather than a blanket number; deterministic property and fuzz tests; 231 golden wire contracts checked
  by Zod; a visual suite that is a gate (overflow, blank screens, axe, collapsed controls, duplicate states), not a camera; a
  fake-REAPER harness with 119 hand-written mutations; architecture rules as tests; a packaged-app smoke test; SHA-pinned
  actions, zizmor and build provenance. Most of what the literature calls best practice is here. The gaps are specific.
- **The largest gap is not a missing kind of test; it is that nothing makes a red run matter.**
  - No ruleset requires a status check ([#544](https://github.com/countrymanprime/narration-utils/issues/544)).
  - Nothing runs the quality suite on `main` after a merge: `ci.yml` runs on pull requests only, and `prerelease.yml` runs
    no quality jobs.
  - The agent train merges on `Build (Windows)` and `ui-dist` alone (D43), and defers the full visual suite and atlas to one
    run "at the end" (D44).

  Together these let agent-written code reach `main` without its tests ever passing, and nothing notices until the final
  sweep. The 2025 DORA report found that AI assistance raises throughput *and* instability, and that small batches and a
  strong platform decide which wins [C20][C21].
- **The largest missing test layer is the real app.** Every Playwright run drives the mock-backed build in Linux
  Chromium. Nothing automated exercises the real Wails bindings in WebView2, the frozen sidecars doing real work, the
  installer, or an upgrade. Playwright can drive WebView2 over CDP [T7], and Wails v3 documents a Playwright E2E path [T10]
  *(single source, not read)*.
- **Test strength is measured only by coverage, except in Lua.** Mutation testing is a gate only for the Lua bridge. The
  recorded reason for leaving it out of the UI ("Stryker's Vitest runner does not support Browser Mode") does not apply to
  today's config: `apps/ui/vite.config.ts` runs Vitest in jsdom, not Browser Mode. For code largely written by agents,
  mutation scores and property tests are the oracle that does not depend on the agent. Agents have been measured editing or
  special-casing tests in up to 76% of impossible tasks [T37].
- **Searching tests (fuzz, property exploration, race over every package) never run.** [ADR 0044](../adr/0044-property-and-fuzz-tests-are-deterministic-in-the-gate.md)
  itself says a scheduled job should come "if targets start finding things". The properties already found six real defects.
  A scheduled workflow is the cheapest high-value change in this note.
- **What the plan adds is mostly hardware, a second DAW, and ML accuracy**: native recording, pedals and MIDI, Audacity,
  encoders and M4B, model cascades. Hosted runners cannot test any of these for real. The planned answer, ports with
  conformance suites plus fakes plus an owner check, is right. It needs two more things:
  - a way to detect when a fake drifts from the real thing (record and replay transcripts from each owner pass);
  - accuracy gates on real human audio, not only TTS [T20].
- **CI speed is capped by job slots, not money.**
  - One CI run takes 14 of the 20 concurrent jobs a free personal account allows, and the train plans up to 8 workers.
  - GitHub Pro raises the cap to 40 [C8] *(price and limit to verify)*.
  - The native merge queue is **not available** here, because the repository is owned by a personal account; it needs an
    organization [C2].

## 1. What best-in-class looks like for this system

Six properties separate a best-in-class suite from a merely large one. The last column says where this repository stands.

| Property | What it means | Here |
| --- | --- | --- |
| **Red means real, and red blocks** | Checks are deterministic, a failure is a defect, and a required check stops the merge. Quarantine is explicit, owned and expiring, never a silent retry [C13][C14][C16] | Deterministic (ADR 0023, 0044), but nothing blocks, and `main` is never re-tested |
| **Tests sized by hermeticity** | Small tests (one process, all fakes), medium (one machine), large (real resources), roughly 70/20/10 to 80/15/5 [T33][T34]. Large tests are few and cover what nothing else can | Strong small and medium layers; the large layer (real app, installer, real models, REAPER) is manual |
| **Test strength is measured, not assumed** | Mutation score on changed code at review time [T1][T2]; property tests, which kill far more mutants per test than examples [T31] | Coverage ratchet everywhere; mutation only in Lua; property tests in 3 UI files and not in `manuscript-guide` |
| **One contract, checked on every side** | A single schema is the source of truth, and each producer and consumer validates against it [T27][T28] | Zod plus goldens written by Go and Python; the producers check their own output only against the golden they wrote |
| **Searching tests run continuously, outside the gate** | Fuzzing and random property runs on a schedule; each find becomes a fixed regression example [T29][T30] | The mechanism exists (ADR 0044); nothing schedules it |
| **The pipeline is observed** | Queue time vs run time, flake rate per test, and DORA's five metrics, rework rate included [C18][C19][C22][C23] | Timings gathered by hand for the CI-speed PRD; no flake or rework tracking |

For this product, two more are specific:

- **Accuracy is a tested property.** The product's value is finding the right mistakes in a narration. The ML Test Score
  rubric treats model quality, staleness and reproducibility as tests [T15]. Word error rate (WER) needs a versioned text
  normalizer to mean anything [T16]. Alignment is judged by boundary error within a tolerance, not exact timestamps [T18]
  *(single source)*. Test audio made with TTS raises false alarms, so the corpus must be human speech [T20]. LibriSpeech is
  audiobook narration under CC BY 4.0 and is on-domain [T17].
- **The shipped artifact is what gets tested.** Mature desktop projects smoke-test the built product, including an upgrade
  from the previous release [T11], and validate installers on a clean machine [T12][T13].

## 2. Where the repository stands

### The suite today

| Stack | Tests | Levels present | Strength signal | CI OS |
| --- | --- | --- | --- | --- |
| Go (`apps/desktop`) | 350 files, ~2,570 `Test` funcs | unit and integration, 24 fuzz targets (seed-only, 0 checked-in corpus files), goldens, depguard rules, race on flagged packages, `test-schedules` | ratchet on 24 of 55 `internal/*` packages (floors 82–100) | Windows only |
| UI (`apps/ui`) | 183 files, ~1,900 tests; 285 visual states; 33 stories ×4; 22 aria snapshots | Vitest (jsdom), fast-check in 3 files, Playwright visual + axe on the mock build, atlas, dependency-cruiser | ratchet on 8 logic paths (86–100) | Linux |
| Python (sidecars, `libs/python`) | ~45 files, ~660 tests (+ ~120 in scripts and the docs site) | pytest, Hypothesis (not in `manuscript-guide`), contract goldens, synthetic coverage corpus | ratchet on 13 paths, some low: `compare.py` 42, `manuscript_guide.py` 71, `narration_common` 73 | Linux only |
| Lua (`integrations/reaper`) | 23 files, 342 tests | fake-REAPER harness over the real file protocol | 119 hand-written mutations (ADR 0066) | Linux and Windows |
| Node scripts | 18 files, ~190 tests | `node:test` | none | Linux |

Across the whole app, beyond the per-stack rows:

- **Packaged app:** `narration-utils --smoke` in the Windows build. It unpacks resources, runs each frozen sidecar's
  `--help` and self-check, and loads the catalogs. It opens no window.
- **Manual:**
  - the REAPER verification pass (planned, not run; 12 commands wait behind the experimental switch,
    [ADR 0230](../adr/0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md));
  - the update rehearsal (`rehearsal` tag) and the latency harness (`latency` tag);
  - fuzz and explore runs, and the real-corpus calibration.

### Gaps, with evidence

Ordered by risk. **V** = verified in the repository, **I** = inferred.

1. **Nothing blocks a merge, and nothing re-tests `main` (V).**
   - [CI and releases](../operations/ci-and-releases.md): "No ruleset requires a status check. CI is advisory."
   - `ci.yml` triggers on `pull_request` and `workflow_dispatch` only.
   - `prerelease.yml` has no quality jobs; the pull request's run is "the gate".
   - The owner is exempt from the Pull Request ruleset.
   - The train's merge gate is `Build (Windows)` and `ui-dist` (D43 in [agent train](../operations/agent-train.md)).
2. **No end-to-end test of the real app (V).** Every Playwright suite targets the mock production build
   ([ADR 0038](../adr/0038-visual-suite-captures-the-production-build.md)). The real Wails client glue is about 34% covered,
   per the `src/api` floor's reason. The installer, upgrade and uninstall are checked only by the owner.
3. **The frozen sidecars are only smoke-tested (V).** They get `--help`, a self-check and a library load. `compare.py`'s
   floor reason says "decoding, transcription … and the CLI paths are still untested in process". A difference introduced
   by PyInstaller would pass CI (I).
4. **The OS matrix is inverted from what ships (V).**
   - Python runs only on Linux, so the Windows-only paths skip everywhere: Moonshine (`test_moonshine_engine.py:176,273`)
     and dshow (`test_devices.py:225`).
   - Go runs only on Windows, while the Linux and macOS preview builds are neither tested nor smoked.
5. **Searching tests never run (V).** There are no checked-in `testdata/fuzz` files, no scheduled explore job, and `-race`
   runs only on packages a regex in `coverage-gate.mjs` flags as concurrent. Trust-boundary parsers with no fuzz target:
   - the bridge's `DecodeFields` over `events.log` (`internal/bridge/bridge.go`);
   - the WAV `fmt` chunk reader (`internal/measure/wav.go`);
   - the MP3 decoding that the delivery PRD adds next.
6. **Test strength outside Lua is coverage only (V).** Coverage says a line ran, not that a test would notice it being
   wrong. The recorded reason for no Stryker (Browser Mode) does not match the jsdom config (above).
7. **The ratchet does not see new packages (V).** 31 of 55 Go `internal/*` packages have no floor, including logic
   packages not named as exempt: `chaptermatch`, `chaptersync`, `credits`, `proofing`, `repeats`, `levelnormalize`,
   `deliveryreport`, `pickups`, `editing`. The gate does not fail when a new, unlisted package appears.
8. **Accuracy is evaluated on synthetic data only (V).**
   - The recording check ships labelled uncalibrated
     ([ADR 0132](../adr/0132-the-recording-check-ships-0-8-3-8-3-chosen-on-synthetic-fixtures-and-labelled-uncalibrated.md)).
   - The real-corpus test is skipped unless `NARRATION_COVERAGE_CORPUS` is set.
   - The live ASR engines have no WER evaluation.
9. **Performance has no regression check (V).** Six Go benchmarks and the latency harness exist; none runs in CI, and no
   baseline is stored.
10. **The fakes' fidelity is unproven (V/I).** The REAPER pass has never run. The Audacity plan replays recorded pipe
    transcripts. Neither has a rule that makes a fake fail when the real program behaves differently.
11. **Small holes in the gate itself (V):**
    - `lint-staged` sends `*.ps1` to `quality.mjs check-powershell`, which matches no branch and exits 0, so the three
      PowerShell scripts are never checked.
    - `scripts/bootstrap.test.mjs` is outside every `test-node` glob, and `scripts/quality.mjs` has no tests.
    - Dependabot does not update `.github/actions/*` ([#233](https://github.com/countrymanprime/narration-utils/issues/233)).
    - No job checks the pull request title, although the title sets the version.
12. **Time is uncontrolled in Go tests (V/I).** There are 56 `time.Sleep` calls and about 140 poll helpers, and no
    `testing/synctest`, which the module's Go 1.26 directive allows. Async waits are the largest single cause of flaky
    tests in the open-source literature [T35] *(secondary summaries)*.

## 3. What the planned work adds

Each row is a surface a PRD or benchmark issue introduces, what the PRD already plans, and what best practice would add.

| Planned surface (PRD or issue) | Already planned | What to add |
| --- | --- | --- |
| DAW port ([PRD](../prds/daw-port-and-capabilities.prd.md), #618) | `dawporttest.Run(t, factory)` against fake, REAPER and Audacity adapters; a boundary grep | Run the same suite against **recorded transcripts from the real DAW**, and re-record on each owner pass or DAW version bump, so drift in a fake fails a test |
| Provider ports ([PRD](../prds/provider-ports.prd.md)) | Conformance suites with fake models; Moonshine checked by the smoke test only | A small **real-model conformance run on Windows** with a pinned, tiny model, on a schedule and on PRs that touch providers |
| Audacity ([PRD](../prds/audacity-integration.prd.md)) | Replayed pipe transcripts (Q6) | Store each transcript with the Audacity version and date, and add a check that fails when a transcript is older than the supported version |
| Native recording ([PRD](../prds/native-recording-suite.prd.md)) | Soak test, loopback rig, two-machine manual test | Capture behind a port with a **file-backed virtual device**, so dropouts, buffer overruns and file writing are testable in CI. A virtual audio driver on a Windows runner is a spike, not a given |
| Input commands and pedals ([PRD](../prds/input-commands-and-pedals.prd.md)) | Fake `InputSource`, conflict tests, aria snapshots, owner hardware check | In the real-app E2E, dispatch synthetic key and MIDI or HID events through CDP to check the "silent while recording" rule end to end |
| Render, encode, master (#629), MP3 levels ([delivery PRD](../prds/delivery-platform-profiles.prd.md)) | `measure-*.json` goldens | **Metamorphic tests**: gain, silence padding and re-encoding must move loudness and peak by known amounts. Fuzz the decoder at the new parse boundary |
| Recording-check cascade ([PRD](../prds/recording-check-model-cascade.prd.md)) | Calibration over synthetic Piper cases; target of zero false "met" | A **human-audio golden corpus** and a hard gate on false "met", run on CPU with a pinned model |
| Wails v3 ([PRD](../prds/wails-v3-migration.prd.md)), TS 7 ([PRD](../prds/typescript-7-and-typed-linting.prd.md)) | Tests for each changed default; unchanged bindings | The real-app E2E is the test that proves the migration; build it before v3 leaves beta |
| macOS and Linux (roadmap, deferred) | Preview builds, not smoked | Until they are supported, say "untested" in the release notes. When they are, add a smoke on each; macOS runners are capped at 5 concurrent jobs [C8] |
| Signing (D7 deferred, #230) | None | SignPath Foundation offers free OV signing to OSI-licensed projects (check the bundled components) [C35]. Azure Artifact Signing takes individuals in the US and Canada only [C33]. EV certificates no longer grant instant SmartScreen reputation [C36] |

## 4. The target CI design

### Gating

- **Require one aggregate check, and keep it always reporting.**
  - A workflow skipped by `paths:` leaves a required check pending forever; a *job* skipped by `if:` reports success
    [C4][C5].
  - So remove `paths-ignore` from `ci.yml` and let `scripts/ci/nx-scope.sh` and job-level `if:` skip docs-only work.
    `CI passed` then always reports.
  - `CI passed` already uses `if: always()` and fails on failure or cancellation, the pattern `alls-green` implements [C6].
  - Require `CI passed`, `Docs / Links (offline)` and `zizmor`.
- **Put the required checks in their own ruleset with no bypass**, separate from the review ruleset the owner is exempt
  from. Then the owner still merges their own pull requests, but not a red one. *Inference: check how rulesets combine
  before relying on this.*
- **Re-test `main`.** Add `push: branches: [main]` to `ci.yml`, or a `quality` job in `prerelease.yml` that gates `publish`
  (not `windows-build`, so the build/publish overlap of the CI-speed PRD survives). Without a merge queue, a squash of a
  stale branch can combine two green changes into a red `main`.
- **Merge queue.** Native merge queue needs an organization-owned public repository [C2] *(read, via the docs source)*.
  The options:
  1. Transfer the repository to a free organization. This also gives agents a clean way to have their own identity.
  2. Use Mergify's free OSS queue [C3] *(vendor terms)*.
  3. Do without, and rely on the post-merge run above.

  For burst merging, (1) or (2) turns N rebases and N CI runs into one queued group. Queued groups also need `merge_group`
  triggers on every required workflow [C2].
- **Agent-authored changes.**
  - Required checks are the gate; an agent's "I ran the tests" is not evidence [C26][C28]. Tests written first and left
    unchanged by the implementation are the agent's own oracle [T39]; surviving mutants are one that does not depend on it [T38].
  - Put the files that weaken a gate behind CODEOWNERS: `axe-debt.ts`, `coverage-floors.json`, `tests/mutations.json`,
    `hypothesis_profiles.py`, the workflows and `.claude/`. The owner already reviews everything, so this matters once
    agents have a separate identity or auto-merge exists.
  - Add an advisory check that flags a diff changing both production code and the assertions of *existing* tests. That is
    the signature of test gaming [T37].

### Speed at the job cap

| Lever | Effect | Note |
| --- | --- | --- |
| Finish CI-speed phases 4 (atlas grouping) and 7 (measure, then ADR) | Fewer atlas test bodies; the metrics measured | [PRD](../prds/ci-pipeline-speed.prd.md), #375 |
| Size the train to the cap | 14 slots per run at a cap of 20 means one run at a time without queueing; 8 workers pushing stacks cannot fit | Owner setting in `agent-train.md` (`MAX_WORKERS`) |
| GitHub Pro on the owner's account | Concurrent jobs 20 → 40 [C8] | A plan, not a paid runner, so outside the PRD's "not building" line, but an owner decision. Verify limit and price |
| Keep build caches, never verdict caches | Keeps "a green check means the checks ran" | Supported by the evidence: test-result caching is safe only for hermetic tests with fully declared inputs [C10][C11], and a PR-writable remote cache can poison main (CVE-2025-36852, "CREEP") [C12] |
| arm64 Linux runners | Free for public repos [C9] | Same slot pool; only helps if a job is CPU-bound |
| Larger runners | Not available on Free and never free [C7] | Not an option today |

### Flakiness

- **Keep "no retries" as the verdict, and add diagnosis.** Playwright's `failOnFlakyTests` lets a retry collect a trace and
  classify the failure while the run still fails [C15] *(not read)*. That keeps ADR 0023's rule and gains evidence, but it
  changes ADR 0023's wording, so it needs an ADR.
- **Measure flake rate per test** on scheduled reruns of `main`, rather than a flaky/not-flaky label [T36][C16]. The same
  runs count toward the "50 consecutive stable `ui-visual` runs" that the pixel-diff spike
  [#153](https://github.com/countrymanprime/narration-utils/issues/153) waits for.
- **Store JUnit output from every run.** A small in-repository script can do this (a scheduled workflow that reads job
  results and writes a JSON artifact). SaaS options exist and are free for public repositories [C17] *(vendor terms)*, but
  they add a third party.

### Supply chain and release

- **SLSA Build L3.** The releases are at L2: GitHub attestations from hosted runners. L3 needs the build *and* the
  attestation inside a **reusable workflow**, with consumers verifying the signer workflow [C29][C30] *(not read)*.
  `promote-release.yml` already verifies `--signer-workflow`. The Windows build runs as a composite action inside
  `prerelease.yml`, so it would have to move into a reusable workflow.
- **Scorecard** ([#187](https://github.com/countrymanprime/narration-utils/issues/187)):
  - Signed-Releases needs provenance files attached as release assets; the attestation API alone does not count [C32]
    *(read)*.
  - Code-Review needs a second human, so a solo repository will score low whatever else it does [C32].
- **Immutable releases** went GA in October 2025 [C31]. [#186](https://github.com/countrymanprime/narration-utils/issues/186)
  keeps them off because the late macOS and Linux uploads need a mutable release. Revisit when those platforms build before
  publishing.
- **Harden-Runner in audit mode** is free for public repositories and caught the tj-actions compromise through its egress
  alerts [C38][C37]. SHA pinning, already enforced here, is what defeated that attack [C37].

### Metrics

- **Watch the DORA five, with rework rate first** [C18][C19]. Rework rate here means fix-up pull requests that follow a
  merge. It is the metric the 2025 report ties to AI-assisted instability.
- **Queue time vs run time** is free from GitHub's Actions performance metrics (GA March 2025) [C22]. OpenTelemetry's CI/CD
  conventions name the same split, `pending` vs `executing` [C23].
- **Suggested SLOs** *(this note's proposal, not a standard)*:
  - p50 and p90 time from pull request to green, with queue and run time kept separate;
  - `main` red rate;
  - per-test flake rate;
  - rework rate.

## 5. The path, in phases

Each phase is independent enough to ship on its own. The **Needs** column says what must happen first.

### Phase A: make red matter (days; mostly owner settings)

| # | Change | Needs |
| --- | --- | --- |
| A1 | Remove `ci.yml`'s `paths-ignore`, skip docs-only work at job level, and require `CI passed`, `Docs / Links (offline)` and `zizmor` in a ruleset with no bypass | #544; owner setting |
| A2 | Run the quality suite on `main` after merge, gating `publish` | CI-speed Decisions Log (Q1) revisited |
| A3 | Make the train merge on `CI passed` and run the visual suite and atlas per pull request (they are affected-gated already) | Supersede D43 and D44 |
| A4 | Fix the holes: the `check-powershell` no-op (PSScriptAnalyzer or remove the mapping), wire in `bootstrap.test.mjs`, test `quality.mjs`, Dependabot `directories` (#233), a pull request title check | None |
| A5 | Decide on the organization transfer or Mergify (merge queue), and on GitHub Pro (slots) | Owner |

### Phase B: search and measure outside the gate (1–2 weeks)

| # | Change | Needs |
| --- | --- | --- |
| B1 | A **scheduled `explore` workflow** that runs, each finding opening an issue and becoming a checked-in example per ADR 0044: <ul><li>each Go fuzz target for a fixed `-fuzztime`</li><li>the Hypothesis `explore` profile</li><li>fast-check explore</li><li>`-race` over every package</li><li>`test-schedules` at a higher count</li><li>pytest on Windows</li><li>the full visual suite on `main` several times</li></ul> | ADR (ADR 0044 anticipates it) |
| B2 | Fuzz targets for `DecodeFields`, the WAV `fmt` reader and each new decoder; commit a `testdata/fuzz` corpus | None |
| B3 | Make the coverage gate fail on a **new unlisted logic package** unless it is exempted with a reason (the `axe-debt` pattern), and put floors on the unlisted logic packages | ADR amending ADR 0043 |
| B4 | Run pytest for the teleprompter sidecar in `quick-windows` so the Moonshine and dshow paths run somewhere | None |
| B5 | Store JUnit results and per-test flake rate from B1's reruns; publish the SLOs above | None |
| B6 | Move time-dependent Go tests to `testing/synctest` where they wait on timers | None |

### Phase C: measure test strength (2–4 weeks)

| # | Change | Needs |
| --- | --- | --- |
| C1 | **StrykerJS incremental** on the UI logic paths already in the ratchet. Report-only on pull requests, full run weekly, then a `break` threshold ratcheted like coverage [T4][T5] | Supersedes the "Not built" entry; check the jsdom config works with Stryker's Vitest runner first |
| C2 | **mutmut** on the Linux job for `compare.py`, `narration_common` and the coverage modules (it needs `fork`, so not native Windows) [T6] | Same ADR |
| C3 | **gremlins** weekly on a few pure Go packages (`measure`, `chaptermatch`, alignment). It is 0.x and slow on big modules, so not on pull requests [T3] | Same ADR |
| C4 | Extend fast-check to UI stores and event handling (model-based commands, the async scheduler) [T32], and add Hypothesis to `manuscript-guide`, with stateful machines for sidecar session protocols [T30] | None |
| C5 | Export the Zod schemas to JSON Schema (`z.toJSONSchema()`) and have the Go and Python golden writers validate against it, so a producer fails on its own side of the wire [T27] | ADR (wire contracts) |

### Phase D: test the real app (3–6 weeks; the biggest new layer)

| # | Change | Needs |
| --- | --- | --- |
| D1 | **Real-app E2E on `windows-latest`**, about 10–20 journeys: <ul><li>Launch the packaged exe with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`, a fresh `WEBVIEW2_USER_DATA_FOLDER` per test, and Playwright `connectOverCDP` [T7]. Microsoft's supported alternative is msedgedriver with `UseWebView`, with the driver version pinned [T8][T9].</li><li>Journeys: start with no project, open a fixture project, import a DOCX, run a real frozen sidecar job on a tiny fixture, decide a finding and see it persist, zoom, update check offline.</li></ul> | Spike, then PRD and ADR |
| D2 | **Installer lifecycle**: <ul><li>NSIS `/S` install to a temp directory, then `--smoke` from the installed location</li><li>upgrade from the previous release candidate, keeping settings and downloaded models</li><li>uninstall, and assert the directory is clean</li><li>a `.wsb` Windows Sandbox script for the owner's clean-machine check [T12][T13]</li></ul> | PRD (release readiness) |
| D3 | **Frozen-sidecar contract run**: feed the golden-contract inputs to the PyInstaller binaries and compare with the goldens | None |
| D4 | Spike the Wails v3 `server` build tag (real bindings over HTTP, no WebView) as a Linux medium-size layer [T10] | Spike; *(single source, not read)* |

### Phase E: accuracy, performance and fakes (ongoing, with the planned PRDs)

| # | Change | Needs |
| --- | --- | --- |
| E1 | **Accuracy harness**, run on a schedule and on pull requests that touch sidecars or model pins: <ul><li>corpus: a frozen LibriSpeech slice [T17] plus owner-recorded clips</li><li>a versioned Whisper-style normalizer [T16]</li><li>gates: WER and boundary-error tolerances, and **zero false "met"**</li><li>runs on CPU with SHA-pinned models, through the frozen binary [T19]</li></ul> | PRD; ADR superseding the synthetic-only basis of ADR 0125 and 0132 |
| E2 | **Performance**: run the benchmarks and the latency harness on a schedule, comparing base and head in the same job (hosted runners are noisy) and alerting on a set percentage | ADR |
| E3 | **Fake fidelity**: every owner REAPER or Audacity pass records a transcript; the harness replays it against the fake; a mismatch fails | Extends ADR 0066 |
| E4 | Conformance suites for the DAW and provider ports, as planned, plus the real-model and real-transcript runs in section 3 | The port PRDs |
| E5 | Release trust: SLSA L3 via a reusable build workflow; a Scorecard workflow (#187); signing through SignPath when D7 is revisited | Owner decisions D7 and #230 |

## 6. What not to do

- **Do not cache test verdicts, and do not add retries that turn red into green.** The evidence supports the current rule
  [C10][C12][C14].
- **Do not add a pixel-diff gate to the app suite.** If it comes, it belongs on the atlas only, in a pinned Linux container
  [T21]. Do not use Lost Pixel: it was archived in April 2026 [T24].
- **Do not adopt Pact.** One owner holds every side, and the channels are bindings, stdio and files, not HTTP between
  teams [T25][T26]. A shared JSON Schema does the job (C5).
- **Do not apply to OSS-Fuzz.** It takes projects with a large user base [T29]. ClusterFuzzLite runs in Actions if the
  scheduled fuzzing in B1 outgrows `-fuzztime` [T30].
- **Do not add a self-hosted runner.** A public repository runs untrusted fork code on it (the
  [threat model](../architecture/threat-model.md) already says so).
- **Do not treat automated accessibility checks as the whole of accessibility.** Axe finds a minority of barriers by
  criteria [T22] and about 57% of issues by volume (vendor data) [T23]. The booth and screen-reader goals of the benchmark
  need a manual pass per release.

## Sources

External sources were found through web search on 2026-09-26. Pages marked *(read)* were read in full; the rest are known
from search extracts.

**Testing**

- [T1] [State of Mutation Testing at Google](https://research.google/pubs/state-of-mutation-testing-at-google/) — diff-scoped mutation at code review, arid-line suppression.
- [T2] [Practical Mutation Testing at Scale](https://arxiv.org/abs/2102.11378) — the Google system in detail.
- [T3] [gremlins](https://github.com/go-gremlins/gremlins) — Go mutation testing; 0.x, best for smaller modules.
- [T4] [StrykerJS incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/) — mutate only changed code; run a full pass periodically.
- [T5] [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/) — `thresholds.break`.
- [T6] [mutmut](https://github.com/boxed/mutmut) — incremental Python mutation; needs `fork`.
- [T7] [Playwright: WebView2](https://playwright.dev/docs/webview2) — `connectOverCDP`, per-test user-data folders.
- [T8] [Automate WebView2 with Microsoft Edge WebDriver](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver) — `UseWebView`, `DebuggerAddress`.
- [T9] [Selenium #12958](https://github.com/SeleniumHQ/selenium/issues/12958) — driver version mismatch with WebView2.
- [T10] [Wails v3 E2E testing guide](https://v3alpha.wails.io/guides/e2e-testing/) and [server build](https://v3.wails.io/guides/server-build/) — not read.
- [T11] [VS Code smoke tests](https://github.com/Microsoft/vscode/blob/main/test/smoke/README.md) — tests the built product and migrations.
- [T12] [winget-pkgs SandboxTest](https://github.com/microsoft/winget-pkgs/blob/master/doc/tools/SandboxTest.md) — installer validation in Windows Sandbox.
- [T13] [Windows Sandbox .wsb configuration](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file) — `LogonCommand`.
- [T15] [The ML Test Score](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/) — 28 tests for ML production readiness.
- [T16] [Open ASR Leaderboard](https://arxiv.org/abs/2510.06961v1) and [scripts](https://github.com/huggingface/open_asr_leaderboard) — a shared text normalizer for WER.
- [T17] [LibriSpeech (OpenSLR 12)](https://us.openslr.org/resources/12/about.html) — about 1,000 hours of audiobook speech, CC BY 4.0.
- [T18] [Forced alignment evaluation, 2026 preprint](https://arxiv.org/html/2606.18466v1) and [FA-Bench](https://github.com/olewave/fa-bench/) — boundary-error metrics *(single source)*.
- [T19] [PyTorch reproducibility](https://docs.pytorch.org/docs/stable/notes/randomness.html) — deterministic algorithms; CPU is reproducible where GPU may not be.
- [T20] [Synthesizing Speech Test Cases with TTS? (ISSTA 2023)](https://arxiv.org/abs/2305.17445) — TTS test audio raises false alarms.
- [T21] [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) — baselines depend on OS, hardware and headless mode.
- [T22] [GDS: testing tools on the least accessible page](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/) — automated tools find a minority of barriers.
- [T23] [Deque automated testing study](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/) — 57% of issues by volume (vendor data).
- [T24] [lost-pixel](https://github.com/lost-pixel/lost-pixel) — archived 2026-04-22.
- [T25] [Pact FAQ](https://docs.pact.io/faq) and [T26] [Pact introduction](https://docs.pact.io/) — contract by example between teams, needs a broker.
- [T27] [Zod: JSON Schema](https://zod.dev/json-schema) — `z.toJSONSchema()`.
- [T28] [Go fuzzing](https://go.dev/doc/security/fuzz/) — `testdata/fuzz` corpus replayed by `go test`.
- [T29] [OSS-Fuzz acceptance](https://google.github.io/oss-fuzz/getting-started/accepting-new-projects/) — needs a significant user base.
- [T30] [ClusterFuzzLite](https://google.github.io/clusterfuzzlite/running-clusterfuzzlite/) — continuous fuzzing in your own CI; also [Hypothesis stateful testing](https://hypothesis.readthedocs.io/en/latest/stateful.html).
- [T31] [An Empirical Evaluation of Property-Based Testing in Python (OOPSLA 2025)](https://cseweb.ucsd.edu/~mcoblenz/assets/pdf/OOPSLA_2025_PBT.pdf) — property tests kill far more mutants per test.
- [T32] [fast-check](https://fast-check.dev/) — model-based testing and a race-condition scheduler.
- [T33] [Google Testing Blog: Test Sizes](https://testing.googleblog.com/2010/12/test-sizes.html).
- [T34] [Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html) — about 70/20/10 by level.
- [T35] [An Empirical Analysis of Flaky Tests (FSE 2014)](https://mir.cs.illinois.edu/lamyaa/publications/fse14.pdf) — async wait is the top cause.
- [T36] [Meta: Probabilistic flakiness](https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/) — a per-test flakiness score.
- [T37] [ImpossibleBench](https://arxiv.org/abs/2510.20270) — models edit or special-case tests in up to 76% of impossible tasks.
- [T38] [Mutation-Guided LLM-based Test Generation at Meta (FSE 2025)](https://arxiv.org/abs/2501.12862) — mutants as an oracle for generated tests.
- [T39] [Claude Code best practices](https://code.claude.com/docs/en/best-practices) — write tests first, confirm they fail, then implement without changing them.

**CI and release**

- [C2] [Managing a merge queue (docs source)](https://github.com/github/docs/blob/main/content/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue.md) *(read)* — organization-owned public repositories; `merge_group` triggers.
- [C3] [Mergify pricing](https://mergify.com/pricing) — free for open source (vendor terms).
- [C4] [Troubleshooting required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/troubleshooting-required-status-checks) — a skipped workflow leaves its check pending.
- [C5] [Pantsbuild: skipping jobs without breaking branch protection](https://www.pantsbuild.org/blog/2022/10/10/skipping-github-actions-jobs-without-breaking-branch-protection).
- [C6] [re-actors/alls-green](https://github.com/re-actors/alls-green) — the aggregate-check pattern.
- [C7] [Larger runners](https://docs.github.com/en/enterprise-cloud@latest/actions/concepts/runners/larger-runners) — Team or Enterprise Cloud; billed for public repositories too.
- [C8] [Actions limits](https://docs.github.com/en/actions/reference/limits) — concurrent jobs by plan: Free 20, Pro 40, Team 60; 5 macOS on Free.
- [C9] [arm64 hosted runners for public repositories (2025-08-07)](https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/).
- [C10] [Turborepo caching](https://turborepo.dev/docs/crafting-your-repository/caching) — tasks are assumed deterministic; undeclared inputs break the cache.
- [C11] [Bazel test encyclopedia](https://bazel.build/reference/test-encyclopedia) — test caching assumes hermetic tests.
- [C12] [Nx: CVE-2025-36852 (CREEP)](https://nx.dev/blog/cve-2025-36852-critical-cache-poisoning-vulnerability-creep) — cache poisoning from PR builds.
- [C13] [Flaky Tests at Google](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html).
- [C14] [Microsoft: flaky test management](https://devblogs.microsoft.com/engineering-at-microsoft/improving-developer-productivity-via-flaky-test-management/) — detect, quarantine with an owner, fix.
- [C15] [Playwright TestConfig](https://playwright.dev/docs/api/class-testconfig) — `failOnFlakyTests`.
- [C16] See [T36].
- [C17] [Codecov Test Analytics](https://docs.codecov.com/docs/test-analytics) and [Trunk pricing](https://trunk.io/pricing) — flake detection, free for public repositories (vendor terms).
- [C18] [DORA metrics history](https://dora.dev/insights/dora-metrics-history/) and [C19] [DORA metrics guide](https://dora.dev/guides/dora-metrics/) — five metrics, rework rate added in 2024.
- [C20] [DORA 2025 report](https://dora.dev/dora-report-2025/) and [C21] [announcement](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) — AI amplifies both throughput and instability.
- [C22] [Actions performance metrics GA (2025-03-14)](https://github.blog/changelog/2025-03-14-actions-performance-metrics-are-generally-available-and-enterprise-level-metrics-are-in-public-preview/) — queue time per job.
- [C23] [OpenTelemetry CI/CD spans](https://opentelemetry.io/docs/specs/semconv/cicd/cicd-spans/) — `pending` vs `executing`.
- [C26] [GitHub: cloud agent risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations) and [building guardrails](https://docs.github.com/en/copilot/tutorials/cloud-agent/build-guardrails).
- [C28] [Zylos: AI agent code governance](https://zylos.ai/research/2026-06-28-ai-agent-code-governance-branch-protection-review-gates/) — practitioner summary *(single source)*.
- [C29] [SLSA Build L3 with artifact attestations and reusable workflows](https://docs.github.com/actions/security-guides/using-artifact-attestations-and-reusable-workflows-to-achieve-slsa-v1-build-level-3) and [C30] [SLSA build track](https://slsa.dev/spec/v1.2/build-track-basics).
- [C31] [Immutable releases GA (2025-10-28)](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/).
- [C32] [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) *(read)* — Signed-Releases, Code-Review, Branch-Protection tiers.
- [C33] [Azure Artifact Signing quickstart](https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/artifact-signing/quickstart.md) *(read; ms.date 2026-05-21)* — individual eligibility US and Canada.
- [C35] [SignPath Foundation terms](https://signpath.org/terms.html) — free signing for OSI-licensed projects, conditions apply.
- [C36] [EV certificates no longer grant immediate reputation](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore).
- [C37] [CISA: tj-actions/changed-files compromise](https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction) — tags retargeted; SHA pins unaffected.
- [C38] [StepSecurity: Harden-Runner detection of the tj-actions compromise](https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised).

## Method

- Two read-only passes over the repository: one of the tests (counts with `find` and `grep`, the ratchet, the ADRs, the
  manual passes), one of CI and the planned PRDs. Three claims were re-checked by hand:
  - the `check-powershell` no-op in `scripts/quality.mjs`;
  - the jsdom (not Browser Mode) Vitest config in `apps/ui/vite.config.ts`;
  - `ci.yml`'s triggers.
- The repository owner type (a personal account) was read from the GitHub API.
- Two web research passes, one on testing practice and one on CI, release and supply chain, with about 120 sources consulted.
- Sub-questions:
  1. What do mutation, fuzz and property testing add beyond coverage?
  2. How is a real Wails/WebView2 app and its installer tested end to end?
  3. How are ASR, alignment and audio pipelines gated?
  4. Pixel vs structural visual checks, and the limits of automated accessibility.
  5. Contracts between processes.
  6. Gating, merge queues and required checks on a free personal account.
  7. Speed at a job cap, and test-result caching.
  8. Flake policy.
  9. Supply chain, signing and SLSA.
  10. CI metrics.
  11. Guardrails for agent-authored changes.
