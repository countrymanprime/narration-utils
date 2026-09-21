# CI and releases

## Local setup

Run `pnpm run bootstrap` once after cloning. It installs the root release
tooling and Husky hooks in addition to the existing application dependencies.
The hooks enforce Conventional Commit messages and check staged TypeScript,
Python, Go, and Lua files. Use `pnpm run check` for the full quality suite (every Nx
project's lint, format, test and build targets; see [Nx projects and the quality
gate](#nx-projects-and-the-quality-gate)).

## What the repository enforces, and what CI is for

GitHub Actions cannot configure repository settings from a workflow, so this section records what is set on the
repository (read with `gh api repos/countrymanprime/narration-utils/rulesets` on 2026-09-20) and what that means for
CI. The docs follow the settings, not the other way round (owner decision D11 of the [implementation plan](../prds/implementation-plan.md)).

- **`Main Protection` ruleset** (active): deleting `main`, force-pushing to it and re-creating it are blocked. The
  admin role and the owner bypass it.
- **`Pull Request` ruleset** (active): squash merges only; one approval; **code-owner review is required**
  (`.github/CODEOWNERS` names `@countrymanprime` for every path); a new push dismisses stale approvals; the last push
  must be approved; every review thread must be resolved. The admin role can bypass it through a pull request, and the
  owner `@countrymanprime` is exempt, so the solo maintainer merges their own pull requests.
- **No ruleset requires a status check.** CI is advisory: a red job does not block a merge and a green one does not
  permit it, so the maintainer reads the run before merging (the table below says what each check is). Requiring
  checks is an owner-only setting. If it is ever turned on, the names to require are the ones in the table, and two
  things need a decision first: `ci.yml` skips documentation-only pull requests (`paths-ignore: docs/**, **/*.md`),
  which would leave a required check pending on them, and the visual and atlas jobs have to have stopped failing
  without a code change (see [Keeping a red run meaningful](#keeping-a-red-run-meaningful)).
- Conventional Commit titles are enforced by the local commitlint hook, not by CI. macOS and Linux are deliberately
  not built on pull requests (see [ADR-0027](../adr/0027-windows-gates-and-creates-the-release.md)), so `Build (Windows)`
  is the only native build a pull request runs.

The checks a pull request shows, by the name GitHub displays (`ci.yml` calls `_quality.yml` as `quality` and
`_ui-dist.yml` as `ui-dist`):

| Check | What it runs |
| --- | --- |
| `quality / js` | `lint`, `format` and `test` of `narration-utils-ui` (Vitest with the coverage ratchet), then Knip over the whole repository |
| `quality / ui-visual` | the Playwright visual suite of the mock-backed app (`pnpm --dir apps/ui run screenshots`); uploads screenshots, and traces when it fails |
| `quality / ui-atlas` | the Storybook component atlas: every story in light and dark at a wide and a narrow viewport, with axe |
| `quality / ui-atlas-kit` | the tests of `tools/ui-atlas-kit` and its drift check against `apps/ui` |
| `quality / repo-scripts` | the plain-Node tests of `scripts/` (labels, milestones, release tooling, the layout and project guards) |
| `quality / python` | ruff and pytest for `libs/python`, the sidecars, `scripts/` and `tests/fixtures` |
| `quality / lua` | StyLua on `integrations/reaper` (Lua has no automated tests yet) |
| `quality / go` | Windows: gofmt, go vet, golangci-lint, the tests with the race detector, then `test-schedules` |
| `ui-dist / build` | builds the UI bundle the Windows build reuses |
| `Build (Windows)` | the native Windows build, starting as soon as `ui-dist / build` finishes |

`codeql.yml` and `dependency-review.yml` run their own checks (`Analyze (<language>)`, `review`) and are advisory too
([Tracking work on GitHub](github-workflow.md)). A pull request that changes only `docs/**` or Markdown runs none of
the `CI` checks, so a docs-only change is reviewed by reading.

Create a `production` environment with `@countrymanprime` as a required
reviewer. Leave **Prevent self-review** disabled and leave administrator bypass
enabled so the owner can promote an emergency or solo release. Restrict the
environment to `main` and tags matching `v*`.

Issues, labels, milestones, and the project board are covered in
[Tracking work on GitHub](github-workflow.md).

## Version lifecycle

The pre-release workflow runs after each non-release push to `main`. Nx Release
uses the squash commit title to calculate the synchronized application version:
`feat` is minor; `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, and `revert` are patch. Pre-1.0 breaking changes are handled as the
next minor release. The workflow tags `v<version>-rc`, builds the Windows
package, and in that same job creates the GitHub pre-release with the Windows
zip. There is no installer: the Windows runner has no NSIS, so Wails only warns
and the self-contained `narration-utils-shell.exe` is the real output. The last step starts the optional **Build macOS** and **Build Linux**
workflows, which build the release tag and attach their asset
([ADR-0027](../adr/0027-windows-gates-and-creates-the-release.md)). They are
separate runs, so a failed non-Windows build never delays or reddens the Windows
release. To retry one, re-run its workflow run, or start **Build macOS** /
**Build Linux** from the Actions tab with the release tag (for example
`v0.2.1-rc`); the upload overwrites, and it works for a promoted release too.
Other workflows can call them with `uses:` and a `tag` input.

Each platform ships one asset named `narration-utils-<platform>.<ext>`, with a
`.sha256` beside it. Only Windows is required:

| Platform | Asset | Contents |
| --- | --- | --- |
| `windows-x64` | `narration-utils-windows-x64.zip` | `narration-utils-shell.exe` |
| `macos-arm64` | `narration-utils-macos-arm64.zip` | `Narration Utils.app` |
| `linux-x64` | `narration-utils-linux-x64.tar.gz` | `narration-utils-shell` binary |

`scripts/release/assets.mjs` owns that table, packages each asset in CI
(`pnpm release:package <platform>`), and checks a downloaded release
(`pnpm release:verify-assets <dir>`).

Use **Promote pre-release** with the RC tag when it is ready. Approval on the
`production` environment gates the job, which then validates main ancestry and
refuses to continue unless the Windows asset is attached and matches its
checksum. A macOS or Linux asset that is missing is ignored (that release is
Windows-only); one that is attached must be complete and match. It creates the
stable tag and GitHub release from the exact same downloaded assets and never
rebuilds an approved candidate. Release candidates
published before per-asset checksums (they carry `SHA256SUMS.txt`) cannot be
promoted this way.

## Nx projects and the quality gate

Every folder of the [role-based layout](../architecture/codebase-map.md) is an Nx project with its own
`project.json`; Nx runs the commands, it does not replace them. The targets are the ones the old serial
runner called:

| Project | Folder | Targets |
| --- | --- | --- |
| `narration-utils-ui` | `apps/ui` | `lint`, `format`, `architecture` (the import rules of [ADR 0062](../adr/0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md)), `test`, `build`, `visual` (Playwright screenshots), `atlas` |
| `narration-utils-shell` | `apps/desktop` | `lint` (gofmt, go vet, golangci-lint v2: errcheck, staticcheck, gosec and the `standard` set), `test` (`-race` in the `ci` configuration), `test-schedules` (the teleprompter and shutdown tests on one and on four CPUs, five times each; run by the CI `go` job, not by `pnpm check`), `package` (`wails build`, not part of the gate) |
| `narration-common` | `libs/python` | `lint` (ruff), `test` (pytest) |
| `manuscript-guide`, `manuscript-teleprompter`, `transcript-compare` | `sidecars/<name>` | `lint`, `test` |
| `reaper` | `integrations/reaper` | `lint` (StyLua) |
| `repo-scripts` | `scripts` | `lint`, `test` (pytest), `test-node` (`node --test`) |
| `ui-atlas-kit` | `tools/ui-atlas-kit` | `test` |
| `config`, `fixtures` | `config`, `tests/fixtures` | none (fixtures: `lint`); they exist so a change to them affects the projects that read them |
| `narration-utils` | the repo root | `knip` (unused files, exports and dependencies, gated at zero: see below); also the `nx release` project |

- **`pnpm check`** runs `nx run-many` over `lint format architecture knip test test-node build`, one project at a time and never from
  the Nx cache, so a green gate means every check ran. `check:fast` and the Git hooks still use
  `scripts/quality.mjs` on staged files.
- **Look around** with `pnpm exec nx show projects`, `pnpm exec nx graph`, and
  `pnpm exec nx show projects --affected --files=<path>`. Run one project's check with, for example,
  `pnpm exec nx run manuscript-guide:test`.
- **CI** keeps the job names it had before the Nx move (`js`, `ui-visual`, `ui-atlas`, `ui-atlas-kit`, `repo-scripts`,
  `python`, `lua`, `go`; the table above lists them as GitHub shows them). Each job runs its targets through
  `.github/actions/nx-run`: on a pull request `nx affected` against the base branch, otherwise every selected
  project, one task at a time (parallel tasks starve the two-vCPU runners and trip the UI tests' timeouts).
  `scripts/ci/nx-scope.sh` decides: everything runs when the event is not a pull request, or the change
  touches a file no project owns but all depend on (`nx.json`, `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `pyproject.toml`, `uv.lock`, the root `project.json`, `stylua.toml`, `.prettierrc.json`,
  `.prettierignore`, `.editorconfig`, `.gitattributes`, `scripts/quality.mjs`, `scripts/toolchain.json`, `scripts/ci/coverage-gate.mjs`,
  `scripts/ci/coverage-floors.json`, anything under
  `.github/workflows` or `.github/actions`). The two Playwright jobs keep
  their own `run:` steps (the atlas kit's audit looks for them) and skip them through
  `.github/actions/nx-affected` when the UI is not affected. The atlas-kit job always runs, because its drift check
  reads `apps/ui`, and so does the `repo-scripts` job, because the layout and project guards read every tracked file.
- **Failure diagnostics.** A failing visual test leaves `apps/ui/test-results/<test>/trace.zip` (Playwright
  `trace: 'retain-on-failure'`: DOM snapshots, network and console for every action; a passing test keeps nothing,
  and no retry is involved, [ADR 0023](../adr/0023-visual-suite-capture-contract-and-storybook.md)). When a step of the
  `ui-visual` job fails, the job uploads that folder as the `ui-visual-traces` artifact for three days. Open a trace
  with `pnpm exec playwright show-trace <trace.zip>` from `apps/ui`, or drop it on trace.playwright.dev. The atlas
  config is vendored from `tools/ui-atlas-kit`, so it keeps no trace until a kit release adds one.
- **Dependencies** are `implicitDependencies` in each `project.json`: the desktop app reads the UI, the sidecars,
  `config`, `fixtures` and `reaper`; the sidecars read `narration-common` and `config`.
  `scripts/ci/projects.test.mjs` fails if a Python, Go, Lua or `apps/` TypeScript file is not covered by a project
  lint target, because the repo-wide `ruff .`, `staticcheck ./...` (now golangci-lint) and `stylua --check` runs are gone.
- **Releases** are unchanged: `nx release version` still versions the root project. `nx release` counts a commit
  when it affects the root project or a project the root depends on, so `narration-utils` lists every project except
  the UI and desktop projects (they were already separate projects that never counted); the guard test keeps that
  list complete when you add a project.
- **Adding a project**: add a `project.json` (copy a neighbour), give it `lint` and `test` targets that call the same
  tools, list what it reads under `implicitDependencies`, and add its name to the root project's
  `implicitDependencies` unless it should not count toward the release version.

## Keeping a red run meaningful

A red check has to mean something is wrong, so nothing is retried and nothing is quarantined ([ADR 0023](../adr/0023-visual-suite-capture-contract-and-storybook.md)).
A test that fails without a code change is a bug in the test, and it is fixed at its cause; "re-run it once" hides
exactly that. What the suites do so that timing is not a variable:

- **Frontend tests** (Vitest and Testing Library in `apps/ui`) wait for the state they assert: `findBy*`, or `waitFor`
  on the thing itself, never a synchronous read straight after waiting for something else (a component can settle in a
  later commit than the one the test waited for). Two limits are set once and never per test: `testTimeout` 15 s in
  `vite.config.ts` (Vitest's 5 s default is a unit-test value) and Testing Library's `asyncUtilTimeout` 5 s in
  `src/test-setup.ts` (its 1 s default failed 2 of 25 consecutive full runs on a quiet machine). A wait ends when its
  condition holds, so the limits cost nothing on a passing run. `slowTestThreshold` is left alone so a test that gets
  slow stays visible. Under heavy CPU oversubscription the two Story Bible tests of `App.test.tsx` can still reach
  the 15 s limit; that is the render cost of the whole app in jsdom, not a timing bug.
- **Visual drivers** (`apps/ui/tests/visual/app.drivers.ts`) reach a state through real UI interaction and wait for a
  condition, never a sleep and never a page-wide fake clock. `goToPage` clicks inside the navigation, then waits for the
  destination's heading and, for Home, Manuscript and Proofing, for their content; a state with content of its own waits
  for it; a confirm dialog is awaited by name through `confirmDialog`, which accepts `dialog` or `alertdialog`. A driver
  that photographs the page it just left shows up as `identical screenshots` and a stale `sameAs` in the run's validation:
  fix the driver, do not add a `sameAs`. To prove a new or changed driver, run the suite with a slowed page CPU:
  `UI_CPU_THROTTLE=20 pnpm --dir apps/ui run screenshots` (any factor of 1 or more; a mistyped value is an error). A
  racing driver fails or photographs the wrong page there on demand instead of once in twenty CI runs. At 20x the two
  Story Bible confirm states exceed Playwright's 30 s test timeout inside the capture's own steps: they fail loudly, they
  do not photograph the wrong page. The reusable version of this lives in the kit's scaffold (`clickNav`, `beforeCapture`).
  `UI_THEME=dark pnpm --dir apps/ui run screenshots` starts every capture in the dark theme, which is how the whole suite
  is looked at in dark (the palette work checks every state in both themes). Its end-of-run validation fails on
  `theme-dark` and `reader-dark` matching their default states, so copy `apps/ui/screenshots/app` aside after the run and read the PNGs; the
  default run stays the gate.
- **Go tests** that guard an ordering between goroutines run on one and on four CPUs (`test-schedules`), because the
  default scheduler hid the shutdown bug that failed four CI runs. Tests do not assert a wall-clock duration: the
  monotonic clock ticks every 0.5 to 15.6 ms on Windows, so a fast operation can measure exactly zero.
- **Classifying a red run**: `gh run view <id> --log-failed`. `identical screenshots` or `sameAs no longer holds` is a
  driver (or a real duplicate); `Unable to find` or `Test timed out` in a frontend test is a wait that does not match the
  state, or a genuinely slow test; a Go failure that comes and goes with the CPU count is an ordering bug.
- **Aria snapshots** ([ADR 0065](../adr/0065-aria-snapshots-pin-the-role-trees-of-the-dialogs-the-slide-over-and-the-navigation.md)):
  the `ui-visual` job also runs `pnpm --dir apps/ui run aria` after the screenshots (its own config, the same mock build, no
  retries, traces in `test-results/aria`), so a dialog that loses its role or name, a modal that stops hiding the page, or a
  changed navigation list fails there (comparison-only on CI). See [Verification and code-health tooling](verification-tooling.md#aria-snapshots).
- **Axe on app states** ([ADR 0064](../adr/0064-the-visual-suite-runs-axe-on-every-app-state-and-a-violation-fails-unless-it-is-declared-debt.md)):
  the visual suite runs axe after each screenshot and fails on a violation that `apps/ui/tests/visual/axe-debt.ts` does not
  declare, and on a declared rule that is no longer reported. `UI_AXE=1` (PowerShell: `$env:UI_AXE='1'`) with `pnpm --dir apps/ui screenshots` measures without
  failing (the teardown prints the count per rule and where), `UI_AXE=0` skips it; on CI either value fails the run. To clear an entry, fix the page and delete
  it (and lower `MAX_AXE_DEBT_RULES`); to add one, say why and name the issue that tracks it.

The known limits of the gates are stated in [Design system](../design/design-system.md#what-the-suites-do-not-prove): axe
cannot judge gradients or text over semi-transparent overlays, and pixel baselines are not adopted (a spike, after the
suite has been stable for 50 runs, [#153](https://github.com/countrymanprime/narration-utils/issues/153)).

## Dead-code check (Knip)

`nx run narration-utils:knip` (also `pnpm knip`) runs [Knip](https://knip.dev) over `apps/ui`, `apps/desktop`, `scripts/`
and `tools/`, configured in `knip.jsonc`. It fails on an unused file, export or dependency, and on an unlisted
dependency or binary; the repository is at zero, and CI runs it on every pull request in the `js` job. Fix a finding
by deleting the code or dropping the `export`. Add an `ignore`, `ignoreIssues`, `ignoreDependencies` or
`ignoreBinaries` entry only with a written reason in the file (generated code, files another repository receives by
copy, external tools, byte-identical vendored files). It does not read Go, Python or Lua. The standing exceptions
are the generated `apps/ui/wailsjs`, the UI atlas kit's `plugin/templates`, the wire-contract types, the exports of the
byte-identical `apps/ui/tests/visual/lib`, `@nx/js` (loaded by `nx release`) and the binaries `go`, `gofmt`, `wails` and
`playwright`. Scripts and the kit are entries and their exports are reported too (`includeEntryExports`), so a helper
exported by habit is flagged once nothing imports it. When a dependency that
Knip cannot see through arrives (a schema library, `@base-ui/react`), run it once and add the false positive with its
reason rather than the whole package to an ignore list.

## Coverage ratchet

Coverage is gated on the logic directories, not everywhere ([ADR 0043](../adr/0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md)).
The `test` target of `narration-utils-shell` (Go statements), `narration-utils-ui` (Vitest v8 lines),
`narration-common`, `manuscript-teleprompter`, `transcript-compare` and `manuscript-guide` (pytest-cov lines) runs
`scripts/ci/coverage-gate.mjs`, which runs the tests with coverage on and compares each listed directory or file with its
floor in `scripts/ci/coverage-floors.json`. A directory below its floor, or one with no data because it was renamed or
removed, fails the run.

- **Adding a logic directory:** add an entry at 80 or above. A lower floor needs a written `reason`; the gate's test
  (`scripts/ci/coverage-gate.test.mjs`) rejects one without.
- **After adding tests:** run `node scripts/ci/coverage-gate.mjs <go|vitest|pytest> <projectRoot> --update` (the same
  arguments as the project's `test` target) to raise floors to the rounded-down measurement. Floors never go down by
  `--update`; lowering one is a reviewed edit.
- **Not gated on purpose:** UI components, host glue and sidecar-launch code (the list is in the floors file's
  `$comment`).
- `vitest --coverage` also works by hand and writes `apps/ui/coverage/` (ignored).

## CI performance

Pull requests run the quality jobs and the UI bundle build in parallel. The
Windows native build needs only the UI bundle, so it starts as soon as that
finishes instead of waiting for lint and tests. macOS and Linux are not built on
pull requests, and the Go quality job runs on Windows only. pnpm's
content-addressable store, uv's package cache, Go's module/build caches, the
compiled Wails and golangci-lint binaries (keyed on `scripts/toolchain.json`), and
Playwright's Chromium download (keyed on the Playwright version) are restored by
the workflows; they never cache `node_modules`, `.venv`, or release artifacts.
`setup-node`, `setup-python`, and `setup-go` provision the exact pinned Node,
Python, and Go versions. Wails v2.16.0 is installed only in jobs that run a
native build, golangci-lint v2.13.2 (built with the pinned Go, config in `apps/desktop/.golangci.yml`) only in the Go quality job, and the standalone
StyLua v2.1.0 binary where needed, as declared in `scripts/toolchain.json`; none
of them use Cargo. Platform-specific sidecars must be built on their target OS,
so the built UI bundle is shared between jobs as a one-day artifact rather than
rebuilt per platform.

## Runtime provenance

`scripts/release/prepare-resources.py` freezes only the two first-party Python
tool entry points. It does not bundle optional voices, models, dictionaries, or
unreviewed third-party binaries. Before publishing a release that adds such an
artifact, add its publisher, version, immutable URL, SHA-256, code/artifact
license, installation location, attribution, and update policy to the release
record, following `docs/research/local-dependency-evaluation.md`.
