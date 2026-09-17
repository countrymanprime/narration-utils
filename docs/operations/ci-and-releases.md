# CI and releases

## Local setup

Run `pnpm run bootstrap` once after cloning. It installs the root release
tooling and Husky hooks in addition to the existing application dependencies.
The hooks enforce Conventional Commit messages and check staged TypeScript,
Python, Go, and Lua files. Use `pnpm run check` for the full quality suite.

## Repository settings to configure once

GitHub Actions cannot configure these repository settings from a workflow. Once
the optimized workflow has completed successfully on a pull request, create a
`main` ruleset that requires pull requests, squash merges, `CI / Conventional
Commit title`, `CI / Linux quality`, `CI / Format and lint`, and all package
jobs. Conditionally skipped package jobs are successful for documentation-only
pull requests. Disable force pushes. Draft pull requests intentionally skip
these jobs; marking one ready for review starts a fresh run. `CODEOWNERS`
requests `@countrymanprime` for review but is intentionally not a required
review while the repository has a solo maintainer.

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

The workflow validates Conventional Commit metadata, classifies changed files,
then runs Linux quality and Windows format/lint in parallel. The four-platform
bootstrap and installer matrices run for bootstrap or runtime/package changes;
they also run for scheduled and manually dispatched validation. Documentation
and explicitly non-runtime metadata changes skip native packages, while unknown
paths fail safe and retain package coverage. pnpm's content-addressable store,
uv's package cache, and Go's module/build caches are restored by the workflows;
they never cache `node_modules`, `.venv`, or release artifacts. `setup-node`,
`setup-python`, and `setup-go` provision the exact pinned Node, Python, and Go versions. The native
matrix installs Wails v2.16.0, Staticcheck v0.8.1, and the standalone StyLua
v2.1.0 binary declared in `scripts/toolchain.json`; it does not use Cargo.
Installer
artifacts are retained for review and handoff, rather than used as a cache:
platform-specific sidecars must be built on their target OS. After a green
optimized run, delete the obsolete `narration-utils-bootstrap-*` caches from
GitHub's Actions cache inventory.

## Runtime provenance

`scripts/release/prepare-resources.py` freezes only the two first-party Python
tool entry points. It does not bundle optional voices, models, dictionaries, or
unreviewed third-party binaries. Before publishing a release that adds such an
artifact, add its publisher, version, immutable URL, SHA-256, code/artifact
license, installation location, attribution, and update policy to the release
record, following `docs/research/local-dependency-evaluation.md`.
