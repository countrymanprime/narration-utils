# Verification and Code Health Tooling

**Source:** New work (nothing to supersede). The owner approved five tooling items as worth doing on 2026-09-20: property-based tests, Knip, executable architecture rules, a group of small tooling changes, and Playwright hardening. Deferred and rejected tools are listed under What We're NOT Building.

Feature PRD (engineering tooling; no product behavior changes except one small bug fix found while researching, Evidence item 3). Citations are `file:line` on branch `claude/tech-stack-evaluation-7a3bd8` (main dc9d01a) unless marked "per docs" or "TBD - needs research"; the repo layout move ([ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md)) has since rewritten the paths, and the gate now runs as per-project Nx targets. External facts were checked on 2026-09-20 and are listed with URLs in the Research Summary.

**Reconciled 2026-09-20** with the owner decisions of [implementation-plan.md](implementation-plan.md) section 1 (stack S05): D18 (coverage is a ratchet on logic directories, 80% floor for any new logic directory), D2 (the Lua test harness and command registry are pulled forward and delivered by a later stack, so "no `integrations/reaper` change" is stale here but this PRD builds no harness), D16 (add Zod to the Knip false-positive list only when it lands), D17 (any new tool dependency must be AGPL-compatible) and D22 (every open question adopts its recommendation). Phases 9 and 12 are tail phases that wait for the Base UI stack (S10); the rest is delivered by stack S05, tracked in issue #69.

## Problem Statement

`pnpm check` proves that the code lints, builds and passes example-based tests, but three classes of regression get through: text and offset logic that is only tested with hand-picked strings (offsets, alignment, tokenizing, the importer), dead code and unused dependencies that `feature-cleanup` finds only by an agent grepping, and architecture decisions recorded in ADRs that nothing enforces (`design-spec-guard` is LLM judgement). Meanwhile some gates are unmeasured (no coverage number exists for `apps/ui` or Python), one tool is installed but unused (Black), and the Playwright gates keep no trace when they fail (retries are 0, so `on-first-retry` never fires). The cost of leaving it: real defects in parsers and offset math surface as manuscripts that look wrong in the field, dead code accumulates, and ADRs decay into prose.

## Evidence

Verified by reading files or running commands on 2026-09-20:

