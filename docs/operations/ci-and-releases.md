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
repository (read with `gh api repos/countrymanprime/narration-utils/rulesets`, and `.../environments` and `.../actions/permissions`, on
2026-09-21) and what that means for CI. The docs follow the settings, not the other way round (owner decision D11 of the [implementation plan](../prds/implementation-plan.md)).

- **`Main Protection` ruleset** (active): deleting `main`, force-pushing to it and re-creating it are blocked. The
  admin role and the owner bypass it.
- **`Pull Request` ruleset** (active): squash merges only; one approval; **code-owner review is required**
  (`.github/CODEOWNERS` names `@countrymanprime` for every path); a new push dismisses stale approvals; the last push
  must be approved; every review thread must be resolved; its `require_extra_approval_for_unattributed_changes` option is on. The admin role can bypass it through a pull request, and the
  owner `@countrymanprime` is exempt, so the solo maintainer merges their own pull requests.
- **No ruleset requires a status check.** CI is advisory: a red job does not block a merge and a green one does not
  permit it, so the maintainer reads the run before merging (the table below says what each check is). Requiring
  checks is an owner-only setting. If it is ever turned on, the names to require are the ones in the table, and two
  things need a decision first: `ci.yml` skips documentation-only pull requests (`paths-ignore: docs/**, **/*.md`),
  which would leave a required check pending on them, and the visual and atlas jobs have to have stopped failing
  without a code change (see [Keeping a red run meaningful](#keeping-a-red-run-meaningful)). The one check that is
  safe to require today is **`Docs / Links (offline)`**: it runs on every pull request, so it is never skipped, and it
  reads only the repository, so it does not flake ([The docs link check](#the-docs-link-check)).
- **Two settings the workflows rely on are the owner's to change:** "Require actions to be pinned to a full-length commit
  SHA" (off now; `zizmor` already enforces the same rule, and the setting is a backstop to enable after the pinning
  change has run once with Dependabot) and immutable releases (off, and they stay off: they would break the late macOS
  and Linux upload and the release-candidate prune, see [#186](https://github.com/countrymanprime/narration-utils/issues/186)).
  The owner checklist is in [Tracking work on GitHub](github-workflow.md#owner-checklist-for-the-release-supply-chain-work).
- **Nothing in CI checks a pull request title.** Conventional Commit messages are enforced by the local commitlint hook (Husky
  `commit-msg`) on the commits you make, but the title of a pull request becomes the squash commit and decides the next version, and
  no job reads it: the maintainer does, prompted by the pull request template. A title-check job was considered and not added: with
  no required checks it could only advise, and a new action or script in the release path is a change to review on its own.
  Adding one later means a small, SHA-pinned job in `ci.yml`.
- **Draft pull requests are not skipped.** `ci.yml` has no draft condition, so every push to a draft runs the same checks as a
  ready pull request (a newer push cancels the run before it). No other workflow has a draft condition either.
- macOS and Linux are deliberately
  not built on pull requests (see [ADR-0027](../adr/0027-windows-gates-and-creates-the-release.md)), so `Build (Windows)`
  is the only native build a pull request runs.

The checks a pull request shows, by the name GitHub displays (`ci.yml` calls `_quality.yml` as `quality` and
`_ui-dist.yml` as `ui-dist`):

| Check | What it runs |
| --- | --- |
| `quality / js` | `lint`, `format`, `architecture` (the import rules) and `test` of `narration-utils-ui` (Vitest with the coverage ratchet), then Knip over the whole repository |
| `quality / ui-visual` | the Playwright visual suite of the mock-backed app (`pnpm --dir apps/ui run screenshots`); uploads screenshots, and traces when it fails |
| `quality / ui-atlas` | the Storybook component atlas: every story in light and dark at a wide and a narrow viewport, with axe |
| `quality / ui-atlas-kit` | the tests of `tools/ui-atlas-kit` and its drift check against `apps/ui` |
| `quality / docs-site` | the public docs site ([below](#the-public-docs-site)): ruff and pytest of `tools/docs-site`, a strict MkDocs build of `docs/` and the link check over the built HTML; fails on any dead internal link |
| `quality / repo-scripts` | the plain-Node tests of `scripts/` (labels, milestones, release tooling, the layout and project guards) |
| `quality / python` | ruff and pytest for `libs/python`, the sidecars, `scripts/` and `tests/fixtures` |
| `quality / lua (ubuntu-latest)`, `quality / lua (windows-latest)` | StyLua and ruff on `integrations/reaper`, then its bridge harness under Lua 5.4 (a fake `reaper` driven through the file protocol, and the mutation checks; [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)) |
| `quality / go` | Windows: gofmt, go vet, golangci-lint, the tests with the race detector, then `test-schedules` |
| `ui-dist / build` | builds the UI bundle the Windows build reuses |
| `Build (Windows)` | the native Windows build, starting as soon as `ui-dist / build` finishes |

`codeql.yml`, `dependency-review.yml`, `docs.yml`, `security.yml` and `zizmor.yml` run their own checks and are advisory too
([every workflow](#every-workflow), [Tracking work on GitHub](github-workflow.md)). A pull request that changes only `docs/**` or
Markdown runs none of the `CI` checks, and not CodeQL either, so a docs-only change is reviewed by reading and by the link check
([The docs link check](#the-docs-link-check)); `docs.yml`, `zizmor`, `security.yml`, `dependency-review.yml` and the labeler have no path
filter and always run.

**The `production` environment** (read live on 2026-09-21) has `@countrymanprime` as its one required reviewer, **Prevent self-review**
left off and administrator bypass left on, so the owner can promote an emergency or solo release. It has **no deployment branch or tag
restriction** (`deployment_branch_policy` is null); `promote-release.yml` checks for itself that the candidate tag is an ancestor of `main`
and a pre-release. Restricting the environment to `main` and tags matching `v*` would also stop a run from another branch and is an
optional owner setting ([owner settings](github-workflow.md#repository-settings-that-only-the-owner-can-change)); it is not on today.

## Every workflow

Each file in `.github/workflows`, what starts it, and the checks it shows on a pull request (`_` files are reusable and start nothing themselves):

| Workflow | Starts on | Jobs and check names | Blocking? |
| --- | --- | --- | --- |
| `ci.yml` (`CI`) | pull request that is not docs- or Markdown-only; manual | `quality / *` and `ui-dist / build` (the reusable `_quality.yml` and `_ui-dist.yml`), `Build (Windows)` | no ruleset requires it |
| `prerelease.yml` (`Prerelease`) | push to `main` that is not docs- or Markdown-only; manual | `quality / *`, `ui-dist / build`, `version`, `Windows build` (needs `ui-dist` and `version`, so it runs beside the quality jobs) and `Windows release` (needs the build and every quality job); both run only when `version` found a releasable change. A manual run can tick `cold-freeze` to freeze the sidecars without the [freeze cache](#the-sidecar-freeze-cache) | not a pull request check |
| `promote-release.yml` | manual, with an RC tag; behind the `production` environment | `promote` | not a pull request check |
| `build-macos.yml`, `build-linux.yml` | manual, or started by the `Windows release` job | one reusable `_attach-platform.yml` run: `Check the release`, `ui-dist / build`, `Build and attach <platform>` | not a pull request check |
| `docs.yml` (`Docs`) | every pull request (no path filter), weekly (Monday 07:17 UTC), manual | `Links (offline)` (pull requests and manual) and `Links (online, advisory)` (weekly and manual) ([below](#the-docs-link-check)) | the offline job **fails the run** on a dead repository link; no ruleset requires it (owner-only setting) |
| `zizmor.yml` | every pull request, push to `main`, manual | `zizmor` | advisory in GitHub terms (not required); a finding at the `regular` persona fails the run |
| `security.yml` (`Security scan`) | every pull request, push to `main`, weekly (Tuesday 06:41 UTC), manual | `govulncheck`, `osv-scanner (pull request)` (only for a same-repository pull request that is not Dependabot's) or `osv-scanner` (every other trigger) | advisory: neither fails on a finding |
| `codeql.yml` (`CodeQL`) | pull request to `main` that is not docs- or Markdown-only (same-repository, not Dependabot), push to `main`, weekly (Monday 05:23 UTC), manual | `Analyze (go)`, `Analyze (javascript-typescript)`, `Analyze (python)` | advisory |
| `dependency-review.yml` | pull request to `main` | `review` (fails on a high-severity advisory, or on a licence outside the allow-list, that a pull request adds to a **runtime** dependency; needs the dependency graph; [the licence policy](github-workflow.md#the-dependency-licence-allow-list)) | advisory |
| `labeler.yml` | `pull_request_target` (opened, synchronize, reopened, ready for review) | `label` | not a check that gates anything |
| `pages.yml` (`Pages`) | push to `main` (any change, docs included); a pull request that changes `docs/`, `tools/docs-site/`, the Storybook config, `pyproject.toml`, `uv.lock` or the workflow (`build` only); manual | `build`, `deploy` ([below](#the-pages-workflow)); `deploy` never runs for a pull request | the `build` job is the docs link check for a documentation-only pull request; advisory like the rest |
| `sync-labels.yml`, `sync-milestones.yml` | push to `main` that changes `.github/labels.json`, `config/roadmap.json` or `scripts/github/**`, and the workflow file; manual | `sync` | run after a merge, never on a pull request |

The tests of `scripts/github/*.test.mjs` (the label and milestone sync) run in `quality / repo-scripts`. Nothing runs on a schedule except
CodeQL, the security scan and the online link check. There is no `github-scripts` job and no changed-file classification: Nx `affected` decides what a pull
request runs (see [Nx projects and the quality gate](#nx-projects-and-the-quality-gate)).

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

**Pin check (2026-09-21).** All 17 distinct `owner/repo@sha` pins in `.github/workflows` and `.github/actions` (45 lines; none
unpinned) were checked against GitHub: each comment's tag exists and resolves, through an annotated tag where there is one, to exactly
the pinned commit. The pins are uniform in form, not in version: two `setup-node` majors are in use (`v7.0.0` in
`promote-release.yml`, `v4.4.0` in the `setup-toolchain` composite action), and the composite actions also hold `setup-go` and
`setup-python` `v5.6.0`, `cache` and `download-artifact` `v4.3.0` and `pnpm/action-setup` `v4.3.0` while the workflows are on the
latest `checkout`, `upload-artifact` and `setup-node`. The likely cause is Dependabot's `github-actions` entry, which has
`directory: /` and, per GitHub's [options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference),
searches `/.github/workflows` and a root `action.yml` only, not `.github/actions/*/action.yml`; adding `directories: ["/", "/.github/actions/*"]`
would include them. That is a configuration change with its own review, so it is not made in a documentation pull request.

The permission model, so a change can be judged against it:

- Every workflow declares `permissions` at the top, and a job that needs more raises it for that job only. The
  top-level default is `contents: read` (`zizmor.yml`, `promote-release.yml` and `pages.yml` use `{}`). The one exception is
  `build-macos.yml` and `build-linux.yml`, whose `contents: write`, `id-token: write`, `attestations: write` and
  `artifact-metadata: write` are a workflow-level grant because a caller must grant everything the reusable
  `_attach-platform.yml` holds; only its `attach` job uses them.
- The `publish` job (`Windows release`) of `prerelease.yml` holds `contents: write` (create the release), `actions: write` (start the
  optional macOS and Linux builds) and the three attestation permissions (`id-token`, `attestations`,
  `artifact-metadata`: write). The `windows-build` job, which runs the third-party build tooling (PyInstaller, Wails, NSIS, pnpm),
  holds only the workflow's `contents: read`; `promote-release.yml`'s one job holds `contents: write` (create the stable tag and
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

The pre-release workflow runs after each push to `main` that changes more than `docs/**` or Markdown (and by hand). It runs the quality
Windows build beside the quality jobs, and its Windows release job waits for both. Nx Release
uses the squash commit title to calculate the synchronized application version:
`feat` is minor; `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, and `revert` are patch. Pre-1.0 breaking changes are handled as the
next minor release. The workflow tags `v<version>-rc`, builds the Windows
package, and once quality is green its `publish` job creates the GitHub pre-release with the Windows
zip and the Windows setup program ([The Windows setup program](#the-windows-setup-program)). The last step starts the optional **Build macOS** and **Build Linux**
workflows, which build the release tag and attach their asset
([ADR-0027](../adr/0027-windows-gates-and-creates-the-release.md)). They are
separate runs, so a failed non-Windows build never delays or reddens the Windows
release. To retry one, re-run its workflow run, or start **Build macOS** /
**Build Linux** from the Actions tab with the release tag (for example
`v0.2.1-rc`); the upload overwrites, and it works for a promoted release too.
Other workflows can call them with `uses:` and a `tag` input.

Each platform ships one asset named `narration-utils-<platform>.<ext>`, with a
`.sha256` beside it; Windows also ships its setup program and its third-party notices, named and checksummed the same way. Only Windows is required
(and for Windows all three files are: a build that lost its setup program or its notices is not promotable):

| Platform | Asset | Contents |
| --- | --- | --- |
| `windows-x64` | `narration-utils-windows-x64.zip` | `narration-utils.exe` (what the in-app updater downloads) |
| `windows-x64` | `narration-utils-windows-x64-setup.exe` | the NSIS setup program (what a narrator runs first; [below](#the-windows-setup-program)) |
| `windows-x64` | `THIRD-PARTY-NOTICES.txt` | the licences of everything the program contains, the AGPL text and the source offer ([Third-party notices](#third-party-notices)); **not** inside the zip |
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
(`scripts/release/assets.mjs` and the updater's `PlatformFor` mirror each other). The setup program is not part of that contract: the
updater matches its zip and checksum by exact name and ignores every other asset.

## The Windows setup program

A narrator installs from `narration-utils-windows-x64-setup.exe`, an NSIS installer that Wails builds ([ADR 0082](../adr/0082-windows-installs-per-user-from-an-nsis-setup-program-that-wails-builds-and-the-release-carries-beside-the-update-zip.md)).

- **How it is built.** `.github/actions/build-native` passes `-nsis` to `scripts/release/wails-build.mjs` on `windows-x64`, after a step
  that installs NSIS (`choco install nsis`, version pinned in the step) when `makensis` is not already on the runner. `wails doctor`
  on the hosted runner lists `nsis` as available, not installed, and Wails only warns, and exits 0, when `makensis` is missing. So
  `wails-build.mjs` removes a setup program left by an earlier build before it runs and fails when `-nsis` was passed and the file is not
  there afterwards, and `assets.mjs package` refuses to package Windows without it. The log shows `makensis version:` and Wails'
  `Building 'amd64' installer` line, and the job summary lists the release files with their sizes.
- **What it does.** Per user (no elevation, `%LOCALAPPDATA%\Programs\Narration Utils`, uninstall entry under `HKCU`), `narration-utils.exe`
  as the program name, a Start Menu shortcut, a desktop shortcut the narrator can untick, the WebView2 runtime installed by Microsoft's
  bootstrapper only when it is missing, and an uninstaller that removes the program, the update copies (`.new`, `.old`, `.failed`) and the
  shortcuts and leaves settings, downloaded assets, the WebView2 data and project folders alone. The definition is
  `apps/desktop/build/windows/installer/project.nsi`; `wails_tools.nsh` beside it is regenerated on every build and is not checked in. The
  publisher, product name and version come from `apps/desktop/wails.json` (`info`), whose version `sync-version.mjs` keeps equal to the
  release version.
- **What CI showed** (the `Build (Windows)` job of pull request 224, 2026-09-21): `makensis` was not on the runner; the pinned step installed `nsis.install` 3.11.0 and printed `makensis version: v3.11`; Wails printed `Building 'amd64' installer: Done.`; the setup program was 196,676,207 bytes and the zip 195,290,110; the bootstrapper check printed `Valid, CN=Microsoft Corporation`. The NSIS step adds about 15 seconds and the installer build about a minute.
- **Why per user.** The in-app updater renames the running program in its folder and never asks for elevation; under Program Files
  it would answer that it cannot replace itself. Per machine is not offered.
- **The WebView2 bootstrapper** Wails embeds is downloaded from Microsoft while the installer is built and nothing pins it, so the build
  checks that `installer/tmp/MicrosoftEdgeWebview2Setup.exe` has a valid Authenticode signature from Microsoft Corporation before the
  release is packaged.
- **Unsigned.** The setup program is not signed (owner decision D7); the release notes say so and tell a narrator to choose **More info**
  then **Run anyway** on the SmartScreen warning (`scripts/release/generate-notes.mjs`). No workflow here signs anything.
- **Tests.** `scripts/release/installer.test.mjs` holds the definition to the decisions of the ADR (the file names, per user, what the
  uninstaller deletes, no network, no signing, that the file is tracked); `assets.test.mjs` and `wails-build.test.mjs` cover packaging, the
  checksum, the promote checks and the missing-installer failure. `makensis` is not on a development machine, so the compile is proven only by the
  `Build (Windows)` job; an install on a clean machine is the owner's check (the first stable rehearsal, PRD phase 16).
- **Install and uninstall by hand** for a check: run the setup program; `narration-utils-windows-x64-setup.exe /S` installs silently
  (both shortcuts) and `"%LOCALAPPDATA%\Programs\Narration Utils\uninstall.exe" /S` removes it.

## The packaged-app smoke test

A release must start on a machine that has none of the repository. Wails is a GUI program, so CI cannot start it and look at a
window; instead the executable has a non-interactive mode, `narration-utils --smoke` (`apps/desktop/smoke.go`), that runs before
the update relaunch logic, the single-instance lock and the window exist, checks what the release carries, prints a JSON report
and exits: `0` when every check passed, `1` when one failed, `2` for a bad command line. It downloads nothing.

| Check | What it proves |
| --- | --- |
| `resources` | the embedded resources unpack into the per-user cache (the same code the app runs at launch) |
| `asset-cache` | the asset cache folder (`<user cache>/narration-utils/assets`) can be created and written |
| `sidecar:<name>` | each of the three frozen sidecars is in the unpacked tree and starts (`--help` exits 0) |
| `guide:cmudict`, `guide:espeak` | the frozen Story Bible sidecar reads the CMU dictionary and starts the espeak-ng phonemizer Piper speaks through, from `piper/espeak-ng-data` (`manuscript-guide self-check`); a freeze that loses either data set fails here, and a self-check that stops reporting one of them fails too |
| `guide:synthesis` | only with `--piper-model FILE`: the frozen guide loads that voice and speaks one word |
| `catalogs` | the three approved asset catalogs load and name assets |
| `reaper` | the launcher and its six scripts are present and the launcher points at this executable |

CI runs it in the `Smoke test the packaged app` step of `.github/actions/build-native`, on `windows-x64` only, after the Wails
build and before the release asset is packaged, so both `Build (Windows)` in `ci.yml` and the Windows release build of
`prerelease.yml` fail on a build that cannot start. The macOS and Linux previews are not smoked. There is no path filter to
restrict it to package changes: the build itself runs on every non-docs change, and the check adds a few seconds. The step points
`LocalAppData` at an empty folder, writes the report to a file (a GUI-subsystem program's standard output can be lost) and shows it
in the log and the job summary. To run it locally, build as in `README.md`, then
`narration-utils.exe --smoke --report smoke.json` (set `LocalAppData` to an empty folder to leave your own cache alone; add
`--piper-model <the installed .onnx>` to hear one word spoken by the frozen sidecar).

**Decision: CI does not speak a word.** A real synthesis needs the 114 MB voice, and downloading that on every run would cost
more than the risk it covers. What a freeze loses (the espeak-ng data, the dictionary) is what `guide:espeak` and `guide:cmudict`
exercise without a voice; the one-word synthesis is a local check with `--piper-model`, run whenever the freeze arguments change
(`scripts/release/prepare-resources.py`). Seed the voice with `pnpm run assets:seed -- tts`.

`scripts/release/verify-installable.mjs`, which runs before the Wails build, keeps its checks separate: the three sidecars, the
Piper and ONNX Runtime folders of the frozen guide, the guide's `piper/espeak-ng-data`, `cmudict/data` and cmudict package metadata
(`cmudict-<version>.dist-info`), the three asset catalogs, and the REAPER files. Each has a test in
`scripts/release/verify-installable.test.mjs`. `prepare-resources.py` gives the guide `--collect-data piper --collect-data cmudict`
and `--copy-metadata cmudict`; PyInstaller has no hook for them (the guide grows by about 48 MB; `piper/hebrew` and `piper/tashkeel`
come with the package data and English does not need them, a saving left for a later change).

**Known gap, not fixed here:** the IPA shown for a name the CMU dictionary lacks comes from the `phonemizer` package, which needs a
system `libespeak-ng` that no build ships (it fails with "espeak not installed on your system" on a developer machine too), so
such a name gets no pronunciation in any build. That is a Story Bible behaviour, separate from previews, which speak through Piper's
own bundled espeak-ng; `guide:espeak` checks the latter. Using Piper's phonemizer for the IPA fallback would close it.

The smoke test's `resources` step unpacks into the same per-user cache the app uses, so do not run it while the app is open.

## Build provenance

Every release asset is attested: `actions/attest` records, in GitHub's attestation store, which workflow, commit and
run built a file (SLSA build provenance, level 2: the build runs in the calling job, so it is not the isolated
level 3). The subjects are identified by digest:

| Platform | Signed by (the workflow the certificate names) | Subjects |
| --- | --- | --- |
| Windows | `.github/workflows/prerelease.yml`, the `publish` job | `narration-utils-windows-x64.zip`, `narration-utils-windows-x64-setup.exe`, their `.sha256` files, and `narration-utils.exe` (so the executable can be checked after the zip is extracted, which an in-app update can do) |
| macOS | `.github/workflows/_attach-platform.yml` (the reusable workflow, not `build-macos.yml`) | the zip and its `.sha256` |
| Linux | `.github/workflows/_attach-platform.yml` | the archive, its `.sha256`, and `narration-utils` |

- The step runs before anything is published. Windows builds in `windows-build`, which records the SHA-256 of every file
  as a job output; `publish` downloads the files, refuses any that do not match those digests (or that the build did not
  record), and attests before the prune and `gh release create`, so it attests the bytes that were built; macOS and Linux attest before `gh release upload`. If it fails the job fails and nothing
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
gh attestation verify narration-utils-windows-x64-setup.exe --repo countrymanprime/narration-utils
```

Success prints the workflow, commit and run that built the file; a modified or unattested file fails. To insist on the
release workflow and `main`, add `--signer-workflow countrymanprime/narration-utils/.github/workflows/prerelease.yml --source-ref refs/heads/main`
(macOS and Linux: `_attach-platform.yml`). `gh attestation download <file> --repo ...` saves the attestation as a
`.jsonl` bundle that `--bundle <file>` then verifies without asking GitHub for it. The same works for the executable
inside the zip after extracting it, which is what an in-app update can check. The release notes say the same in one line.
The `.sha256` beside a file only detects a damaged download: it is not evidence of where the file came from.

## The docs link check

`docs.yml` (workflow `Docs`) runs [lychee](https://github.com/lycheeverse/lychee) (`lycheeverse/lychee-action`, pinned to a commit, lychee 0.24.2) over every Markdown file in the repository, configured by `.lychee.toml` and `.lycheeignore` at the root. It has two jobs:

- **`Links (offline)`** (shown as `Docs / Links (offline)`) starts on **every** pull request: the trigger has no `paths` filter, on purpose. `ci.yml` skips documentation-only pull requests, so a docs job that shared its filter would also skip a *code* change that renames a file a document links to, and a check that GitHub skips because of a path filter stays pending if it is ever required (see the note at the top of this document). Offline mode reads only the tree and never opens a network connection: a relative link must resolve to a file, and a `#fragment` to a heading of that file (checked; `include_fragments = "anchor-only"` works with `--offline`). A local run over the 227 Markdown files and 1,356 links takes 0.13 seconds (the Actions run adds the runner set-up), so it is cheap enough to block on, and it is deterministic. **It blocks in the sense that a dead link turns the check red**; a red check does not stop a merge while no ruleset requires it (owner decision D11), so the maintainer reads it like the others, and adding `Docs / Links (offline)` to the `Pull Request` ruleset's required checks is an owner-only setting that is safe to make. It replaces nothing: the docs-site build ([below](#the-public-docs-site)) checks the built HTML of the pages it publishes, and `apps/ui/src/docsGuide.test.ts` checks the guide's own anchors.
- **`Links (online, advisory)`** starts weekly and by hand. It also follows the `http(s)` links (with `actions/cache` on `.lycheecache`, one day), reports the ones that rotted in the job summary, and **never fails**: a link on someone else's server is not a regression in this repository. `429 Too Many Requests` is accepted. The `GITHUB_TOKEN` is passed only to lift GitHub's anonymous rate limit.

**Diagrams.** lychee reads a Mermaid block as text, so `scripts/ci/mermaid-diagrams.test.mjs` (in `quality / repo-scripts`, and so in `pnpm check`) hands every ```` ```mermaid ```` block of every tracked Markdown file to Mermaid's own parser (`mermaid.parse`, the `mermaid` devDependency of the root package) and fails with the file, the line and the parser's message. It needs no browser: Mermaid's sanitizer only wants a DOM, and the test gives it jsdom (already a dependency of the UI's tests) before it imports Mermaid. It proves the syntax, not that the names in a picture are still true; the five diagrams of [the codebase map](../architecture/codebase-map.md#how-the-parts-connect) and the four flows each say which files they were checked against, and the test fails if one of the five owning docs loses its diagram.

What it does not see: a path in a code comment (`docs/prds/<name>.prd.md` in a Go or Python file) is not a Markdown link, so `scripts/ci/prd-references.test.mjs` (in `quality / repo-scripts`) fails when a source file cites a PRD that is not in the tree ([ADR 0028](../adr/0028-planned-work-is-specified-as-prds-and-deleted-when-built.md) deletes them by design). Mermaid diagrams are text to lychee.

The baseline on 2026-09-21 (S17 phase 1): 0 dead repository links; 7 external links rotted or unreachable, six of them pull requests of the owner's private repositories cited as history in `tools/ui-atlas-kit/docs/rollout-ledger.md` (now ignored, with the reason, in `.lycheeignore`) and one real finding, the README's link to the published site `https://countrymanprime.github.io/narration-utils/`, which answers 404 until the owner enables GitHub Pages ([#231](https://github.com/countrymanprime/narration-utils/issues/231)). To add a link the checker should not chase, add a regular expression to `.lycheeignore` with its reason; to run the check locally, install lychee (`cargo install lychee --locked`) and run `lychee --config .lychee.toml --offline .` (drop `--offline` for the online run).

## Third-party notices

`scripts/licenses/notices.py` writes `THIRD-PARTY-NOTICES.txt`: the licence and licence text of every third-party component the Windows release contains, the AGPL-3.0-or-later text of the program itself, and the **source offer** that AGPL and the GPL-family packages in the frozen Story Bible sidecar ask for (this repository, at the release's tag). Owner decision D17 ([ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md)) makes bundling Piper, `phonemizer` and eSpeak NG fine, so the job of the file is to carry their notices, not to avoid them. Run it after `scripts/release/prepare-resources.py` has frozen the sidecars:

```bash
uv run python scripts/licenses/notices.py --version 0.1.0 --tag v0.1.0-rc --out THIRD-PARTY-NOTICES.txt
```

Each part is read from the thing the release is built from, so nobody keeps a list that can drift (this answers Open Question 11 of the PRD: **derive the shipped Python set from the frozen bundle**, proven on the local build):

| Ecosystem | Source of truth | Notes |
| --- | --- | --- |
| Python | The `Analysis-00.toc` and `PYZ-00.toc` PyInstaller writes for each of the three freezes (`.release-build/<sidecar>/work/<sidecar>/`): every module, binary and data file it took, with its source path. The `site-packages` ones are the shipped packages; `importlib.metadata` of the same environment gives their licences and licence files | 74 distributions on the local build. The freeze takes more than the runtime needs (`hypothesis`, `pytest`, `setuptools`, `fastapi`: [#245](https://github.com/countrymanprime/narration-utils/issues/245)); the report lists what is really there rather than what `pyproject.toml` says |
| npm | `pnpm licenses list --prod --json` in `apps/ui`, with each package's licence file | 44 packages |
| Go | `go list -deps` of the desktop program for `windows/amd64` with the Wails build tags, minus the main module and the standard library, with each module's licence file classified by its text | 18 modules; `giraffesyo/pdf` is behind the `pdf_candidate` tag and not in a build |
| By hand | `scripts/licenses/manual.json`: the Python runtime, the PyInstaller bootloader, OpenSSL, libffi, the Visual C++ runtime, the FFmpeg libraries and the OpenBLAS and GCC runtime vendored inside the PyAV and numpy wheels, eSpeak NG's data inside Piper, the Silero VAD model, WebView2 | What no package manager knows. The FFmpeg entry records what was measured (`avutil_license()` reports LGPL v3 or later) and what is not verified (whether libx264 and libx265 make the build GPL, and libx265's exact licence) |
| Models and voices | `config/*-assets.json` | Not in the package; listed as downloaded on request, with their licence and source |

The run **fails, and writes nothing**, rather than guess: when a licence cannot be named (`UNKNOWN`, or pnpm's `Unknown`; a person decides and records it under `licenses` in `scripts/licenses/reviewed.json`, as for PyInstaller, and an entry that names a component whose licence is known, or one that is not shipped, is itself an error so a stale decision cannot hide a change); when a component ships no licence text (MIT, BSD and Apache ask for it to travel: three are recorded with their reason under `noText`, [#246](https://github.com/countrymanprime/narration-utils/issues/246)); when a frozen module no installed distribution owns, or a vendored native folder (`av.libs`) has no entry in `manual.json`; when the environment is not the one that was frozen (a different version of a package, or one that is not installed); when a table of contents is missing or is not one; or when the report lacks a direct dependency: the eight Python packages the sidecars import, every production dependency in `apps/ui/package.json` and every direct requirement of `apps/desktop/go.mod` that the Windows build links. A GNU licence text is classified by its title at the top, not by the licences it quotes (GPL-3.0 names the Affero licence in section 13). `scripts/licenses/tests/test_notices.py` pins each reader and each of those refusals on fixtures and, where `go` and the UI's `node_modules` exist, runs the real npm and Go readers against the tree. **On the release.** The Windows build writes the file after the freeze (the `Write the third-party notices` step of `.github/actions/build-native`, which also installs the UI's packages for `pnpm licenses`, on Windows only; every pull request's `Build (Windows)` runs it, so a change that makes the generator refuse fails the pull request that caused it) into `apps/desktop/build/bin`, and `scripts/release/assets.mjs package` copies it to `release-assets/THIRD-PARTY-NOTICES.txt` with a `.sha256`, refusing to package a build that has no notices before it zips anything. It is then attested with the other files (`release-assets/*`), verified by `assets.mjs verify` (a Windows release without it, or with a changed one, is not promotable) and by `verify --attestations`, and the release notes point at it (`## Licences and source`). The source offer names the tag the build came from (`v<version>-rc`) **and its commit**: a release candidate's tag is pruned once ten newer ones exist (`prerelease.yml`), and a promotion re-attaches these same bytes, so the commit is what keeps the offer true for the promoted release.

**It is not in the update zip.** The in-app updater refuses a zip that holds anything but `narration-utils.exe` ([in-app update](../architecture/in-app-update.md), [ADR 0074](../adr/0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md)), and an already installed client would refuse every update to a two-file zip. So the notices are their own asset, and a copy in the setup program, or a change to the updater, is left to the owner ([ADR 0085](../adr/0085-the-third-party-notices-are-generated-from-the-release-and-ship-as-their-own-asset-and-not-inside-the-update-zip.md), Proposed; [#250](https://github.com/countrymanprime/narration-utils/issues/250)). `scripts/release/verify-installable.mjs` is unchanged: it checks the resources the app needs to start, and the notices are written after it runs.

## The Pages workflow

`pages.yml` publishes the public site to GitHub Pages, at `https://countrymanprime.github.io/narration-utils/`, on every push to `main` and on
demand: the docs at the root ([below](#the-public-docs-site)) and the Storybook component atlas of `apps/ui` under `/storybook/` (PRD phases 9 and 11).

- **Two jobs.** `build` (read-only token) checks out with `persist-credentials: false`, runs the `setup-toolchain` action (pnpm, and
  the `docs` uv group only), `pnpm --dir apps/ui run build-storybook`, `nx run docs-site:build` (the strict docs build and its link check),
  copies `apps/ui/storybook-static` to `tools/docs-site/build/site/storybook`, checks every link of the combined site (including the atlas
  page's link to the Storybook) and uploads it with `actions/upload-pages-artifact`. `deploy` needs it, runs only on a push or manual
  start on `refs/heads/main` (a manual start from a branch builds and stops), holds `pages: write` and `id-token: write` (the only
  job that does), uses the `github-pages` environment and calls `actions/deploy-pages`. The top-level `permissions` is `{}` and there
  is no secret. One deployment runs at a time and a running one is never cancelled.
- **A pull request runs `build` only.** `ci.yml` skips documentation-only pull requests, and those are the ones that break links, so
  a pull request that changes `docs/`, `tools/docs-site/`, `apps/ui/.storybook/`, `pyproject.toml`, `uv.lock` or the workflow runs the
  build job too: a read-only `pull_request` token (a fork's is read-only by GitHub's rule), nothing uploaded, its own concurrency
  group that the next push replaces, and `deploy` skipped by its `if`. The `docs-site` job of `_quality.yml` runs the same target
  for a code change.
- **It works under a project sub-path.** Pages serves this repository at `/narration-utils/`, not at `/`. Storybook's build writes
  every asset URL relative (`./sb-manager/...`, `./assets/...`), so no `base` setting is needed. Checked by serving the build
  from `/narration-utils/` on a server that answers 404 for anything outside that folder and loading `index.html` and `iframe.html`
  in Chromium in light and dark (`globals=theme:dark`): no request failed, no page or console error, the stories rendered
  (2026-09-21, [PRD phase 9](../prds/release-readiness-provisioning-and-docs-site.prd.md)). Phase 11 put it one folder deeper
  (`/narration-utils/storybook/`) and loaded it from there the same way; the docs pages use relative links only. The fonts are bundled
  (`apps/ui/src/fonts.ts`, #238), so the published atlas makes no third-party request.
- **Not enabled yet.** Pages is off for the repository and turning it on is an owner-only setting
  ([the table](github-workflow.md#repository-settings-that-only-the-owner-can-change)). Until then the `deploy` job fails with GitHub's
  "Pages is not enabled" message on each push to `main` and `build` passes. After the owner sets the source to GitHub Actions, re-run
  the latest run; the deployed address appears on the `deploy` job and in the repository's Environments list.
- **Change it like any workflow:** every action is pinned to a commit (`pinact run --verify --check`), `zizmor` must be clean, and a
  new artifact path or job goes through review of the token scopes above.

## The public docs site

The site at `https://countrymanprime.github.io/narration-utils/` is the repository's own `docs/` folder, built by MkDocs 1.6.1 with the
Material 9.7.7 theme ([ADR 0083](../adr/0083-the-public-docs-site-is-built-by-mkdocs-with-the-material-theme-straight-from-docs-and-a-reviewed-include-list.md),
the [spike](../research/docs-site-generator-spike.md) behind it). `tools/docs-site` holds configuration only and no page or picture: a test
fails if it gains one, or if `docs_dir` stops being `docs/`.

- **What is published** is `tools/docs-site/include.txt`, one path or glob per line (`dir/`, `file.md`, `*` inside a folder, `**` across
  folders): the guide, the roadmap, the component atlas, the tool pages, nine architecture pages, the design system, every ADR and the
  screenshots they embed. `docs/research/`, `docs/prds/`, `docs/operations/` and `docs/workflows/` stay out until someone lists them, so
  publishing a page is a reviewed change to that file. A line that matches nothing fails the build.
- **Links.** A relative link to a page that is not published, to a folder with no published index, or to a file outside `docs/` (`../../apps/...`,
  `../../SECURITY.md`, `../config/roadmap.json`) is rewritten at build time to the GitHub file view of that path at the commit being built
  (`DOCS_SITE_REF`, `main` locally) by `tools/docs-site/hooks.py`. A link to something that does not exist is not rewritten, so the
  strict build reports it. Links inside code spans and fenced blocks are examples and are left alone.
- **The link check.** `mkdocs build --strict` fails on any warning (a missing page, a `#heading` that is not on the page it names, a link it
  cannot place), then `tools/docs-site/check_site.py` reads the built HTML and fails on any internal `href`, `src` or `#fragment` that does not
  resolve, under the `/narration-utils/` base. Both run in `nx run docs-site:build`, so `pnpm check`, the `quality / docs-site` job and the
  `Pages` build job all gate on them. This is the first link check the repository has. Proof it fails: `tools/docs-site/tests/test_build.py`
  builds a tiny tree in which a dead page link, a dead heading link and a stale include line each fail the build.
- **Build and browse it.** `pnpm exec nx run docs-site:build` writes `tools/docs-site/build/site` (ignored); serve that folder from a
  directory that has it as `narration-utils/` to see the site under its real base path. the Nx targets run `uv run --locked --only-group docs`, which installs MkDocs (the `docs`
  uv group, not a default group) into `.venv` on first use; `NO_MKDOCS_2_WARNING=true` silences Material's MkDocs 2.0 notice.
- **Navigation** is generated from the folders; `mkdocs.yml` (`extra.nav_titles`, `extra.nav_order`) names the sections and orders the top
  level, and a page's title is its first heading. Search is local; the site loads no font and asks no third-party service (the repository link
  is a footer link, not Material's repository widget, which would call `api.github.com` on every page).
- **Diagrams.** A fenced ```` ```mermaid ```` block in a page draws as a diagram on GitHub natively and on the site through Material's Mermaid support. Material loads its Mermaid script from `unpkg.com` when the page has no `mermaid` global, which would make every visitor's browser ask a third party (the site asks none), so `hooks.py` copies the browser bundle of the pinned `mermaid` package (a root devDependency, `node_modules/mermaid/dist/mermaid.min.js`, with its licence) to `assets/vendor/` and `mkdocs.yml` lists it in `extra_javascript`. The build fails with "run `pnpm install`" if the bundle is missing, so a `docs-site` job needs the root `pnpm install` (its `pnpm-filter: narration-utils` gives it). `tools/docs-site/tests/test_build.py` proves the fence becomes a diagram, that the script is the site's own, and that the real site never names `unpkg.com`.
- **The Storybook** is copied beside the built site by `pages.yml` and linked from the generated atlas page (`hooks.py` appends the link;
  `docs/ui/atlas/index.md` is generated and not edited).
- **Dependencies** are the `docs` group of `pyproject.toml` (`mkdocs`, `mkdocs-material`, and `pytest`/`ruff` so the docs job installs that
  group alone), exact versions, locked with hashes in `uv.lock`, Dependabot's `uv` entry and its 3-day cooldown apply, and nothing of it is
  in the app. Do not raise the pins without re-running the spike: Material requires `mkdocs<2`.
- **Not proven until the owner enables Pages:** that the deployed address serves this build (phases 9 and 11 are `partial` for that reason).

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
| `docs-site` | `tools/docs-site` | `lint` (ruff), `test` (pytest), `build` (the strict MkDocs build of `docs/` and the link check; [above](#the-public-docs-site)) |
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
- **No changed-file classifier.** `scripts/ci/changed-files.mjs` (and its test) sorted a pull request into `bootstrap` and
  `package` scopes for a four-platform bootstrap and installer matrix that no longer exists. No workflow, script, Nx target or
  document called it, and Nx `affected` with `nx-scope.sh` does the job, so both files were deleted (2026-09-21) rather than wired
  in; Knip stays at zero. `git log --follow scripts/ci/changed-files.mjs` has the history.
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
the workflows; they never cache `node_modules`, `.venv`, test results or release assets. The one build output that is
cached is the [sidecar freeze](#the-sidecar-freeze-cache).
`setup-node`, `setup-python`, and `setup-go` provision the exact pinned Node,
Python, and Go versions. Wails v2.16.0 is installed only in jobs that run a
native build, golangci-lint v2.13.2 (built with the pinned Go, config in `apps/desktop/.golangci.yml`) only in the Go quality job, and the standalone
StyLua v2.1.0 binary where needed, as declared in `scripts/toolchain.json`; none
of them use Cargo. Lua 5.4 for the REAPER harness is the `lupa` wheel in the `lua` dependency group of `pyproject.toml` (hashed in `uv.lock`); the Lua job installs only that group. Platform-specific sidecars must be built on their target OS,
so the built UI bundle is shared between jobs as a one-day artifact rather than
rebuilt per platform.

### The sidecar freeze cache

Freezing the three Python sidecars with PyInstaller is most of the Windows build. `.github/actions/build-native` restores
the finished freeze (the executables in `.release-build/*/dist` and the tables of contents `THIRD-PARTY-NOTICES` is
written from) from `actions/cache`, keyed on the runner OS and architecture, the Python patch version and a hash of
`sidecars/`, `libs/python/`, `pyproject.toml`, `uv.lock` and `scripts/release/prepare-resources.py`. Only an exact key
counts (there are no fallback keys), and `prepare-resources.py --reuse` installs a sidecar from it only when its
executable and both tables of contents are there; otherwise that sidecar is frozen as before. The rules:

- **A build output, never a test verdict.** The packaged smoke test, the installability check and the notices run on
  every build, hit or miss.
- **Saved only from `main`**, after the smoke test and the notices passed. A pull request restores `main`'s entry and
  never writes one, so a pull request cannot change what a release is built from.
- **A cold freeze on demand.** Run `Prerelease` by hand with `cold-freeze` ticked; `build-native`'s `reuse-freeze: 'false'`
  does the same for any caller.

The Go toolchain is not cached on Windows: `setup-go` installs it on `D:` behind a junction in the tool cache, so a cache
of the tool cache would hold the link, not Go.

### Measuring a run

`node scripts/ci/run-timings.mjs <run-id> [--steps]` prints a run's wall clock and, per job, when it started after the run
was created, how long it ran and on which runner, as a Markdown table (with `--steps`, every step too). It reads the
Actions API through `gh`. Queueing shows up as a large "Started after": the repository is public on the free plan, 20
hosted jobs at once across the account.

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
