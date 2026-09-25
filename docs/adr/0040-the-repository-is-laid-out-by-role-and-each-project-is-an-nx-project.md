# 0040. The repository is laid out by role, and each project is an Nx project

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

The top level of the repository no longer said what was in it. `shared/` held the React app, a Python library, the REAPER Lua bridge, shipped JSON, test fixtures and a README; `tools/` mixed three Python sidecars frozen into the app with one real development tool; `shell/` was the desktop app but read like a leftover; a dead Tauri icon folder sat inside the Go host. Tests followed five conventions. Nx was used only for release versioning, so affected detection lived in hand-rolled scripts. Several sessions change the repository at once and it ships often, so every new contributor or agent had to learn by grep where things live. The research is in [repo-layout-alignment](../research/repo-layout-alignment.md) (git history); the owner chose the full move on 2026-09-20 (decision D15 of the PRD implementation plan).

## Decision drivers

- The top level no longer said what was in it, so every new contributor or agent had to learn by grep where things live.
- Several sessions change the repository at once and it ships often.
- Tests followed five conventions.
- Nx was used only for release versioning, so affected detection lived in hand-rolled scripts.

## Considered options

1. The full move: every top-level folder named for its role, tests following the toolchain, and every project an Nx project
2. Keep the status quo layout (`shared/`, `tools/`, `shell/`)

## Decision outcome

**Chosen option: the full move: every top-level folder named for its role, tests following the toolchain, and every project an Nx project**, because the old top level no longer said what was in it, so every new contributor or agent had to learn by grep where things live.

Every top-level folder is named for its role, tests follow the toolchain, and every project is an Nx project.

- **Layout.** `apps/` (`desktop`, `ui`), `sidecars/`, `libs/python`, `integrations/` (`reaper`, `audacity`), `config/`, `tests/fixtures`, `tools/ui-atlas-kit`, `scripts/`, `docs/`. The old-to-new map is below and machine-readable in `scripts/ci/layout.json`.
- **Names.** The desktop app is `apps/desktop`; `sidecars/` is top level, not under `apps/`, because the sidecars are bundled programs, not user-facing apps. The Go module path stays `github.com/countrymanprime/narration-utils/shell`: nothing imports it and changing it would rewrite every import. Package names, the executable name and the Nx release project (`narration-utils`) do not change.
- **Test rule.** Colocate tests where the toolchain wants them (Go, Vitest, Storybook, `node:test`). Otherwise a project has one `tests/` folder at its root; shared data lives in `tests/fixtures`. The Playwright visual and atlas suites stay in `apps/ui/tests` because the atlas kit scaffolds them into the project it serves.
- **Guard.** `scripts/ci/layout.test.mjs` (part of `pnpm check`) allows only the listed root entries, `LICENSE` included, and fails on any tracked file that still names a retired path outside the accepted ADRs and a short list of historical records.
- **One place for paths in code.** `apps/desktop/internal/layout` (Go) and the constants at the top of `scripts/release/prepare-resources.py`; Go tests use `layout.RepoFile` instead of counting `..`. `layout.FindRoot` recognises a checkout by `config/defaults.json` plus `apps/desktop/wails.json`.
- **Nx.** Each project has a `project.json` with `lint`, `format`, `test`, `test-node` and `build` targets that call the same tools as before; `pnpm check` runs them all, without the Nx cache, and CI runs `nx affected` per job (job names unchanged). `nx.json`'s `release` block is untouched. The root project lists the projects whose commits already counted toward the release version, so splitting the repository into projects did not change which commits bump it (UI-only and desktop-only commits never did).

#### Path map

| Old | New |
| --- | --- |
| `shell/` | `apps/desktop/` |
| `shared/ui/` | `apps/ui/` |
| `shared/python/` | `libs/python/` |
| `shared/reaper/` | `integrations/reaper/` |
| `shared/audacity/`, `tools/*/daws/audacity/` | `integrations/audacity/` (one folder per sidecar for its note) |
| `shared/config/` | `config/` |
| `shared/test-fixtures/` | `tests/fixtures/` |
| `tools/manuscript-guide/`, `tools/manuscript-teleprompter/`, `tools/transcript-compare/` | `sidecars/<same name>/` (`core/tests/` became `tests/`; `manuscript-teleprompter/spikes/test_moonshine_probe.py` moved to `tests/`) |

`shell/src-tauri/` and `shell/ui/index.html` were unreferenced and were deleted. Accepted ADRs and the research note keep the old names as history.

### Consequences

- **Good:** A folder's name says its role, the test rule is one sentence, and the top level cannot drift without `pnpm check` failing.
- **Neutral:** CI runs what a change affects, and a new project needs a `project.json`; `scripts/ci/projects.test.mjs` fails if a Python, Go, Lua or `apps/` TypeScript file is not covered by a project lint target, and keeps the root project's dependency list complete.
- **Neutral:** Open branches and worktrees conflict less than a rewrite would: git follows the renames. After merging `main` into one, run `node scripts/ci/apply-path-map.mjs` to rewrite the path text inside files, then `pnpm install`.
- **Bad:** REAPER users who registered `shared/reaper/NarrationUtils_Launcher.lua` as an action must register `integrations/reaper/NarrationUtils_Launcher.lua` instead. Packaged builds use `resources/reaper` and are unaffected.
- **Neutral:** Local, untracked files (`.claude/skills`, ignored runtime folders such as the legacy `shared/python/.runtime`) are not moved by git; the move's author updated `.claude/skills` locally.
- **Neutral:** The `area:shell` label keeps its name; the labeler points it at `apps/desktop/**`.
- **Neutral:** A future move edits `scripts/ci/layout.json`, the Go `layout` constants and the `prepare-resources.py` constants, runs `apply-path-map.mjs`, and supersedes this ADR.

### Confirmation

`scripts/ci/layout.test.mjs` (part of `pnpm check`) allows only the listed root entries and fails on any tracked file that still names a retired path; `scripts/ci/projects.test.mjs` fails if a Python, Go, Lua or `apps/` TypeScript file is not covered by a project lint target.
