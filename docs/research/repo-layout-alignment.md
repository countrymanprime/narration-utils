# Repo layout: where we are and what to align

Researched 2026-09-20. Confidence: high for the repo findings (read directly from the tree), medium for the external guidance (several points rest on one source; flagged inline).

## Summary

- `shell/src-tauri/icons/` is dead. Nothing in the tracked tree mentions `tauri` (case-insensitive), and `128x128@2x.png` and `icon.ico` are byte-identical (same SHA-1) to `shell/build/appicon.png` and `shell/build/windows/icon.ico`. Wails reads `shell/build/`; that is where the icons already live and where Wails expects them. `128x128.png` and `32x32.png` have no counterpart and no consumer. Delete the folder.
- `shared/` is the real layout problem. It holds the React app (`shared/ui`, consumed only by `shell`), a Python lib, the REAPER Lua bridge, config JSON, fixtures and a README. "Shared" no longer tells you what is in there.
- A single top-level `tests/` for everything is not achievable and not worth chasing. Go requires `_test.go` beside the package; Vitest and Storybook assume colocation. What is worth doing is one rule, applied everywhere, plus one home for cross-project tests and fixtures.
- Nx is only used for release versioning (`nx.json` has `release` and nothing else; `project.json` is a single project wrapping `shared/ui`). Affected detection is hand-rolled in `scripts/ci/changed-files.mjs`, and `scripts/quality.mjs` runs each stack serially.

## What the repo looks like today

| Path | Real role | Problem |
|---|---|---|
| `shell/` | Go/Wails desktop host, plus `build/` icons, `cmd/`, `internal/` | Root holds `main.go`, `app.go`, `bindings.go` beside `cmd/narration-utils/`; `shell/ui/index.html` has no references anywhere; `shell/src-tauri/` is dead |
| `shared/ui/` | The React app | Not shared |
| `shared/python/` | Python lib (`narration_common`) | Fine role, wrong bucket |
| `shared/reaper/` | REAPER Lua bridge; no automated tests | Integration, not shared code |
| `shared/config/`, `shared/test-fixtures/`, `shared/audacity/` | Shipped JSON, test fixtures, one README | Three unrelated things in one bucket |
| `tools/manuscript-*`, `tools/transcript-compare` | Python sidecars frozen into the app | Product code living in `tools/` |
| `tools/ui-atlas-kit` | Reusable dev tool with its own changelog | The only true "tool"; shares a folder with product code |
| `scripts/` | Repo automation and release tooling | Fine |

Tests today, by stack:

- Go: colocated `*_test.go` (idiomatic, forced by the toolchain).
- TS unit: colocated `*.test.tsx` beside components and stories.
- TS visual/atlas: `shared/ui/tests/{visual,atlas}`.
- Python: three patterns. `shared/python/tests/`, `tools/*/core/tests/`, and two outliers: `tools/manuscript-teleprompter/spikes/test_moonshine_probe.py` and `scripts/release/test_prepare_resources.py`.
- Node scripts: colocated `scripts/**/*.test.mjs`.
- Lua: none.

Python tools' tests load their module by file path (`spec_from_file_location(... parents[1] / "compare.py")`), so a test folder move needs a path edit per file.

