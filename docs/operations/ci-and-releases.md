# CI and releases

## Local setup

Run `pnpm run bootstrap` once after cloning. It installs the root release
tooling and Husky hooks in addition to the existing application dependencies.
The hooks enforce Conventional Commit messages and check staged TypeScript,
Python, Go, and Lua files. Use `pnpm run check` for the full quality suite (every Nx
project's lint, format, test and build targets; see [Nx projects and the quality
gate](#nx-projects-and-the-quality-gate)).

## Repository settings to configure once

GitHub Actions cannot configure these repository settings from a workflow. As of
2026-09-19 neither `main` ruleset requires a status check. To make Windows the
merge gate, add required checks for `CI / Build (Windows)` and the quality jobs
(for example `CI / quality / js` and `CI / quality / go`);
macOS and Linux are deliberately not built on pull requests (see
[ADR-0027](../adr/0027-windows-gates-and-creates-the-release.md)). The `CI`
workflow skips documentation-only changes, so a required check would stay
pending on those pull requests; drop `paths-ignore` from `ci.yml` before
requiring checks if that matters. Conventional Commit titles are enforced by the
local commitlint hook, not by CI. `CODEOWNERS` requests `@countrymanprime` for
review but is intentionally not a required review while the repository has a
solo maintainer.

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
| `narration-utils-ui` | `apps/ui` | `lint`, `format`, `test`, `build`, `visual` (Playwright screenshots), `atlas` |
| `narration-utils-shell` | `apps/desktop` | `lint` (gofmt, go vet, golangci-lint v2: errcheck, staticcheck, gosec and the `standard` set), `test` (`-race` in the `ci` configuration), `package` (`wails build`, not part of the gate) |
| `narration-common` | `libs/python` | `lint` (ruff), `test` (pytest) |
| `manuscript-guide`, `manuscript-teleprompter`, `transcript-compare` | `sidecars/<name>` | `lint`, `test` |
| `reaper` | `integrations/reaper` | `lint` (StyLua) |
| `repo-scripts` | `scripts` | `lint`, `test` (pytest), `test-node` (`node --test`) |
| `ui-atlas-kit` | `tools/ui-atlas-kit` | `test` |
| `config`, `fixtures` | `config`, `tests/fixtures` | none (fixtures: `lint`); they exist so a change to them affects the projects that read them |
| `narration-utils` | the repo root | none; the `nx release` project |

- **`pnpm check`** runs `nx run-many` over `lint format test test-node build`, one project at a time and never from
  the Nx cache, so a green gate means every check ran. `check:fast` and the Git hooks still use
  `scripts/quality.mjs` on staged files.
- **Look around** with `pnpm exec nx show projects`, `pnpm exec nx graph`, and
  `pnpm exec nx show projects --affected --files=<path>`. Run one project's check with, for example,
  `pnpm exec nx run manuscript-guide:test`.
- **CI** keeps its job names (`js`, `ui-visual`, `ui-atlas`, `ui-atlas-kit`, `repo-scripts`, `python`, `lua`, `go`), so
  the required-check names above are unchanged. Each job runs its targets through
  `.github/actions/nx-run`: on a pull request `nx affected` against the base branch, otherwise every selected
  project, one task at a time (parallel tasks starve the two-vCPU runners and trip the UI tests' timeouts).
  `scripts/ci/nx-scope.sh` decides: everything runs when the event is not a pull request, or the change
  touches a file no project owns but all depend on (`nx.json`, `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `pyproject.toml`, `uv.lock`, the root `project.json`, `stylua.toml`, `.prettierrc.json`,
  `.prettierignore`, `.editorconfig`, `.gitattributes`, `scripts/quality.mjs`, `scripts/toolchain.json`, anything under
  `.github/workflows` or `.github/actions`). The two Playwright jobs keep
  their own `run:` steps (the atlas kit's audit looks for them) and skip them through
  `.github/actions/nx-affected` when the UI is not affected. The atlas-kit job always runs, because its drift check
  reads `apps/ui`, and so does the `repo-scripts` job, because the layout and project guards read every tracked file.
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