1. **The gate today.** As written (before the layout and Nx work): `scripts/quality.mjs` `check` ran UI lint, prettier, Vitest, `tsc` plus build, `ruff format --check`, `ruff check`, pytest, `go vet`, `go test` (no `-race`), standalone `staticcheck`, stylua and the node script tests. **At the S04 tip** `pnpm check` runs `nx run-many -t lint format test test-node build` over every project's `project.json` (ADR 0040), and CI (`.github/workflows/_quality.yml`) runs the same targets through `.github/actions/nx-run` (jobs: js, ui-visual, ui-atlas, ui-atlas-kit, repo-scripts, python, lua, go), so a new gate is an Nx target on the owning project plus, when it needs a new toolchain, a `setup-toolchain` input. `go` runs on windows-latest only, with `-race` (the `ci` configuration of the desktop `test` target); standalone `staticcheck` runs from `scripts/quality.mjs go-lint` and is pinned in `scripts/toolchain.json` and `.github/actions/setup-toolchain/action.yml` (v0.8.1).
2. **Black is dead weight.** `black==26.5.1` is a dependency (`pyproject.toml:7`), has a `[tool.black]` table (`:28`) and a `uv.lock` entry, but `quality.mjs`, `lint-staged.config.mjs` and every workflow call only `ruff format`. Measured: `git ls-files '*.py'` is 26 files; `black --check` and `ruff format --check` both report them unchanged, so the one-time reformat the brief expected (about 20 differences) is **zero** at this commit. Line length is 160 in both tables.
3. **A real bug a property test would find.** `narration_common.manuscript.validate` (`libs/python/narration_common/manuscript.py:32-49`) is meant to raise `ManuscriptError` on bad data, but `chapter_ids = {item.get("id") ...}` and `paragraph.get("chapterId") not in chapter_ids` hash arbitrary JSON. Run with `PYTHONPATH=libs/python`: `{"schemaVersion":1,"documentId":"x","chapters":[{"id":[]}],"paragraphs":[]}` raises `TypeError: unhashable type: 'list'`, and so does a paragraph with `"chapterId": []`. `load_file` catches only `OSError` and `JSONDecodeError`, so the sidecars (`chapter_script.py:80` catches only `ManuscriptError`) would crash with a traceback on a corrupt file instead of the friendly error.
4. **Pure text and offset logic exists and is example-tested only.** Candidates read in code: `apps/desktop/internal/importer/richtext.go` (`richBuilder.build`, `spansOf`: UTF-16 offset spans, ADR 0014; `utf16Len` at `:96`), `markdown_inline.go` (`appendInline` and friends, hand-rolled emphasis parser), `headings.go` (`splitGluedHeading`, `headingParts`), `docx.go` and `pdf.go` (parse user-chosen files; `pdf.go` uses the third-party `giraffesyo/pdf`, and no `recover()` exists in `apps/desktop/internal/importer`), `apps/ui/src/components/manuscript/ParagraphView.tsx` (`composeAnnotationPieces` `:24`, `resolveNoteAnchor` `:46`, both exported), `Highlight.tsx` `highlightKind` (`:11`), `sidecars/manuscript-teleprompter/core/script_tracker.py` (`normalize_word`, `words_match`, `advance`, `locate`), `chapter_script.py:76` (`load_chapter_script` spans), `sidecars/transcript-compare/core/compare.py` (`tokenize` `:216`, `tokenize_with_raw`, `merge_number_words` `:271`, `split_sentences` `:314`). No fast-check, Hypothesis or `func Fuzz` exists (grep, excluding `.venv`). ADR 0026 (line identity) lives in Lua (`integrations/reaper/narration_ui_bridge.lua`), which none of these tools reach; no Go or Python line-identity logic was found.
5. **Coverage is unmeasured except in Go.** `go test -cover ./...` today: importer 85.1%, manuscript 73.2%, findings 100%, measure 96.4%, teleprompter 90.2%, tracks 94.4%, bridge 85.1%, recents 85.5%, assets 76.1%, settings 67.3%, whisper 66.7%, process 66.2%, tts 61.9%, guide 46.6%, root `shell` package 44.2%, transcript 38.4%, `cmd/manuscript-import` 0%. `@vitest/coverage-v8` and `pytest-cov`/`coverage` are not installed (`import coverage` fails); `vite.config.ts:6-15` sets no `coverage` block. The lockfile pins `vitest@4.1.11`, so the matching coverage package is `@vitest/coverage-v8@4.1.11` (this worktree's installed `node_modules` is stale at vitest 2.1.9; `pnpm install` first).
6. **Dead-code checking is manual.** `.claude/skills/feature-cleanup/SKILL.md` step 2 says to grep for references. `apps/ui/tsconfig.json` has no `noUnusedLocals`, and ESLint's `no-unused-vars` is a warning (`eslint.config.js`), so unused exports, files and dependencies are invisible to the gate. `pnpm-workspace.yaml` lists `apps/ui` and `apps/desktop` (the desktop app was `shell` before the layout move); `tools/ui-atlas-kit` has no `package.json` and is tested with `node --test`. Generated `apps/ui/wailsjs/` is imported only by `src/api/wailsClient.ts:33-34`. Stories are globbed in `.storybook/main.ts:4` and again with `import.meta.glob` in `src/stories.test.tsx:16`.
7. **Architecture facts a rule can encode today.** Non-story files in `components/primitives/` import nothing from feature folders, but `MeterBar.stories.tsx:4` imports `../manuscript/ChapterNav`. ADR 0016 says `Highlight.tsx` is "the only way to render highlighted text", yet `components/proofing/InlineDiffRow.tsx:27` renders its own `<mark>`. In Go, `net/http` is imported only by `apps/desktop/internal/assets/store.go` (the first-use download flow) and `apps/desktop/media.go`; `internal/measure` imports `internal/findings` and nothing that writes (`profile.go:6`). `script_tracker.py` imports only `difflib`, `re`, `dataclasses`, `functools` (ADR 0021 requires it engine-independent). The tool `core/` folders are loose modules loaded by path (`importlib.util.spec_from_file_location` in `test_script_tracker.py:7`), not importable packages; only `narration_common` is a real package.
8. **Playwright keeps nothing on failure.** `playwright.config.ts` sets `retries: 0`, `trace: 'off'`, `video: 'off'` (ADR 0023: no retries); CI uploads `apps/ui/screenshots` only, and `apps/ui/test-results/` is gitignored. `playwright.atlas.config.ts` is vendored from `tools/ui-atlas-kit` (header: do not edit here), so an atlas trace setting is a kit change. Installed Playwright is 1.63.0, whose `test.d.ts` documents `'retain-on-failure'` and contains `toMatchAriaSnapshot` (26 mentions).

## Proposed Solution

Deliver the five approved items as small, independently reviewable phases, each report-only or baseline-only first and a gate second: drop Black and add golangci-lint v2; measure coverage and gate the logic directories at the baseline; add Hypothesis, fast-check and Go fuzz targets on the modules in Evidence item 4; adopt Knip (report, then clean up, then gate) and wire it into `feature-cleanup`; encode three ADR-derived rules as dependency-cruiser, ESLint, depguard and pytest checks; and keep Playwright traces on failure plus aria-tree snapshots of dialogs, slide-overs and navigation once the Base UI migration has settled them.

## Key Hypothesis

We believe measurable, mechanical checks (properties, dead-code report, import rules, coverage floors, failure traces) will catch the regression classes that example tests and LLM review miss, for the maintainer who merges on green and the agent sessions that write the code. We'll know we're right when the property tests find or pin at least the one known bug and any new ones, the Knip and rule gates run at zero findings with no unexplained ignores, and a deliberately bad fixture for each rule and gate fails the build.

## What We're NOT Building

- **Chromatic** - a SaaS visual service, redundant with the Playwright gate, and it cannot see the WebView2 host.
- **MSW** - the app talks to Wails bindings, not HTTP (`api/client/http.ts` is dead code per the boundary PRD); the mock API already covers tests.
- **Playwright component testing** - the experimental React packages were removed; Playwright 1.62 replaced them with a stories/gallery model (URLs below), which overlaps the atlas. Revisit only if the atlas becomes a burden.
- **Mutation testing as a gate** - Stryker's Vitest runner does not support Browser Mode and mutmut needs `fork` (WSL only on Windows), both verified. At most an occasional manual run on parser modules after Phases 4-6.
- **Storybook Vitest addon** - only if atlas maintenance becomes a burden.
- **Vale** (prose lint), **eslint-plugin-jsx-a11y** (latest 6.10.2 declares an ESLint peer range topping out at `^9`, this repo is on ESLint `^10.10.0`, and it overlaps axe; revisit).
- **Python type checking as a gate** - see Open Question 11.
- **Crash reporting** - out by the privacy-first rule (ADR 0032 point 4: analysis is local).
- **Duplicating other PRDs** - axe on app states and the `-cpu` Go guard belong to `test-flakiness-and-visual-suite-stability.prd.md`; the Base UI import guard (ESLint) to `base-ui-primitive-foundation.prd.md`; wire-schema and golden payloads to `boundary-schema-validation.prd.md`; the host-binding AST guard (delivered as `hostguard_test.go`, see `docs/architecture/host-binding-concurrency.md`).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Black references | 0 (`pyproject.toml:7`, `[tool.black]`, `uv.lock`), `ruff format --check .` still green | grep; `pnpm check` |
| golangci-lint findings at the gate | 0 with errcheck, staticcheck, gosec on; pre-fix count measured: 127 (14 errcheck, 109 gosec, more than half of them in tests, 4 staticcheck quick-fixes); 0 after the phase 2 fixes and reasoned exclusions | CI `go` job and `pnpm check` |
| Coverage floors | Each logic directory gated at its measured baseline (Evidence item 5 for Go; Vitest and pytest measured in phase 3, see `scripts/ci/coverage-floors.json`); a deliberate drop fails | One demonstrated failing run per gate (done for Go, Vitest and pytest in the phase 3 PR); ratchet file diff |
| Properties | At least 8 Python, 6 fast-check, 3 Go fuzz targets; known `validate` TypeError fixed | Test counts; the RED run recorded in the Phase 4 PR |
| Knip | Report baseline recorded, then 0 unresolved findings; every `ignore` has a reason | `pnpm knip` in `pnpm check` and `js` job |
| Architecture rules | 4 rules (below), each with a bad fixture that fails; 0 violations at the gate | Fixture run per rule |
| Failure diagnostics | A failing `ui-visual` test leaves a trace zip in a CI artifact; passing tests keep none | Forced failure once on a branch |
| Aria snapshots | Dialog, ConfirmDialog, SlideOver and nav role trees pinned, 0 flakes over 20 runs | Playwright run; CI history |
| Added gate time | TBD - measure; target under 90 s total on CI | Job durations |

## Open Questions

- [x] **1. Coverage policy (the owner's global rule is 80%).** Options: (a) blanket 80% everywhere, which fails today for `apps/ui` components (unmeasured), `guide` (46.6%), `transcript` (38.4%) and the root `shell` package (44.2%), and rewards padding tests; (b) ratchet only: gate every package at its baseline and let it rise; (c) logic directories only, gated at baseline with an 80% target where a directory is already at or above it (importer, findings, measure, teleprompter, tracks, bridge, recents). Recommendation: (c), with the ratchet mechanism of (b) and 80% as the floor for any new logic directory. It is an explicit, logged deviation from the global rule for UI, glue and sidecar-launch code where coverage is cheap to game.
  **Answer (D18):** option (c); the ratchet mechanism of (b) and an 80% floor for any new logic directory. UI, glue and sidecar-launch code are exempt. Recorded as an ADR (a logged deviation from the global 80% rule).
- [x] **2. Replace standalone staticcheck with golangci-lint's, or run both?** Options: (a) replace (one tool, one config, one pin; removes `need-staticcheck` and the `toolchain.json` entry); (b) both; (c) golangci-lint with only errcheck and gosec. Recommendation: (a), enabling the `standard` defaults plus gosec. Installing via `golangci-lint-action` (documented as recommended and cached) versus a pinned binary on Windows and locally is TBD - needs research, as is compatibility of v2.13.2 with the Go 1.27.1 toolchain and `go 1.26.0` in `apps/desktop/go.mod`. If findings are numerous, start with a new-issues-only baseline (option name in the v2 schema: TBD - verify) so the host accessor's rewrites are not blocked.
  **Answer (D22):** (a), golangci-lint v2 with the `standard` defaults plus gosec, replacing standalone staticcheck. **Resolved in phase 2:** v2.13.2 is built with `go install` under the job's own Go toolchain (Go 1.27.1, module `go 1.26.0`; it took about 17 s locally), cached on `scripts/toolchain.json` like the Wails CLI, instead of a prebuilt binary or `golangci-lint-action`, so it never lags the Go version the module targets and the same pin serves Windows CI and local runs. No new-issues-only baseline was needed: the 127 findings were fixed or excluded with a written reason.
- [x] **3. Property test determinism.** Options: (a) random seeds in the gate (finds more, can flake); (b) derandomized in the gate (Hypothesis `derandomize`/`database=None`; a fixed fast-check `seed`), plus a manual or scheduled random run; (c) random with a stored failure database. Recommendation: (b), consistent with ADR 0023's stance that red must mean real; a failing random run becomes a checked-in example test.
  **Answer (D22):** (b), derandomized in the gate; a failing random run becomes a checked-in example test.
- [x] **4. The `validate` TypeError.** Options: (a) fix it in the same PR as the first Hypothesis test (RED then GREEN: reject non-hashable ids with `ManuscriptError`); (b) file an issue and mark the property expected-failure; (c) leave. Recommendation: (a); it is a two-line guard and the property is the regression test.
  **Answer (D22):** (a), fixed in the Hypothesis phase with RED then GREEN.
- [x] **5. Go fuzzing in CI.** Options: (a) seed corpus and checked-in `testdata/fuzz` regressions run by plain `go test` (free, deterministic), with fuzzing itself manual; (b) add `-fuzztime=30s` per target in CI; (c) a scheduled long run. Recommendation: (a), with (c) later if targets find something. Coverage-guided fuzzing needs amd64 or arm64 (documented), which this Windows machine and CI are; behavior of fuzzing workers on Windows is TBD - run once.
  **Answer (D22):** (a), seed corpus and `testdata/fuzz` regressions run by plain `go test`; fuzzing itself is manual.
- [x] **6. Knip strictness.** Options: (a) report-only forever; (b) report, one cleanup PR, then gate at zero with reasoned `ignore*` entries; (c) gate immediately with a baseline. Recommendation: (b). Run the default mode first (finds unused files and dependencies); consider `--production` for unused exports in shipped code later (it excludes tests, stories and devDependencies).
  **Answer (D22):** (b), report, one cleanup PR, then gate at zero with reasoned `ignore*` entries.
- [x] **7. Existing violations the new rules will report.** `MeterBar.stories.tsx:4` importing a feature module, and `InlineDiffRow.tsx:27` rendering its own `<mark>` against ADR 0016. Options: exempt (allow stories; leave the mark), or fix (move the shared `STATUS_*` constants out of `ChapterNav`; render the diff through `Highlight` or amend ADR 0016). Recommendation: fix the story import; put the `<mark>` case to the owner as a design question (it may deserve an ADR amendment rather than a code change) and start that rule with a one-entry, reasoned allowlist.
  **Answer (D22):** fix the story import; the `<mark>` case starts as a one-entry, reasoned allowlist and goes to the owner as a design question (Phase 9, a tail phase).
- [x] **8. Python architecture rule mechanism.** Options: (a) import-linter (2.15; forbidden contracts in `pyproject.toml`), which needs importable root packages, and the tool `core/` folders are loose modules; (b) a small pytest that parses `script_tracker.py` with `ast` and asserts stdlib-only imports (ADR 0021 point 3); (c) turn the tools into packages first. Recommendation: (b); use import-linter only for `narration_common` if it grows real layering.
  **Answer (D22):** (b), a pytest AST test.
- [x] **9. Placement of aria-snapshot specs.** Options: (a) inside `tests/visual` (breaks the one-test-per-state catalog contract); (b) a new `tests/aria/` with its own `playwright.aria.config.ts` reusing the `dev:mock` server, run as an extra step in the `ui-visual` job; (c) story `play()` checks in the atlas. Recommendation: (b), partial matching by default and `children: equal` only for the nav list. Sequenced after the Base UI dialog and drawer phases so the trees are pinned once.
  **Answer (D22):** (b), `tests/aria/` with its own config, after the Base UI dialog and drawer phases (Phase 12, a tail phase).
- [x] **10. Trace on the atlas config.** Options: (a) visual config and CI upload now, atlas via the kit's next release; (b) kit release now. Recommendation: (a); atlas serves a static Storybook where a trace adds little, and a kit release collides with `test-flakiness` Phases 3 and 6 and settings Phase 2.
  **Answer (D22):** (a), the visual config and CI upload now; the atlas via the kit's next release.
- [x] **11. Python type checking (non-blocking).** Options: (a) none now; (b) `ty` as an advisory, non-blocking CI step (latest is 0.0.82, a beta per the 0.0.x number); (c) mypy or pyright as a gate. Recommendation: (a); revisit (b) when `ty` reaches 1.0. Not a blocker for any phase.
  **Answer (D22):** (a), none now.

## Users & Context

**Primary User**
- **Who**: the maintainer and agent sessions that write and review code in `apps/ui`, `apps/desktop` and the Python sidecars.
- **Current behavior**: relies on `pnpm check`, then a human or model reading the diff for dead code and ADR conflicts; opens a failing Playwright run with nothing but a log line.
- **Trigger**: every PR; every `feature-cleanup` and `design-spec-guard` pass.
- **Success state**: a broken invariant, dead export or forbidden import fails a named check with a message that says which rule and why; a red Playwright job ships a trace.

**Job to Be Done**: When I finish a change, I want mechanical checks to catch what tests and review miss, so `feature-cleanup` and `design-spec-guard` become confirmation steps instead of investigations.

**Non-Users**: narrators and REAPER users see no change (one hardening fix to a corrupt-manuscript error path aside).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Drop Black; golangci-lint v2 in `quality.mjs`, `_quality.yml` and the Go job; coverage baselines measured and gated on logic directories |
| Must | Hypothesis properties on `validate`, `script_tracker`, `chapter_script`, `compare` tokenizing; fast-check properties on `composeAnnotationPieces`, `resolveNoteAnchor`, `highlightKind`; Go fuzz targets on importer parsers |
| Must | Knip report, cleanup, gate; `feature-cleanup` step 2 rewritten to run it |
| Should | dependency-cruiser and ESLint rules for `primitives/` layering and ADR 0016; depguard rules for `net/http` containment and analyzer isolation; pytest AST test for ADR 0021; Base UI import rule as a second guard once that PRD's Phase 1 lands |
| Should | Trace `retain-on-failure` plus CI upload for the visual suite; aria snapshots after the Base UI dialog and drawer phases |
| Could | Manual mutation run on parsers; `ty` advisory; atlas trace via kit release |
| Won't | See What We're NOT Building |

### MVP Scope

Phases 1 to 5 (cleanup, linter, coverage, and the two property-test stacks that already have a known bug). Knip, rules, traces and aria follow.

### User Flow

1. A developer or agent changes code and runs `pnpm check`; a new gate fails with a rule name (`knip`, a depcruise rule, a depguard `desc`, a coverage floor) and the reason.
2. A property test that fails prints a minimal counterexample and a seed to replay; it is copied into an example test.
3. A red `ui-visual` job has a downloadable trace for each failing test.

## Technical Approach

**Feasibility**: HIGH for every phase; the only design care is baselines (measure before gating) and serializing shared files.

**Architecture Notes**
- **Gate wiring.** Whole-repo gates go in `quality.mjs` `check` and `_quality.yml` only (not `staged`/lint-staged). Knip runs from the root; dependency-cruiser and fast-check live in `apps/ui` (CI runs Node 22, `setup-toolchain` `node-version: 22`; Knip needs `^20.19 || >=22.12` and dependency-cruiser `^22 || ^24 || >=26`, both satisfied).
- **Properties (concrete).** *`validate`*: for any JSON-shaped value it returns the input or raises `ManuscriptError` and nothing else (RED today, Evidence 3). *`advance`*: `start <= read`, `read <= max(start, len(script))`, `0 <= matched <= len(heard)`, `first is None` iff `matched == 0`, and composition (`advance(h1+h2, s, p)` equals advancing `h2` from `advance(h1, s, p).read`). *`locate`*: `jump` is `None`, `"restart"` or `"skip"`; a `"skip"` span lies at or after the anchor. *`words_match`*: reflexive, and symmetric for short words (symmetry of `SequenceMatcher.ratio` is not guaranteed; TBD - let the property decide, then fix or narrow). *`load_chapter_script`* (synthetic manuscripts): spans are contiguous, their counts sum to `len(tokens)`, and `script_words(script.text) == tokens`. *`tokenize_with_raw`*: equal-length lists; *`merge_number_words`*: output and index map equal length, non-number tokens unchanged, index map non-decreasing; *`split_sentences`*: no non-whitespace character lost or reordered (the split regex only consumes whitespace, `compare.py:60`); never raises on arbitrary Unicode. *`composeAnnotationPieces`* (offsets within `[0, len]`): pieces concatenate to `text`, each piece lists exactly the annotations covering it, format annotations sort innermost; never throws for out-of-range or negative offsets (its `slice` behavior there is TBD - decide whether callers or the function clamp). *`resolveNoteAnchor`*: if `anchorText` occurs in `text` the result slices to it (nearest occurrence to the stored start), a still-valid stored range is returned unchanged, and it never throws on any Unicode including astral characters. *`highlightKind`*: total over arbitrary strings, returns one of the kind names, unfamiliar categories degrade to `Review` (ADR 0016). *Go, as `testing.F` targets*: `appendInline` and `richBuilder.build` never panic on arbitrary bytes; every span has `0 <= Start < End <= utf16Len(text)`, is sorted, never splits a surrogate pair; text has no leading or trailing whitespace, no double spaces, no space beside `\n`; `isRoman`, `isChapterNumber` and `splitGluedHeading` never panic; `docx`/`pdf` entry points return an error, not a panic, on truncated or garbage archives (the `pdf` case guards a third-party parser). Cross-language check: Go-produced spans over astral text applied by the TS compositor, using the boundary PRD's golden payload mechanism (no duplicate fixture store).
- **Knip.** Config at the root with workspaces `.`, `apps/ui`, `apps/desktop`; `entry`/`project` for `tools/ui-atlas-kit` scripts and `scripts/**/*.mjs`; `ignore` `apps/ui/wailsjs/**` (generated; only `wailsClient.ts` imports it); plugins for vite, vitest, storybook, playwright, eslint, tailwind, prettier, typescript exist per Knip's plugin list. False-positive risks to test in Phase 7: stories and `import.meta.glob` (`stories.test.tsx:16`), Playwright specs under `tests/`, vendored kit files under `apps/ui/tests/`, exported contract types in `src/types.ts` and `api/contracts/`, and `@base-ui/react` once added. Whether Knip reads `pnpm-workspace.yaml` or needs explicit workspaces is TBD - verify.
- **Rules (3 ADR-derived, plus the Base UI second guard).** (1) ADR 0016: ESLint `no-restricted-syntax` on JSX `mark` outside `primitives/Highlight.tsx`. (2) ADR 0032 point 4 with ADR 0012: depguard denies `net/http` except in `internal/assets` and `media.go`, and denies `internal/manuscript`, `internal/guide`, `internal/settings` and `internal/recents` from `internal/measure` and `internal/findings` (analyzers report, they do not write; point 1). (3) ADR 0021 point 3: pytest AST test that `script_tracker.py` imports stdlib only. Not an ADR but a convention worth recording in the ADR this PRD writes: dependency-cruiser forbids `components/primitives/**` importing feature folders (`home`, `layout`, `manuscript`, `project`, `proofing`, `settings`, `storybible`, `teleprompter`, `tracks`) and `src/**` outside `api/` importing `wailsjs`. `design-spec-guard` stays for judgement calls (which tokens, which look); these rules cover only the mechanical subset and the skill should cite them so it stops re-checking them.
- **Coverage gates.** Vitest `coverage.thresholds` on `src/api`, `src/state.ts`, `src/hooks` and other logic files (not components); `pytest --cov=<dirs> --cov-fail-under=<baseline>` (pytest-cov 7.1.0; path-based `--cov` for the loose tool modules, TBD - measure); Go: `go test -cover` has no threshold flag, so a small `scripts/coverage-gate.mjs` reads a checked-in floors file and is tested with `node --test` like the other scripts.
- **Black to ruff.** Delete `black` from `dependencies`, the `[tool.black]` table, run `uv lock`; no reformat needed (Evidence 2).
- **CLAUDE.md gates.** Phases 9, 11 and 12 touch `apps/ui`: run the visual suite and atlas per CLAUDE.md. Phases touching only tests or config need `pnpm check`. No `integrations/reaper` change is made by this PRD (the Lua harness of owner decision D2 belongs to stack S09).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Property tests flake or run slowly on CI | Medium | Derandomized seeds and fixed example counts in the gate (Q3); measure duration |
| Knip false positives make the gate noisy | High | Report-only first; each `ignore` needs a reason; cleanup PR before gating |
| golangci-lint and the Go toolchain versions mismatch (Go 1.27.1 vs the linter's build) | Medium | Pin a version; verify locally and on CI before removing standalone staticcheck (TBD) |
| gosec or errcheck flood in `bindings.go` after the host accessor work rewrote it | Medium | New-issues-only baseline; land linter before or after those phases, not during |
| Coverage floors on tool modules loaded by path read 0% | Medium | Measure first; use path-based `--cov`; fall back to `narration_common` only |
| Aria snapshots churn while Base UI changes the trees | High | Sequence after Base UI Phases 2 and 4 |
| Root-level `pnpm knip` and shared lockfile edits collide with other PRDs | High | See compatibility table; serialize `package.json` and `pnpm-lock.yaml` edits |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Drop Black | Remove dependency, `[tool.black]`, lock entry; confirm `ruff format` is the only formatter | complete | Yes | - | [plan](implementation-plan.md) |
| 2 | golangci-lint v2 | Config, pinned install, `quality.mjs`, `_quality.yml` `go` job, replace standalone staticcheck, docs | complete | Yes | - | [plan](implementation-plan.md) |
| 3 | Coverage baselines and ratchet | Install coverage packages, measure Vitest and pytest, floors file, gates for logic directories | complete | Yes | - | [plan](implementation-plan.md) |
| 4 | Hypothesis properties | pytest plus `hypothesis`, `validate` fix, tracker, chapter script and compare properties | pending | Yes | - | - |
| 5 | fast-check properties | `fast-check` in `apps/ui`, `ParagraphView`, `Highlight` properties, Go-to-TS offset check | pending | Yes | - | - |
| 6 | Go fuzz targets | `FuzzXxx` for richtext, inline markdown, headings, docx and pdf entry points; seed corpus | pending | Yes | - | - |
| 7 | Knip report | Config, plugins, ignores, first report and false-positive triage; report-only | pending | Yes | - | - |
| 8 | Knip cleanup and gate | Remove findings, gate at zero in `quality.mjs` and `js` job, rewrite `feature-cleanup` step 2 | pending | No | 7 | - |
| 9 | UI architecture rules | dependency-cruiser and ESLint rules, ADR 0016 rule, story import fix, Base UI second guard, bad fixtures | pending | Partly | Base UI Phase 1 for the guard | - |
| 10 | Go and Python rules | depguard rules in the golangci config, pytest AST test for ADR 0021, bad fixtures | pending | Yes | 2 | - |
| 11 | Playwright traces | `trace: 'retain-on-failure'`, upload `test-results`, docs | pending | Yes | - | - |
| 12 | Aria snapshots | `tests/aria/`, pinned trees for dialogs, slide-overs, nav | pending | No | 11, Base UI Phases 2 and 4 | - |

### Phase Details

**Phase 1 - Drop Black.** Goal: one formatter. Scope: `pyproject.toml` (dependency line 7, `[tool.black]` at 28), `uv.lock` via `uv lock`, a grep for stray references. Success signal: `uv run ruff format --check .` and pytest green; zero Black references outside history.

**Phase 2 - golangci-lint v2.** Goal: errcheck, staticcheck and gosec in the Go gate. Scope: `apps/desktop/.golangci.yml` (`version: "2"`, standard defaults plus gosec), pinned install (action or binary, TBD), `scripts/quality.mjs` step replacing `staticcheck`, `_quality.yml` `go` job, `setup-toolchain` and `toolchain.json` cleanup, a line in `docs/operations/ci-and-releases.md`. Success signal: green on the Windows job and locally; a deliberate unchecked error fails; findings fixed or excluded with a reason each.

**Phase 3 - Coverage baselines and ratchet.** *Delivered:* `@vitest/coverage-v8@4.1.11` and `pytest-cov==7.1.0` (MIT; dev-only, AGPL-compatible) added; baselines and gate as in [ADR 0043](../adr/0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md); nine Go packages, four UI paths and six Python files are gated (the rest are exempt glue, listed in the floors file). *Original scope:* Goal: numbers exist and cannot silently fall. Scope: `@vitest/coverage-v8@4.1.11` and `pytest-cov`, `vite.config.ts` `test.coverage`, `pyproject.toml` pytest options, `scripts/coverage-gate.mjs` plus a floors file and test, `quality.mjs` and CI steps. Success signal: baselines recorded in the PR, floors equal baselines (rounded down), a deliberate drop fails each gate.

**Phase 4 - Hypothesis.** Goal: Python text and alignment logic under properties. Scope: `hypothesis` in `pyproject.toml`/`uv.lock`, a settings profile (derandomized), test files beside the existing ones, the `validate` guard in `manuscript.py`. Success signal: the `validate` property fails first (RED), passes after; suite time added recorded; `.hypothesis/` gitignored.

**Phase 5 - fast-check.** Goal: offset and anchor logic under properties. Scope: `fast-check` (4.10.2 today) with `@fast-check/vitest` (recommended by its docs, version TBD), property tests next to `ParagraphView` and `Highlight`, a fixed global seed. Success signal: properties pass and a mutated compositor fails them.

**Phase 6 - Go fuzz.** Goal: parsers cannot panic on user files. Scope: `*_test.go` in `apps/desktop/internal/importer` with seed corpora from existing test inputs and committed `testdata/fuzz` regressions; one manual 60 s fuzz run per target recorded. Success signal: `go test` runs seeds green; any crash found is fixed and committed as a corpus entry.

**Phase 7 - Knip report.** Goal: a triaged, reproducible report. Scope: root `knip.json`, root devDependency and `knip` script, notes on each false-positive class. Success signal: report count recorded; every ignore explained; no gate change.

**Phase 8 - Knip cleanup and gate.** Goal: gate at zero. Scope: deletions and dependency removals it finds (via `feature-cleanup` rules), `quality.mjs` and `js` job step, `.claude/skills/feature-cleanup/SKILL.md` step 2. Success signal: `pnpm check` and full Playwright suites green after deletions; a planted unused export fails.

**Phase 9 - UI architecture rules.** Goal: ADR 0016 and primitives layering enforced. Scope: `apps/ui/.dependency-cruiser.cjs`, `eslint.config.js` block, `package.json` script, `MeterBar.stories.tsx` fix, `InlineDiffRow` decision (Q7), docs in `docs/design/design-system.md`, one ADR recording the rules (number checked at merge). Success signal: a bad fixture per rule fails; `design-spec-guard` updated to cite them; visual suite unchanged.

**Phase 10 - Go and Python rules.** Goal: ADR 0032 and 0021 mechanically checked. Scope: depguard section of the Phase 2 config, `libs/python/tests/` or `sidecars/manuscript-teleprompter/tests/` AST test. Success signal: importing `net/http` in `internal/tracks`, or `live_asr` in `script_tracker.py`, fails.

**Phase 11 - Playwright traces.** Goal: a red visual run is debuggable. Scope: `playwright.config.ts` `trace: 'retain-on-failure'`, an `upload-artifact` step for `apps/ui/test-results` (`if: always()`, short retention) in `ui-visual`, a note on opening the trace. Success signal: forced failure yields a trace; passing runs upload nothing large.

**Phase 12 - Aria snapshots.** Goal: dialog, slide-over and nav semantics cannot regress silently. Scope: `tests/aria/*.spec.ts`, `playwright.aria.config.ts`, `.aria.yml` snapshots, CI step in `ui-visual`. Success signal: snapshots stable over 20 runs; a removed `role="dialog"` fails.

### Parallelism Notes

Phases 1, 2, 3, 4, 5, 6, 7 and 11 touch mostly disjoint files and can run in parallel; serialize edits to `scripts/quality.mjs`, `_quality.yml`, `pyproject.toml`, `apps/ui/package.json` and `pnpm-lock.yaml`. Phase 8 follows 7; Phase 10 follows 2 (same config file); Phase 12 waits for 11 and the Base UI dialog and drawer phases; Phase 9's Base UI guard waits for that PRD's Phase 1.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `pyproject.toml`, `uv.lock` | Low; Phase 4 and `docs-security` Phase 7-8 also edit `pyproject.toml`/`uv.lock` |
| 2 | `apps/desktop/.golangci.yml`, `scripts/quality.mjs`, `_quality.yml` `go` job, `setup-toolchain`, `scripts/toolchain.json` | Medium: `test-flakiness` Phase 4 edits the same `go` job; the delivered host accessor work rewrote `bindings.go` (baseline) |
| 3 | `vite.config.ts` `test` block, `pyproject.toml`, `quality.mjs`, `_quality.yml`, new `scripts/coverage-gate.mjs` | Medium: `test-flakiness` Phase 1 edits the same `test` block (`testTimeout`) |
| 4, 5 | new test files, `pyproject.toml`/`uv.lock`, `apps/ui/package.json`/lockfile, `libs/python/narration_common/manuscript.py` | Medium: lockfile edits from Base UI Phase 1 and `boundary-schema` Phase 1 (Zod); `boundary-schema` Phase 3 also adds golden payload tests |
| 6 | `apps/desktop/internal/importer/*_test.go`, `testdata/fuzz` | Low; `story-bible-and-import-ux-briefs` edits importer code |
| 7, 8 | root `package.json`, `knip.json`, `quality.mjs`, `_quality.yml` `js` job, `.claude/skills/feature-cleanup`, deletions across `apps/ui/src` | High for 8 (deletions touch files other PRDs edit; land in a quiet window, rebase); `docs-security` Phase 3 also edits `feature-cleanup` |
| 9 | `apps/ui/eslint.config.js`, `.dependency-cruiser.cjs`, `MeterBar.stories.tsx`, `InlineDiffRow.tsx`, `design-system.md`, `docs/adr/` | High: Base UI Phase 1 and `boundary-schema` Phase 3 both edit `eslint.config.js`; ADR number re-checked at merge |
| 10 | Phase 2's config, Python test dirs | Low |
| 11 | `playwright.config.ts`, `_quality.yml` `ui-visual` job | Medium: `test-flakiness` Phase 6 edits the `ui-visual` job and the kit's `capture.ts`; the atlas config stays vendored |
| 12 | new `tests/aria/`, `playwright.aria.config.ts`, `_quality.yml` | High until Base UI Phases 2 and 4 land; no `hostAPIVersion` bump anywhere in this PRD |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Five tooling items approved (owner decision, 2026-09-20) | Build them as phased work | Skip | Owner judged them worth doing |
| Deferred set (owner decision, 2026-09-20): Chromatic, MSW, Playwright component testing, mutation gate, Storybook Vitest addon, Vale, jsx-a11y, Python type checking, crash reporting | Not built here | Build | See What We're NOT Building |
| No retries, red means real (prior decision, ADR 0023) | Derandomized property tests; no retry to pass | Random seeds, retries | Preserves trust in red |
| Report-only before gating (proposed) | Knip, coverage, golangci-lint start as baselines | Immediate gates | Avoids a wall of red |
| Coverage policy (proposed, Q1) | Logic directories only, ratchet, 80% where already met | Blanket 80%, ratchet all | Deviates from the global 80% rule on purpose |
| Drop Black (owner decision) | Ruff only | Keep both | Unused; zero format differences measured |
| Coverage gate shape (phase 3, [ADR 0043](../adr/0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md)) | One script, `scripts/ci/coverage-gate.mjs`, run by each project's `test` target (Go statements, Vitest v8 lines, pytest-cov lines) against one file, `scripts/ci/coverage-floors.json`; floors rounded down and raised with `--update`; an entry below 80 needs a `reason`; missing data fails | Vitest `coverage.thresholds` plus `--cov-fail-under` plus a Go script (three mechanisms, three files) | One ratchet to explain, one place to review floor changes, testable with `node --test`; lives under `scripts/ci/` so the existing `test-node` glob runs its test and `nx-scope.sh` treats it as workspace-wide |
| Replace standalone staticcheck (proposed, Q2) | golangci-lint's staticcheck | Run both | One config and pin |
| golangci-lint config (phase 2) | `standard` plus gosec; report everything (`max-issues-per-linter` and `max-same-issues` at 0); gosec G304 excluded (a local app opens the files the person chose), G301 excluded (project and data directories stay 0755 so a shared project remains readable; files are 0600), G204/G702 excluded in `internal/process` (it launches host-resolved sidecars), gosec off in `_test.go`; other findings fixed (`_ = Close()` on read-only handles, checked write closes, boolean and switch rewrites) or `//nolint:gosec` with a reason | Blanket per-line `nolint`, a baseline file | The exclusions are documented in `apps/desktop/.golangci.yml`; findings that reveal a real risk stay on |
| Python rule mechanism (proposed, Q8) | pytest AST test | import-linter | Tools are loose modules |
| ADR-derived rules (proposed) | 0016, 0032, 0021 | Others (0003, 0009 already covered by `legacyCss.test.ts`; 0026 is Lua) | Mechanically checkable, one per stack |
| Nothing merges without the user (prior decision) | One PR per phase | - | Standing rule |
| Coverage policy (owner decision D18, 2026-09-20; Q1) | Ratchet on logic directories; 80% floor for any new logic directory; UI, glue and sidecar-launch code exempt | Blanket 80%, ratchet everywhere | Logged deviation from the global 80% rule; recorded in an ADR |
| Open questions Q2-Q11 (owner decision D22) | Each PRD recommendation adopted as written | - | Owner instruction: every question not listed in the plan takes the stated recommendation |
| Lua harness (owner decision D2) | Pulled forward into stack S09; not built here | Build it in this PRD | "No `integrations/reaper` change" here is still true; the harness is another PRD's phase |
| Zod (owner decision D16) | Add Zod to Knip's false-positive list only when it lands | Pre-emptive ignore | Avoids an unexplained ignore |
| New tool dependencies (owner decision D17) | Must be AGPL-compatible; checked per tool in each phase | - | The project is AGPL-3.0-or-later ([ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md)) |
| Phases 9 and 12 stay open (stack S05) | Tail phases after the Base UI stack (S10) | Build now on unsettled primitives | They pin the Base UI trees and guard the Base UI imports |

## Research Summary

**Market Context**
- All five families are mainstream: property testing (Hypothesis 6.168.0, fast-check 4.10.2, Go native fuzzing), dead-code analysis (Knip 6.37.0), import-boundary rules (dependency-cruiser 18.3.1, depguard, import-linter 2.15), coverage ratchets, and Playwright trace and aria-snapshot support (checked 2026-09-20 via the npm and PyPI registries).
- Sources: golangci-lint changelog (latest v2.13.2, 2026-08-28) https://golangci-lint.run/docs/product/changelog/ ; linters list (gosec, depguard available) https://golangci-lint.run/docs/linters/configuration/ ; CI guidance (use the action, pin a version) https://golangci-lint.run/docs/welcome/install/ci/ ; Knip https://knip.dev/overview/getting-started (v6), https://knip.dev/reference/plugins, https://knip.dev/reference/cli (`--production`, `--no-exit-code`, `--reporter`), https://knip.dev/reference/configuration ; dependency-cruiser https://github.com/sverweij/dependency-cruiser ; import-linter https://import-linter.readthedocs.io/en/stable/usage.html (via search) ; Go fuzzing https://go.dev/doc/security/fuzz/ (seed corpus runs under `go test`, failures in `testdata/fuzz`, coverage instrumentation on amd64 and arm64) ; fast-check with Vitest https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-vitest/ ; Hypothesis https://hypothesis.readthedocs.io/en/latest/quickstart.html ; Playwright https://playwright.dev/docs/aria-snapshots and https://playwright.dev/docs/trace-viewer-intro ; Stryker limits https://stryker-mutator.io/docs/stryker-js/vitest-runner/ ; mutmut https://github.com/boxed/mutmut ; Playwright component testing replacement https://playwright.dev/docs/test-components and https://playwright.dev/docs/release-notes.

**Technical Context**
- Verified in code or by running commands: the gate lists (Evidence 1), Black's zero-difference state, the `validate` TypeError, Go coverage per package, Node 22 in CI, the module candidates and boundaries in Evidence 4 and 7, `trace`/`retries` settings, vendored atlas config, Playwright 1.63.0 API presence, the stale local `node_modules` (vitest 2.1.9 vs lock 4.1.11).
- Not verified (TBD - needs research): golangci-lint v2.13.2 against Go 1.27.1 and its Windows install path; the v2 new-issues-only option name; whether Knip auto-detects `pnpm-workspace.yaml` and how its Playwright plugin finds `testDir`; whether `@fast-check/vitest` is needed with Vitest 4 (its docs recommend it; its current version was not checked); Vitest and pytest coverage baselines; Go fuzz worker behavior on Windows; added CI time; the real symmetry of `words_match`; `composeAnnotationPieces` behavior with negative offsets; the deferred-item claims beyond the sources above (Chromatic and WebView2 rest on the owner brief).
- Overlap and conflicts with sibling PRDs: `test-flakiness-and-visual-suite-stability.prd.md` (its Technical Context says "Vitest 2", but the lock pins 4.1.11; it names a `github-scripts` job while this branch's `_quality.yml` has `repo-scripts`; it edits the same `go` and `ui-visual` jobs and `vite.config.ts` `test` block; it keeps axe on app states and `-cpu` guards, which this PRD does not duplicate); `base-ui-primitive-foundation.prd.md` (owns the Base UI ESLint guard, edits `eslint.config.js` and the lockfile, and its dialog and drawer phases gate Phase 12); `boundary-schema-validation.prd.md` (adds an ESLint cast rule to `eslint.config.js`, owns golden payloads); `docs-security-and-hygiene.prd.md` (edits `scripts/quality.mjs`, `pyproject.toml`, `feature-cleanup`); `docs/architecture/host-binding-concurrency.md` (its AST guard, `hostguard_test.go`, is a different, intra-package check; that work added no third-party linter, and golangci-lint does not provide such a check).

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