Path-coupled config that any move must touch: `.github/labeler.yml`, `dependabot.yml`, `.github/actions`, workflows, `lint-staged.config.mjs`, `pnpm-workspace.yaml`, `project.json`, `shell/wails.json`, `scripts/{quality,bootstrap,copy-wails-frontend}.mjs`, `scripts/ci/changed-files.mjs`, `.gitignore`, `.prettierignore`, `.gitattributes`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/`. Reference counts (tracked files, excluding lockfile and images): `shared/ui` 93, `tools/` 55, `shared/reaper` 41, `shared/config` 27, `shared/python` 12.

## What the guidance says

**Top-level split.** Nx recommends grouping by application or business domain, not technical type, with apps thin and logic in libs. It offers flat `packages/` for small workspaces and grouped `apps/` + `libs/` for product workspaces, notes that flat stops communicating past a few dozen projects, and says moving a folder later is a plain `mv`. Any directory with a `project.json` is an Nx project, so Go, Python and Lua need no plugin. ([Nx folder structure](https://nx.dev/docs/kb/folder-structure), [Nx multi-language support](https://nx.dev/docs/features/multi-language-support)). Turborepo gives the same apps-versus-packages split ([Turborepo](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)). One polyglot write-up uses top-level language folders instead, for cache-input isolation ([agsolutions](https://www.agsolutions.at/en/stories/polyglot-monorepo-how-nx-mise-pulumi-and-exoscale-work-together), single source).

**Test placement.**

- Go: test files must sit in the package directory; `testdata/` colocates cleanly ([pkg.go.dev/testing](https://pkg.go.dev/testing), [rednafi](https://rednafi.com/go/organizing-tests/)).
- pytest: recommends a separate `tests/` directory, and `src/` layout for packaged projects ([pytest good practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html)).
- Vitest's default include and Storybook's `src/**/*.stories.*` glob assume colocation ([Vitest](https://vitest.dev/config/include), [Storybook](https://storybook.js.org/docs/configure)).
- Playwright is directory-driven; `testDir` and `snapshotPathTemplate` are configurable ([Playwright](https://playwright.dev/docs/api/class-testconfig)).
- Consensus: colocate unit tests per language convention; keep cross-project e2e and integration tests in their own folder ([Graphite](https://graphite.com/guides/testing-strategies-for-monorepos), secondary source, not an official rule).

**Icons.** Wails v2 keeps `build/appicon.png` and `build/windows/icon.ico` (generated from `appicon.png` only if missing, so a replaced PNG can leave a stale `.ico`; one issue thread, [wails#1431](https://github.com/wailsapp/wails/issues/1431)). `build:dir` is configurable in `wails.json`, so `build/` can move with the app. Tauri's `src-tauri/icons` is Tauri's convention and has no meaning here ([Tauri icons](https://v2.tauri.app/develop/icons/)). No authoritative monorepo guidance on brand-asset placement exists; a root `assets/brand/` master is an inference, not a standard. Wails v3 details came from search summaries only (docs returned 403).

**Python.** uv workspaces want a root `pyproject.toml` with `members`, a per-member `pyproject.toml`, one lockfile ([uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/)). `uv init` defaults to `src/` layout. The per-member `tests/` plus root `testpaths` pattern is from one guide ([pydevtools](https://pydevtools.com/handbook/how-to/how-to-set-up-a-python-monorepo-with-uv-workspaces/)). uv has no official monorepo best-practices page ([uv#10960](https://github.com/astral-sh/uv/issues/10960)). This repo sets `[tool.uv] package = false` and `pythonpath = ["shared/python"]`, so it is not a workspace and none of this applies unless we choose to become one.

**Hygiene.** CODEOWNERS is last-match-wins and pays off only when top-level folders mirror ownership ([GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)). ADRs: MADR uses `docs/decisions/` with numbered files and optional per-component subfolders ([MADR](https://adr.github.io/madr/)); our `docs/adr/` is fine. Diátaxis (tutorial / how-to / reference / explanation) is the usual docs model ([diataxis.fr](https://diataxis.fr/start-here/)).

## Recommendation

**Rule, stated once:** tests follow the toolchain. Colocate where the toolchain wants it (Go, Vitest, Storybook, `node:test` scripts). Otherwise each project has one `tests/` folder. Cross-project tests and shared fixtures live in a top-level `tests/`. A project's Playwright suite stays with that project, because `ui-atlas-kit` scaffolds `tests/visual` and `tests/atlas` into the consuming project.

**Target shape (role-based names):**

```
apps/
  desktop/            <- shell/            Go/Wails host; keeps build/ icons
  ui/                 <- shared/ui/        React app
sidecars/             <- tools/manuscript-guide, manuscript-teleprompter, transcript-compare
libs/
  python/             <- shared/python/    narration_common
integrations/
  reaper/             <- shared/reaper/    Lua bridge
  audacity/           <- shared/audacity/ + tools/*/daws/audacity
config/               <- shared/config/
tests/
  fixtures/           <- shared/test-fixtures/
tools/
  ui-atlas-kit/       stays (dev tooling)
scripts/              stays
docs/                 stays
```

The Go module path (`.../narration-utils/shell`) can stay as is when the directory moves; only `wails.json`, `go -C shell` calls and scripts change. The `apps/desktop` rename has the largest blast radius for the least clarity gain; it is the one to defer if you want a smaller first step (`shell/` reads fine on its own).

At about eight projects Nx would call a flat layout acceptable, so the case for `apps/` + `libs/` is the misleading `shared/` name, not scale. If you would rather keep churn minimal, the smallest useful change is to rename only `shared/ui` to `ui/` (or `apps/ui/`) and `shared/reaper` to `integrations/reaper/`, and leave the rest.

## Plan

1. **Now, small, no moves.**
   - Delete `shell/src-tauri/`. Confirm with a Windows `wails build` (I checked references statically; I did not run a build).
   - Decide whether `shell/ui/index.html` is dead (no references found).
   - Move the two outlier Python tests into `tests/` folders and fix their path lookups.
   - Point pytest `--basetemp` at an ignored cache folder; `.test-tmp-<pid>` dirs currently pile up in the repo root.
2. **Write the rule down.** Add the tests-follow-the-toolchain rule and the role names to `docs/architecture/codebase-map.md`, with a short ADR (`adr-author`).
3. **One mechanical rename PR** (`git mv` only, no content edits besides paths), landed when no other branches are in flight. Update the path-coupled files listed above and run `full-verification-gate` (`pnpm check`, plus the Playwright visual suite since `shared/ui` moves). `shared/reaper` has no automated tests, so verify by hand in REAPER after the move. Leave existing ADR text alone as history; update the PRDs (about 30 mention `shared/ui`).
4. **Optional: use Nx or drop it.** Give each stack a `project.json` with `build`, `test`, `lint` targets and use `nx affected`, which would replace `changed-files.mjs` and the serial runner in `quality.mjs`. If that is not wanted, keep Nx for release only and say so in `docs/operations/`.
5. **Add per-path CODEOWNERS** when a second maintainer exists; today it is one `*` rule and that is fine.

## Gaps

- No authoritative source for brand-asset placement or a canonical Google/Bazel layout.
- Wails v3 and `wails.io` pages were not fetched directly.
- The "top-level tests/ for cross-project tests" consensus and the per-member uv `tests/` pattern each rest on one secondary source.
- No build was run to prove `src-tauri/icons` is unused; the evidence is static (no references, identical bytes to files Wails reads).
