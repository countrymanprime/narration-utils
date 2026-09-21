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
- **Two settings the workflows rely on are the owner's to change:** "Require actions to be pinned to a full-length commit
  SHA" (off now; `zizmor` already enforces the same rule, and the setting is a backstop to enable after the pinning
  change has run once with Dependabot) and immutable releases (off, and they stay off: they would break the late macOS
  and Linux upload and the release-candidate prune, see [#186](https://github.com/countrymanprime/narration-utils/issues/186)).
  The owner checklist is in [Tracking work on GitHub](github-workflow.md#owner-checklist-for-the-release-supply-chain-work).
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
| `quality / lua (ubuntu-latest)`, `quality / lua (windows-latest)` | StyLua and ruff on `integrations/reaper`, then its bridge harness under Lua 5.4 (a fake `reaper` driven through the file protocol, and the mutation checks; [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)) |
| `quality / go` | Windows: gofmt, go vet, golangci-lint, the tests with the race detector, then `test-schedules` |
| `ui-dist / build` | builds the UI bundle the Windows build reuses |
| `Build (Windows)` | the native Windows build, starting as soon as `ui-dist / build` finishes |

`codeql.yml` and `dependency-review.yml` run their own checks (`Analyze (<language>)`, `review`) and are advisory too
([Tracking work on GitHub](github-workflow.md)). A pull request that changes only `docs/**` or Markdown runs none of
the `CI` checks, so a docs-only change is reviewed by reading; `zizmor`, `security.yml` and the labeler have no path filter and always run.

Create a `production` environment with `@countrymanprime` as a required
reviewer. Leave **Prevent self-review** disabled and leave administrator bypass
enabled so the owner can promote an emergency or solo release. Restrict the
environment to `main` and tags matching `v*`.

Issues, labels, milestones, and the project board are covered in
[Tracking work on GitHub](github-workflow.md).

## Workflow security

The workflows build and publish an unsigned executable, so they are treated as code that needs its own checks.
[zizmor](https://docs.zizmor.sh) reads every workflow, composite action and `dependabot.yml` on every pull request
(`zizmor.yml`, no path filter) and reports unpinned actions, credentials left in `.git/config`, template injection,
excessive permissions and dangerous triggers. Its configuration is `.github/zizmor.yml`; every suppression there
names its reason. The check is blocking: a finding at the `regular` persona fails it. Run it locally with
`uvx zizmor --persona regular .` (add `--gh-token "$(gh auth token)"` for the online audits).

**Every action is pinned to a commit.** A `uses:` line that names another repository is a full 40-character commit SHA
with a comment holding the full release tag, for example `actions/checkout@3d3c42e5… # v7.0.1`; a tag such as `@v7` can
be moved to different code after the fact, a SHA cannot. References to this repository's own composite actions and
reusable workflows (`./.github/...`) stay as they are. zizmor's `unpinned-uses` audit is the gate, so an unpinned line
fails the `zizmor` check and names the line. To pin a new action run `pinact run` (the `pinact` Go tool, `go install
github.com/suzuki-shunsuke/pinact/v3/cmd/pinact@latest`, with `GITHUB_TOKEN` set; it converts the tag to its SHA and
writes the comment); `pinact run --verify --check` re-checks that every SHA matches its comment. Dependabot
(`github-actions`, weekly, with a 7-day cooldown) proposes the newer SHA and rewrites the comment. A new action needs
a reason: it runs with the job's token, so prefer a script in `scripts/` or a tool the toolchain already installs.

The permission model, so a change can be judged against it:

- Every workflow declares `permissions` at the top, and a job that needs more raises it for that job only. The
  top-level default is `contents: read` (`zizmor.yml` and `promote-release.yml` use `{}`). The one exception is
  `build-macos.yml` and `build-linux.yml`, whose `contents: write`, `id-token: write`, `attestations: write` and
  `artifact-metadata: write` are a workflow-level grant because a caller must grant everything the reusable
  `_attach-platform.yml` holds; only its `attach` job uses them.
- The release job of `prerelease.yml` holds `contents: write` (create the release), `actions: write` (start the
  optional macOS and Linux builds) and the three attestation permissions (`id-token`, `attestations`,
  `artifact-metadata`: write); `promote-release.yml`'s one job holds `contents: write` (create the stable tag and
  release) and `attestations: read`, behind the `production` environment.
- Every `actions/checkout` sets `persist-credentials: false`, so the token is not left in `.git/config` for later steps.
  Promote therefore creates the stable tag through the API (`gh api .../git/refs`) instead of `git push`.
- Values an outsider can influence (a tag input, a branch name) reach a shell through `env:`, never straight into a
  `run:` body.
- `labeler.yml` uses `pull_request_target` so forks can be labelled; it checks out nothing and runs no pull request
  code (the comment at its top says why that is safe).

Install-time settings are written in the repository so a default that changes upstream cannot change them silently:

- **`pnpm-workspace.yaml`:** `minimumReleaseAge: 4320` (a version must be three days old before pnpm resolves it),
  `strictDepBuilds: true` (an install fails on a dependency build script that `allowBuilds` does not name) and
  `blockExoticSubdeps: true` (no transitive dependency from a git repository or tarball URL). pnpm 11 checks the age
  of every lockfile entry even under `--frozen-lockfile` ("Lockfile passes supply-chain policies"), so a lockfile that
  holds a version younger than three days fails CI. That can happen with a Dependabot **security** update, which skips
  the Dependabot cooldown; list that one `name@version` in `minimumReleaseAgeExclude` in the same pull request, and
  remove it once the version is three days old.
- **`.github/dependabot.yml`:** a `cooldown` on every ecosystem, so Dependabot waits before proposing a new release:
  7 days for `npm` and `github-actions`, 3 days for `uv` and `gomod`. Security updates ignore the cooldown.
- **Python:** `uv sync --locked` installs only what `uv.lock` pins, and Dependabot's cooldown covers uv updates, so
  `exclude-newer` is not set. `uv audit` is a preview command and stays a local, non-gating check.

## Vulnerability scanning

`security.yml` runs two scanners on every pull request, on pushes to `main` and weekly (Tuesday). Both are **advisory**:
neither fails the run on a finding, neither is a required check, and the first month is a baseline (owner decision
D22, question 12). Findings show under **Security > Code scanning** (categories `govulncheck` and `osv-scanner`) and in
the run log; a fork or Dependabot pull request scans but does not upload, because its token is read-only.

- **govulncheck** (Windows, the version pinned in `scripts/toolchain.json`) reports only Go vulnerabilities the code can
  reach, so it is the low-noise one. Run it by hand with `govulncheck -C apps/desktop ./...`.
- **OSV-Scanner** (`google/osv-scanner-action`, pinned by SHA) checks `pnpm-lock.yaml`, `uv.lock` and
  `apps/desktop/go.mod` against the OSV database; `uv.lock` is read natively, so Python is covered without `pip-audit`
  (which does not read it). On a pull request it reports only advisories the pull request adds; on `main` and weekly it
  reports all of them. A lockfile added later has to be listed in `scan-args`. Run it by hand with
  `osv-scanner scan source --lockfile pnpm-lock.yaml --lockfile uv.lock --lockfile apps/desktop/go.mod`.
- `uv audit --preview-features audit-command` is a preview command and stays a local, non-gating check.
- **Baseline (2026-09-21):** govulncheck reports nothing; OSV-Scanner reports two advisories in `pnpm-lock.yaml`
  (`esbuild` 0.21.5, GHSA-67mh-4wv8-2f99, and `smol-toml` 1.6.1, GHSA-7w5x-hrqm-74c2), none in Go or Python.
  Dependabot proposes the fixes.
- **Moving to blocking** is a decision after a clean month: the pull-request mode of OSV (`fail-on-vuln: true`) fails
  only on what the pull request adds, and govulncheck stays advisory.

## Version lifecycle

The pre-release workflow runs after each non-release push to `main`. Nx Release
uses the squash commit title to calculate the synchronized application version:
`feat` is minor; `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, and `revert` are patch. Pre-1.0 breaking changes are handled as the
next minor release. The workflow tags `v<version>-rc`, builds the Windows
package, and in that same job creates the GitHub pre-release with the Windows
zip. There is no installer: the Windows runner has no NSIS, so Wails only warns
and the self-contained `narration-utils.exe` is the real output. The last step starts the optional **Build macOS** and **Build Linux**
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
| `windows-x64` | `narration-utils-windows-x64.zip` | `narration-utils.exe` |
| `macos-arm64` | `narration-utils-macos-arm64.zip` | `Narration Utils.app` |
| `linux-x64` | `narration-utils-linux-x64.tar.gz` | `narration-utils` binary |

The asset names carry no version and the program inside carries no version in its name: the version is stamped **into** the
program ([The version inside the program](#the-version-inside-the-program)), where the app can show it and compare it with a
newer release ([ADR 0073](../adr/0073-the-executable-is-named-narration-utils-and-carries-its-version.md)).

`scripts/release/assets.mjs` owns that table, packages each asset in CI
(`pnpm release:package <platform>`), and checks a downloaded release
(`pnpm release:verify-assets <dir>`, offline: sizes and checksums only; promote adds `--attestations`).

Use **Promote pre-release** with the RC tag when it is ready. Approval on the
`production` environment gates the job, which then validates main ancestry and
refuses to continue unless the Windows asset is attached, matches its
checksum and has build provenance (see [Build provenance](#build-provenance)). A macOS or Linux asset that is missing
is ignored (that release is Windows-only); one that is attached must be complete, match and be attested. It creates the
stable tag and GitHub release from the exact same downloaded assets and never
rebuilds an approved candidate. Release candidates
published before per-asset checksums (they carry `SHA256SUMS.txt`), and ones published before attestations, cannot
be promoted this way.

## The version inside the program

The root `package.json` version is the single source: `sync-version.mjs` copies it to the two `package.json` files and to
`apps/desktop/wails.json` (`info.productVersion`, the Windows file version), and `scripts/release/wails-build.mjs` stamps it
into the Go variable `main.version` with `-ldflags "-X main.version=<version>"`. CI (`.github/actions/build-native`) and a local
build (`pnpm --dir apps/desktop run build`, or the Nx `package` target) both go through that script, so a build never reports a
version that depends on who built it. `Bootstrap` returns it and Settings > About shows it.

- The version is **bare semver** (`0.2.7`). A release candidate and its promotion are the same bytes, so they report the same
  version; `wails-build.mjs` refuses a version with a suffix, and refuses caller-supplied `-ldflags` that would replace the stamp.
- A build with no stamp (`go run`, `go test`, `wails dev`) reports `0.0.0-dev`.
- `narration-utils --version` prints the stamped version and exits without opening a window. On Windows the program is a GUI
  application, so a console shows nothing; a program that reads its standard output (a test, the update flow) gets the text.
- The program is named by `wails.json` `outputfilename` (`narration-utils`, `.exe` on Windows). Clean old build output before you
  test the REAPER launcher: `apps/desktop/build/bin/narration-utils-shell.exe` from a build before the rename is no longer
  looked for.

### What the in-app updater depends on

The app replaces itself from these releases ([in-app update](../architecture/in-app-update.md)), so the shape of a Windows release is
a contract: the asset is `narration-utils-windows-x64.zip` with a `narration-utils-windows-x64.zip.sha256` beside it in
`sha256sum` format naming that zip; the zip holds exactly one entry, `narration-utils.exe`; the tag is `v<version>-rc` for a
candidate (a pre-release) and `v<version>` for its promotion; and the program reports its own bare version for `--version`.
The updater refuses anything else, so changing one of these means changing `apps/desktop/internal/update` in the same pull request
(`scripts/release/assets.mjs` and the updater's `PlatformFor` mirror each other).

## Build provenance

Every release asset is attested: `actions/attest` records, in GitHub's attestation store, which workflow, commit and
run built a file (SLSA build provenance, level 2: the build runs in the calling job, so it is not the isolated
level 3). The subjects are identified by digest:

| Platform | Signed by (the workflow the certificate names) | Subjects |
| --- | --- | --- |
| Windows | `.github/workflows/prerelease.yml`, the `release` job | `narration-utils-windows-x64.zip`, its `.sha256`, and `narration-utils.exe` (so the executable can be checked after the zip is extracted, which an in-app update can do) |
| macOS | `.github/workflows/_attach-platform.yml` (the reusable workflow, not `build-macos.yml`) | the zip and its `.sha256` |
| Linux | `.github/workflows/_attach-platform.yml` | the archive, its `.sha256`, and `narration-utils` |

- The step runs in the same job as the build and before anything is published. Windows attests before the prune and
  `gh release create`; macOS and Linux attest before `gh release upload`. If it fails the job fails and nothing
  unattested is published; re-run the workflow to retry.
- The jobs that attest hold `id-token: write`, `attestations: write` and `artifact-metadata: write`. A workflow that
  calls `build-macos.yml` or `build-linux.yml` has to grant the same, because a caller must grant what the reusable
  workflow's job holds.
- Promote does not attest again: it re-publishes the same bytes, and an attestation belongs to a digest, not to a release.
- Attestations prove which workflow, commit and run produced a file. They do not prove the source is benign, and they do
  not change how Windows SmartScreen or antivirus software treats an unsigned executable. The first stable release is
  unsigned and Windows-only (owner decision D7): signing is the owner's call, and no workflow here signs.
- A release candidate published before this change has no attestations, so promote refuses it (it cannot be promoted
  once attestations are enforced, as a candidate with `SHA256SUMS.txt` could not be promoted after ADR 0027). Only the
  newest ten candidates are kept in any case.
- **Promote verifies before it publishes.** `node scripts/release/assets.mjs verify <dir> --attestations` (the
  `--attestations` flag needs `GITHUB_REPOSITORY` and an authenticated GitHub CLI, so `pnpm release:verify-assets` stays
  offline) runs `gh attestation verify` for the archive and the checksum of every platform present, pinned with
  `--repo`, `--signer-workflow <repository>/<workflow from the table above>`, `--source-ref refs/heads/main` and
  `--deny-self-hosted-runners`. `--repo` alone would accept an attestation from any workflow of the repository, a
  pull request's included. The signer workflows live in the `PLATFORMS` table of `scripts/release/assets.mjs`; rename a
  workflow file and that table is the one place to change (its tests fail first). If a promote is refused, the message
  names the file and gh's reason: a file with no attestation was not built by these workflows.
  The same step refuses any file in the downloaded release that is not one of the known assets or checksums, because
  promote publishes every file it downloaded.
- **What the certificate says.** The signer is the workflow in the certificate's subject alternative name,
  `https://github.com/<repository>/.github/workflows/<file>@<ref>`; for a file attested inside a reusable workflow it is
  the reusable workflow, and the calling workflow appears only in `buildConfigURI`. This was read from real attestations
  made by a throwaway workflow before the flags were written ([ADR 0071](../adr/0071-releases-carry-build-provenance-and-promote-refuses-a-file-the-release-workflows-did-not-build.md)).

### Verifying a download

With the [GitHub CLI](https://cli.github.com), in the folder holding the file:

```bash
gh attestation verify narration-utils-windows-x64.zip --repo countrymanprime/narration-utils
```

Success prints the workflow, commit and run that built the file; a modified or unattested file fails. To insist on the
release workflow and `main`, add `--signer-workflow countrymanprime/narration-utils/.github/workflows/prerelease.yml --source-ref refs/heads/main`
(macOS and Linux: `_attach-platform.yml`). `gh attestation download <file> --repo ...` saves the attestation as a
`.jsonl` bundle that `--bundle <file>` then verifies without asking GitHub for it. The same works for the executable
inside the zip after extracting it, which is what an in-app update can check. The release notes say the same in one line.
The `.sha256` beside a file only detects a damaged download: it is not evidence of where the file came from.

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
| `reaper` | `integrations/reaper` | `lint` (StyLua, and ruff for the harness runner), `test` (the Lua bridge harness and its mutation checks, [reaper-bridge](../architecture/reaper-bridge.md)) |
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
of them use Cargo. Lua 5.4 for the REAPER harness is the `lupa` wheel in the `lua` dependency group of `pyproject.toml` (hashed in `uv.lock`); the Lua job installs only that group. Platform-specific sidecars must be built on their target OS,
so the built UI bundle is shared between jobs as a one-day artifact rather than
rebuilt per platform.

## Runtime provenance

**Model and voice downloads are pinned.** Every file in `config/whisper-assets.json` and `config/tts-assets.json` is
fetched from a Hugging Face URL that names a 40-character commit (`/resolve/<commit>/...`), never a tag or a branch that
can be moved, over https, with a 64-character SHA-256 and a size that the installer checks in a staging directory before
anything is activated. `apps/desktop/internal/assets/pins_test.go` fails on a tag or branch in a URL, a non-https URL, a
malformed checksum or a missing size, and its own cases prove each rule on a bad fixture. When adding a voice or model,
resolve its commit (`git ls-remote https://huggingface.co/<owner>/<repo> refs/tags/<tag>`, or the `X-Repo-Commit`
response header) and put it in the URL. The Piper voice's `version` stays `1.0.0` (it names the install directory, so
existing installs stay valid); only the download URLs moved from the tag `v1.0.0` to its commit, with the same hashes.
The Whisper path that loads a model by name from the hub when no `--model-dir` is given is not covered here (release
readiness provisioning phase 2).

`scripts/release/prepare-resources.py` freezes only the two first-party Python
tool entry points. It does not bundle optional voices, models, dictionaries, or
unreviewed third-party binaries. Before publishing a release that adds such an
artifact, add its publisher, version, immutable URL, SHA-256, code/artifact
license, installation location, attribution, and update policy to the release
record, following `docs/research/local-dependency-evaluation.md`.
