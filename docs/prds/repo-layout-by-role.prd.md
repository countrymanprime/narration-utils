# Repo Layout by Role: Retire `shared/`, Move `shell/`, Normalize Tests, Use Nx per Project

**Source:** user request of 2026-09-20 ("investigate how a repo like ours SHOULD be laid out"; then "go with the full changes from the research doc ... i do want to move shell and some of the other things"). The research and its citations are in [docs/research/repo-layout-alignment.md](../research/repo-layout-alignment.md). Citations here are `file:line` on branch `claude/repo-structure-organization-84ae38` at 155c275. Nothing here is built yet.

**Reconciled 2026-09-20** with owner decision D15 of [implementation-plan.md](implementation-plan.md): one atomic move, `apps/desktop`, the Go module path kept, top-level `sidecars/`, tests in `<project>/tests/`, Nx per project as a follow-up phase. Delivered as stacked PRs (issue #54): phases 1-2, then 3, then 4, then 5. The open questions below carry the decisions; where the body still reads as a proposal, the Decisions Log wins.

## Problem Statement

The top level of the repo no longer says what is in it. `shared/` holds the React app, a Python library, the REAPER Lua bridge, config JSON, test fixtures and a README; `tools/` mixes product code (three Python sidecars frozen into the app) with one real dev tool; `shell/` is the desktop app but reads like a leftover. Tests follow five different conventions, and a dead Tauri icon folder sits inside the Go host. For a repo that several sessions change at once and that ships often, every new contributor or agent has to learn by grep where things live.

## Evidence

- **Dead icon folder.** `shell/src-tauri/icons/` holds four files. Nothing tracked mentions `tauri` (case-insensitive). `128x128@2x.png` and `icon.ico` are byte-identical (same SHA-1) to `shell/build/appicon.png` and `shell/build/windows/icon.ico`, the files Wails reads and `.gitignore:22-26` whitelists. `128x128.png` and `32x32.png` have no counterpart.
- **`shared/` is a grab bag.**
  - `shared/ui` is consumed only by `shell` (`shell/wails.json:5` `frontend:dir`, `shell/main.go` embed, `scripts/copy-wails-frontend.mjs`).
  - `shared/reaper` is an integration (no automated tests).
  - `shared/python` is the only truly shared code.
  - `shared/config`, `shared/test-fixtures` and `shared/audacity` (one README) are unrelated to each other.
- **`tools/` mixes roles.** `tools/{manuscript-guide,manuscript-teleprompter,transcript-compare}` are packaged sidecars (`docs/architecture/codebase-map.md`, "Sidecar boundary"); `tools/ui-atlas-kit` is a versioned dev plugin with its own CHANGELOG.
- **Tests, by stack.** Go and TS unit tests are colocated (forced or default for their toolchains). Visual and atlas suites live in `shared/ui/tests/`. Python has three patterns: `shared/python/tests/`, `tools/*/core/tests/`, and two outliers, `tools/manuscript-teleprompter/spikes/test_moonshine_probe.py` and `scripts/release/test_prepare_resources.py`. Node script tests are colocated. Lua has none. The Python tests load their module by file path (`tools/transcript-compare/core/tests/test_compare.py` builds `parents[1] / "compare.py"`), so moving them needs a path edit each.
- **Nx is release-only.** `nx.json` has only `release` and `analytics`; `project.json` is one project whose `test` and `lint` targets run `shared/ui` only. Affected detection is hand-rolled in `scripts/ci/changed-files.mjs`; `scripts/quality.mjs` runs each stack serially.
- **Paths are hard-coded in runtime code, not only config.**
  - `shell/app.go:517` finds the repo root by looking for `shared/config/defaults.json`.
  - `shell/app.go:144,154,162` join `shared/reaper` and `shared/config`.
  - `shell/app.go:540,546,552` join `tools/<sidecar>/core/<file>.py`.
  - `shell/internal/settings/store.go:53` reads `shared/config/defaults.json`.
  - `shared/python/narration_common/config.py:59` documents the same file.
  - `scripts/release/prepare-resources.py:22,100-105` copies from `shared/python` and `tools/`.
- **Reference counts** (tracked files, excluding lockfile and images): `shared/ui` 93, `tools/` 55, `shared/reaper` 41, `shared/config` 27, `shared/python` 12. About 30 PRDs and 16 ADRs cite these paths.
- **In flight.** No open pull requests at 2026-09-20, but seven worktrees and about twenty local branches exist under the old layout.
- **The README layout tree is already stale** (`README.md:35` lists `daws/reaper/`, which does not exist).

## Proposed Solution

Name every top-level folder for its role, keep tests where their toolchain wants them, and give each project its own Nx project.

```
apps/
  desktop/        <- shell/           Go/Wails host; keeps build/ icons
  ui/             <- shared/ui/       React app (its visual and atlas suites stay inside)
sidecars/         <- tools/manuscript-guide, manuscript-teleprompter, transcript-compare
libs/
  python/         <- shared/python/   narration_common (+ config_cli.py)
integrations/
  reaper/         <- shared/reaper/   Lua bridge
  audacity/       <- shared/audacity/ + tools/*/daws/audacity
config/           <- shared/config/
tests/
  fixtures/       <- shared/test-fixtures/
tools/
  ui-atlas-kit/   stays (dev tooling only)
scripts/          stays
docs/             stays
```

**Test rule:** tests follow the toolchain. Colocate where it wants that (Go, Vitest, Storybook, `node:test` scripts). Otherwise each project has one `tests/` folder at its root. Cross-project tests and shared fixtures live in the top-level `tests/`. A project's Playwright suite stays with that project because `ui-atlas-kit` scaffolds it there.

## Key Hypothesis

We believe role-based top-level names, one test rule and per-project Nx targets will let a new contributor or agent place and find code without grepping, and let CI run only what a change affects. We'll know we're right when the top level matches the allowlist test, no tracked file outside ADRs names an old root, and a one-file change in one project runs only that project and its dependents.

## What We're NOT Building

- Any restructuring inside a project (Go package layout, `shared/ui/src` component layout). Directories move whole.
- A fully unified `tests/` folder for unit tests. Go cannot do it and Vitest and Storybook assume colocation ([research](../research/repo-layout-alignment.md)).
- Renaming the executable, package names (`narration-utils-shell`, `narration-utils-ui`) or the Nx release project (`narration-utils`). Executable naming belongs to [Release Artifact Naming](release-artifact-naming.prd.md); this PRD supersedes only that PRD's non-goal about the `shell/` directory.
- Changing the packaged resource layout (`resources/{config,reaper,runtime}`), the Wails bindings, or any user-visible behavior.
- A uv workspace or `src/` layout for Python.
- Per-path CODEOWNERS (add when a second maintainer exists; today it is one `*` rule).
- Rewriting ADR text. ADRs are immutable; a path map in the new ADR covers the old names.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Old roots gone | 0 tracked files outside `docs/adr/` name `shared/`, `shell/`, `tools/manuscript-*`, `tools/transcript-compare` | `git grep` in the guard test |
| Top level is intentional | Only allowlisted entries at repo root | New top-level allowlist test in `pnpm check` |
| History intact | Rename commit shows 100% similarity for moved files; `git log --follow` works | `git diff -M --stat` on the rename commit |
| Nothing regressed | Full gate green | `pnpm check`, `go test -race`, `pytest`, visual suite (three viewports), `pnpm --dir apps/ui atlas` |
| Runtime paths work | Checkout run finds sidecars, catalogs, launcher; packaged build unchanged | `wails build` on Windows and a launch; `prepare-resources.py` output diff is empty |
| REAPER still works | Launcher loads and opens the app from the new path | Manual, per `full-verification-gate` (Lua has no tests) |
| Nx does its job | Editing one file in `libs/python` runs Python tests and dependents only | `nx affected -t test` output |

## Open Questions

- [x] **A1. One PR or several?** Decided (D15): (a), one atomic PR for the move, in two commits (a pure `git mv` commit at 100% similarity, then the reference fixes). The cleanup and prep (phases 1-2) land first as their own PR; Nx (phase 4) and steady state (phase 5) follow.
  Options were: (a) one atomic mechanical PR for all moves, one conflict window (recommended: the repo has many in-flight branches, so a short window matters more than a small diff); (b) five PRs in this order: config, fixtures and audacity; Python and sidecars; REAPER; UI; desktop. Mixed layouts exist between PRs and every PR still runs the full gate.
- [x] **A2. Name for the desktop app.** Decided (D15): `apps/desktop`.
  Options were: `apps/desktop` (recommended; docs and `wails.json` call it the desktop host), `apps/shell`. The package name stays `narration-utils-shell` either way.
- [x] **A3. Go module path.** Decided (D15): keep `github.com/countrymanprime/narration-utils/shell`.
  Options were: keep `github.com/countrymanprime/narration-utils/shell` (recommended; nothing imports it, and changing it rewrites every import in about 70 files), or rename it to `.../apps/desktop`.
- [x] **A4. `sidecars/` at the top level or `apps/sidecars/`.** Decided (D15): top-level `sidecars/`.
  Context: They are deployable programs bundled into the desktop app, so `apps/` is defensible and saves one top-level folder (eight instead of nine). Recommendation: top-level `sidecars/`, as in the research, because they are not user-facing apps.
- [x] **A5. Where sidecar tests live.** Decided (D15): `sidecars/<name>/tests/`.
  Options were: `sidecars/<name>/tests/` (recommended; one `tests/` per project) or keep `core/tests/`. Either needs no source change beyond the file-path lookups.
- [x] **A6. How far to take Nx.** Decided (D15): (a), a `project.json` per project with `build`/`test`/`lint`, `pnpm check` and CI calling `nx affected`, in phase 4 after the move is green.
  Options were: (a) per-project `project.json` with `build`/`test`/`lint`, `pnpm check` and CI call `nx affected`, `changed-files.mjs` and the serial runner shrink (recommended, Phase 4); (b) define projects and targets but keep `quality.mjs` as the gate; (c) leave Nx release-only and document that.
- [x] **A7. Local skills.** Decided (D15): they stay untracked; the phase 3 author updates them locally after the move (no PR).
  Question was: `.claude/skills/*` (six skills) cite these paths but are untracked (`.claude/` is ignored), so no PR can fix them. Who updates them, and do they move into the repo?
- [x] **A8. Anything else to move?** Decided (D22, the recommendation): no. `scripts/`, `docs/` and `tools/ui-atlas-kit` stay. `LICENSE` stays at the repo root and is on the allowlist.
  Question was: The research left `scripts/`, `docs/` and `tools/ui-atlas-kit` in place. Confirm.

## Users & Context

**Primary User**: the maintainer and the Claude sessions that work in parallel worktrees.
**Current behavior**: finds code by grep, guesses whether `shared/` means shared, and runs the whole gate for any change.
**Success state**: the folder name says the role; the test rule is one sentence; CI runs what changed.
**Job to Be Done**: When I open the repo or start a session, I want the layout to tell me where code and tests belong, so changes land in the right place and review stays fast.

## Solution Detail

| Priority | Capability |
| --- | --- |
| Must | Delete `shell/src-tauri/`; resolve `shell/ui/index.html` (no references found) |
| Must | Move every folder in the target tree with `git mv`, then fix every reference (config, scripts, workflows, Go and Python runtime paths, docs, PRDs) |
| Must | Sidecar and library tests normalized to `<project>/tests/`; the two outlier Python tests moved; pytest `testpaths` set and `--basetemp` moved out of the repo root |
| Must | Top-level allowlist test and an old-root guard in `pnpm check` |
| Must | ADR recording the layout and test rule, with an old-to-new path map; `codebase-map.md` and `README.md` rewritten |
| Should | One place for repo-relative paths in Go (a `layout.go`) and in `prepare-resources.py`, so the next move is a one-line change |
| Should | Per-project Nx targets, `nx affected` in CI and `pnpm check` (A6) |
| Could | Fold `sidecars/` under `apps/` (A4) |
| Won't | Inner restructuring, executable or package renames, CODEOWNERS split |

**User flow (maintainer)**: cleanup PR merges; prep PR merges; freeze window opens; rename PR merges after the gate and a manual REAPER check; open branches merge `main` (git follows the renames) and run the guard to catch stale path text; Nx PR lands last.

## Technical Approach

**Feasibility**: HIGH for the moves (mechanical), MEDIUM for Nx (new behavior in CI).

**Architecture notes**
- **Two commits in the rename PR.** First a pure `git mv` commit (100% similarity), then a reference-fix commit. Reviewers can verify the first with `git diff -M --stat` and read only the second.
- **Codemod, not hand edits.** An anchored old-to-new replace map (for example `shared/ui` to `apps/ui`, `shell/` to `apps/desktop/`, applied to path contexts only so it does not touch the word "shell" in prose or `shell: bash` in workflows) run once from a scratch script, then checked by the guard. The map is published in the new ADR so open branches can re-run it.
- **Runtime paths.** Update the repo-root marker (`config/defaults.json`), the joins at `shell/app.go:144-162,540-552`, `internal/settings/store.go:53` and `prepare-resources.py`. The packaged layout under `resources/` must not change; verify by diffing `prepare-resources.py` output before and after.
- **pnpm.** `pnpm-workspace.yaml:2-3` and the `pnpm-lock.yaml` importer keys change; regenerate the lockfile in the same PR or CI's frozen install fails. `node_modules` junctions break when a directory moves, so run `pnpm install` afterwards.
- **Wails.** `wails.json` `frontend:dir` becomes `../ui`; `frontend:build` still runs `scripts/copy-wails-frontend.mjs`, whose source and destination paths change. `go -C apps/desktop` becomes `go -C apps/desktop` in `scripts/quality.mjs`, `_quality.yml`, `build-native/action.yml`, `setup-toolchain/action.yml` (go.sum cache path).
- **`ui-atlas-kit`.** `shared/ui/ui-atlas.config.json` (`UI_ROOT`), the dogfood and hook tests, and the kit docs cite `shared/ui`. Check whether a path-only edit to kit tests and docs needs a kit version bump before touching the vendored core files.
- **Nx.** Per-project `project.json` files with `implicitDependencies` (desktop depends on ui and sidecars; sidecars on `libs/python`). Do not touch the `release` block or `releaseTag.pattern`; the `v{version}-rc` pattern is what makes Nx see RC tags.
- **Guard test.** A `node:test` under `scripts/ci/` asserting the top-level entries against an allowlist and that no tracked file outside `docs/adr/` (and `pnpm-lock.yaml`, images) contains an old root.

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Merge conflicts across seven worktrees and about twenty branches | High | Land in a quiet window after open work merges; git follows renames; guard test catches text drift; publish the path map |
| Go or Python runtime path missed (checkout works, packaged build breaks, or the reverse) | Medium | Grep the runtime call sites listed above; run both a checkout launch and a `wails build`; diff `prepare-resources.py` output |
| REAPER users' registered launcher path breaks (`README.md:47` tells them to load `shared/reaper/NarrationUtils_Launcher.lua`) | Medium | Release note and README update; packaged builds use `resources/reaper` and are unaffected; manual REAPER sign-off |
| `pnpm-lock.yaml` or CI frozen install fails | Medium | Regenerate in the PR; run `pnpm install --frozen-lockfile` locally before push |
| Windows file locks when moving directories with `node_modules`, `dist` or Storybook running | Medium | Stop dev servers; move on a clean checkout; run `pnpm install` after |
| Nx cache or graph flakiness on Windows | Medium | Keep `quality.mjs` as the gate until `nx affected` matches it (A6 option b first); do not touch `release` |
| Nine top-level folders instead of five reads as more sprawl | Low | Each name states a role and the allowlist test keeps it fixed; A4 can fold `sidecars/` into `apps/` |
| PRD `file:line` citations go stale | Low | Only paths change, not line numbers; the codemod updates the PRDs |
| Collides with [Release Artifact Naming](release-artifact-naming.prd.md) and the REAPER PRDs that edit `wails.json`, `shell/package.json` and the launcher | Medium | Land one at a time; see the sequencing note added to the PRD index |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Cleanup, no moves | Delete `shell/src-tauri/`; resolve `shell/ui/index.html`; move the two outlier Python tests into `tests/` folders; pytest `testpaths` and `--basetemp` out of the repo root | complete | 2 | - | [plan](implementation-plan.md) |
| 2 | Prep | Guard test (top-level allowlist, old-root check, initially permissive); path constants in Go and `prepare-resources.py`; publish the old-to-new map | complete | 1 | - | [plan](implementation-plan.md) |
| 3 | The move | Two-commit rename PR for every folder in the target tree; all reference fixes; sidecar and library tests to `<project>/tests/`; lockfile; docs, README and PRD path updates; guard tightened (the ADR is written in phase 5) | complete | - | 1, 2, A1-A5 | [plan](implementation-plan.md) |
| 4 | Nx per project | `project.json` per project with targets and `implicitDependencies`; `pnpm check` and CI use `nx affected` per A6; shrink `changed-files.mjs` and `quality.mjs` where Nx covers them | complete | - | 3 | [plan](implementation-plan.md) |
| 5 | Steady state | Move durable rules into `codebase-map.md`, `docs/operations/`, `CONTRIBUTING.md` and the ADR; update local skills (A7); delete this PRD and the research note's plan section | pending | - | 4 | - |

**Phase 1 - Cleanup.** Goal: remove the dead icons and stop the Python and root-folder noise before any move. Scope: the four `src-tauri` files, `shell/ui/index.html` (confirm dead), `scripts/release/test_prepare_resources.py` and `tools/manuscript-teleprompter/spikes/test_moonshine_probe.py` moved with their path lookups fixed, `pyproject.toml` `[tool.pytest.ini_options]`, `scripts/quality.mjs` `--basetemp`. Success signal: `pnpm check`; a Windows `wails build` still embeds the icon.

**Phase 2 - Prep.** Goal: make the move small and its result checkable. Scope: `scripts/ci/layout.test.mjs` (allowlist and old-root checks, first with today's roots so it passes), a `layout.go` holding the joined repo-relative paths, the same in `prepare-resources.py`, and the codemod map. Success signal: `pnpm check` green with no behavior change.

**Phase 3 - The move.** Goal: the tree matches the target. Scope: everything in Evidence's path list, plus `pnpm-workspace.yaml`, `project.json`, `nx.json` (only if it names paths), `.github/{labeler.yml,labels.json,dependabot.yml,actions/*,workflows/*}`, `lint-staged.config.mjs`, `.gitignore`, `.prettierignore`, `.gitattributes`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `docs/**`. Success signal: the metrics table, plus a manual REAPER launch and a Windows `wails build` and run.

**Phase 4 - Nx per project.** Goal: CI runs what changed. Scope per A6. Success signal: `nx affected -t test` on a `libs/python` edit runs Python plus dependents; `release:*` scripts behave as before.

**Phase 5 - Steady state.** Goal: leave docs and ADRs, not a PRD. Scope per the PRD lifecycle in [README](README.md).

**Parallelism Notes**: Phases 1 and 2 can run in parallel and both merge before Phase 3. Phase 3 is a single serialized window (or five, per A1). Phases 4 and 5 follow.

**Parallel-session compatibility**

| Phase | Files touched | Collision risk |
| --- | --- | --- |
| 1 | `shell/src-tauri/`, `shell/ui/`, `pyproject.toml`, `scripts/quality.mjs`, two Python test files | [Test Flakiness](test-flakiness-and-visual-suite-stability.prd.md) and any PRD editing `quality.mjs` |
| 2 | `scripts/ci/`, `shell/app.go`, `shell/internal/settings/store.go`, `scripts/release/prepare-resources.py` | [Host Binding Data Race](host-binding-data-race.prd.md) rewrites `bindings.go`; `hostAPIVersion` PRDs edit `app.go` |
| 3 | Effectively every tracked path | All PRDs. Land when no phase of any other PRD is in flight. [Release Artifact Naming](release-artifact-naming.prd.md), [Project Workspace](project-workspace-and-daw-link.prd.md) and the REAPER PRDs edit the launcher, `wails.json` and `shell/package.json` |
| 4 | `nx.json`, `project.json` files, `_quality.yml`, `scripts/quality.mjs`, `scripts/ci/changed-files.mjs` | [Release Readiness](release-readiness-provisioning-and-docs-site.prd.md) pipeline phases, [Test Flakiness](test-flakiness-and-visual-suite-stability.prd.md) |
| 5 | `docs/architecture/codebase-map.md`, `docs/operations/*`, `CONTRIBUTING.md`, `docs/adr/` | ADR numbering (next free was 0039 at 155c275; re-check at merge) |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Top-level naming | By role: `apps/`, `libs/`, `sidecars/`, `integrations/`, `config/`, `tests/`, `tools/` | By language; keep `shared/` | Nx and Turborepo group by role or domain; `shared/` no longer describes its contents |
| Move `shell/` | Yes, to `apps/desktop` (user decision; A2 for the name) | Leave it | User asked for it; the apps and libs split reads clearly only if the host is an app |
| Go module path | Keep (proposed, A3) | Rename | Nothing imports it; rename touches about 70 files |
| Test placement | Toolchain convention plus one `tests/` per project plus a top-level `tests/` for cross-project | Single top-level `tests/` | Go and Vitest and Storybook cannot or should not |
| Playwright suites | Stay in `apps/ui` | Top-level `tests/` | The atlas kit scaffolds them into the consuming project |
| Nx | Per-project targets (proposed, A6) | Release-only | Replaces hand-rolled affected detection |
| ADR paths | Leave old text, add a path map | Rewrite ADRs | ADRs are immutable |
| Python packaging | Stay `package = false` with `pythonpath` | uv workspace | Not needed; no packaged Python libraries |
| One PR or several (A1) | One atomic move PR of two commits, after a cleanup-and-prep PR | Five PRs | D15; one conflict window matters more than a small diff |
| Desktop name, module path, sidecars, sidecar tests (A2-A5) | `apps/desktop`; module path kept; top-level `sidecars/`; `sidecars/<name>/tests/` | `apps/shell`; renamed module; `apps/sidecars/`; `core/tests/` | D15 takes the PRD's recommendations |
| Nx (A6) | Per-project targets, `nx affected` in `pnpm check` and CI | Targets only; release-only | D15; phase 4, after the move is green |
| Local skills (A7) | Untracked, updated locally by the phase 3 author | Move into the repo | D15 |
| Audacity notes | `integrations/audacity/README.md`, plus one folder per sidecar that has a placeholder driver note | Keep them under each sidecar | The PRD's target tree names `integrations/audacity/` for both |
| Repo-relative paths in code | `shell/internal/layout` (Go) and constants at the top of `prepare-resources.py`; Go tests use `layout.RepoFile` instead of counting `..` | Edit each call site | The next move is a one-line change per constant |
| Codemap | `scripts/ci/layout.json` holds the allowlist and the old-to-new map; `scripts/ci/apply-path-map.mjs` applies it; `scripts/ci/layout.test.mjs` is the guard | A scratch script | Open branches can re-run it; the guard reads the same map |
| `area:shell` label | Keep the name, point the labeler at `apps/desktop/**` | Rename the label | Renaming a GitHub label is an owner-side change and gains nothing here |
| `pytest --basetemp` | `.cache/test-tmp-<pid>` (ignored), plus `testpaths` | Leave `.test-tmp-*` in the root | Phase 1 |

## Research Summary

Repo facts were read from the tree, `git grep` and file hashes on this branch. External guidance (Nx, Turborepo, pytest, Go, Vitest, Storybook, Playwright, Wails, Tauri, uv, GitHub, MADR) is summarized with URLs in [the research note](../research/repo-layout-alignment.md), including which points rest on a single source. Not verified: that a Windows `wails build` succeeds without `shell/src-tauri/`, whether `shell/ui/index.html` is used by Wails dev mode, whether a path-only edit to `tools/ui-atlas-kit` tests and docs requires a kit version bump, and how `nx affected` behaves on this repo's CI runners.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
