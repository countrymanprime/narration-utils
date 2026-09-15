# CI and releases

## Local setup

Run `scripts\Quickstart.ps1` once after cloning. It installs the root release
tooling and Husky hooks in addition to the existing application dependencies.
The hooks enforce Conventional Commit messages and check staged TypeScript,
Python, Rust, PowerShell, and Lua files. Use `npm run check` for the full
quality suite.

## Repository settings to configure once

GitHub Actions cannot configure these repository settings from a workflow. In
the repository UI, create a `main` ruleset that requires pull requests, squash
merges, `CI / Conventional Commit title`, `CI / Build sources`, `CI / Test
suite`, `CI / Format and lint`, and all package jobs. Disable force pushes.
Draft pull requests intentionally skip these jobs; marking one ready for review
starts a fresh run. `CODEOWNERS` requests `@countrymanprime` for review but is
intentionally not a required review while the repository has a solo maintainer.

Create a `production` environment with `@countrymanprime` as a required
reviewer. Leave **Prevent self-review** disabled and leave administrator bypass
enabled so the owner can promote an emergency or solo release. Restrict the
environment to `main` and tags matching `v*`.

## Version lifecycle

The pre-release workflow runs after each non-release push to `main`. Nx Release
uses the squash commit title to calculate the synchronized application version:
`feat` is minor; `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
`chore`, and `revert` are patch. Pre-1.0 breaking changes are handled as the
next minor release. The workflow creates a `-beta.N` tag, builds native
packages, writes `SHA256SUMS.txt`, and creates a GitHub pre-release.

Use **Promote pre-release** with the beta tag when it is ready. It validates
main ancestry and checksums, waits for `production` approval, then creates the
stable tag and GitHub release from the exact same downloaded assets. It never
rebuilds an approved candidate.

## CI performance

The workflow is gated as Conventional Commit validation, source build, test and
format/lint in parallel, then the installer matrix. A failed prerequisite skips
all of its dependent jobs. `setup-node` and `setup-python` cache npm and pip
package downloads; the workflow also caches Cargo's registry and Git dependency
sources per OS, architecture, and lockfile. Installer artifacts are retained for
review and handoff, rather than used as a cache: platform-specific sidecars must
be built on their target OS.

## Runtime provenance

`scripts/release/prepare-resources.py` freezes only the two first-party Python
tool entry points. It does not bundle optional voices, models, dictionaries, or
unreviewed third-party binaries. Before publishing a release that adds such an
artifact, add its publisher, version, immutable URL, SHA-256, code/artifact
license, installation location, attribution, and update policy to the release
record, following `docs/research/local-dependency-evaluation.md`.
