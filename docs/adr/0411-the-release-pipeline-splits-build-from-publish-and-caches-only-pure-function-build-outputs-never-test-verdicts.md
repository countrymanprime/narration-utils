# 0411. The release pipeline splits build from publish, and caches only pure-function build outputs, never test verdicts

**Status:** Accepted
**Date:** 2026-09-27
**Supersedes:** none

## Context

The CI Pipeline Speed PRD (`docs/prds/ci-pipeline-speed.prd.md`, deleted by this same change once its phases were
delivered — [ADR 0028](0028-planned-work-is-specified-as-prds-and-deleted-when-built.md); steady state is
[CI and releases](../operations/ci-and-releases.md#ci-performance)) measured a Prerelease run at 13 m 33 s idle, and 25 to 55
minutes when several pull requests competed for the repository's 20 concurrent hosted job slots (public repo, free
plan). The critical path was `quality / ui-visual` (7 m 17 s) then the Windows build (6 m 8 s), in series, because the
release job needed every quality job green before it started (`needs: [quality, ui-dist, version]`). Most of the
Windows time (5 m 29 s of 6 m 8 s) was `prepare-resources.py --clean` re-freezing three Python sidecars with
PyInstaller from scratch on every run, even though the freeze is a pure function of `sidecars/`, `libs/python/`,
`pyproject.toml`, `uv.lock` and the freeze script itself.

Two decisions in the PRD's Decisions Log framed the fix: **D1**, don't split the code into separately published
packages to "build only on change" — the slow jobs are the Playwright suites and the Windows packaging, not a
monorepo build graph, so splitting packages would add release surface and save nothing. **D2**, cache build outputs,
never test verdicts — a green check has to mean the checks ran ([ADR 0023](0023-visual-suite-capture-contract-and-storybook.md)),
so nothing here restores a prior test result; only a build artifact that is provably the same bytes a cold build
would produce is skipped.

Since this PRD's Phase 1 was scoped, the owner answered the PRD's Open Question 1 further than asked: `prerelease.yml`
now runs no quality jobs at all, and the pull request's own `CI` run is the release gate the owner reads before
merging. That removes the original reason the build and publish steps needed splitting (waiting on quality), but the
split still stands on its own merits: it is what lets `windows-build`, which runs third-party build tooling
(PyInstaller, Wails, NSIS, pnpm) against a package.json version and vendored code, hold no write token, while only
`publish`, which never runs that tooling, holds `contents: write` and the attestation permissions.

## Decision

**1. The release job is split into `windows-build` and `publish`.** In `prerelease.yml`:

- `windows-build` (`needs: [ui-dist, version]`) checks out with `persist-credentials: false`, runs
  `.github/actions/build-native`, records the SHA-256 of every file it produced as a job output, and uploads them as
  a short-lived artifact. It holds only the workflow's default `contents: read`.
- `publish` (`needs: [windows-build, version]`) downloads the artifact, refuses any file whose digest does not match
  what `windows-build` recorded, attests the release assets and the executable (`actions/attest`, SLSA Build L2),
  prunes old release candidates, writes the release notes and creates the GitHub prerelease, then dispatches the
  optional macOS and Linux builds. It alone holds `contents: write`, `actions: write` and the three attestation
  permissions.
- `ci.yml`'s `Build (Windows)` job already starts as soon as `ui-dist / build` finishes, beside the quality jobs,
  rather than after them, so a pull request's critical path is not serialized on the Windows build either.

**2. A build output is cached only when it is a pure function of its inputs, and never in place of running a test.**
The one build output cached today is the PyInstaller freeze of the three Python sidecars
(`.github/actions/build-native`, `actions/cache`): the key is the runner OS and architecture, the Python patch
version, and a hash of `sidecars/**`, `libs/python/**`, `pyproject.toml`, `uv.lock` and
`scripts/release/prepare-resources.py`. Only an exact key counts (no fallback keys); a hit makes
`prepare-resources.py --reuse` copy the frozen executables and tables of contents instead of freezing from scratch.

- **Saved only from `main`, after the smoke test and the notices pass.** A pull request restores `main`'s entry and
  never writes one, so a pull request cannot change what a release is built from.
- **The smoke test, the installability check and the third-party notices generation still run on every build, hit or
  miss.** The cache skips re-deriving the frozen bytes; it never skips proving the packaged app starts.
- **A cold freeze is always available on demand:** a manual `Prerelease` run with `cold-freeze` ticked, or
  `reuse-freeze: 'false'` for any caller of `build-native`.
- **The Go toolchain on Windows is deliberately not cached** (D4 of the PRD): `setup-go` extracts Go to `D:` behind a
  junction in the `C:` tool cache, so caching the tool cache would store the junction, not Go. Caching it anyway would
  mean reimplementing `setup-go`'s own extraction, which the PRD judged not worth it unless `scripts/ci/run-timings.mjs`
  showed `setup-toolchain` still costing about a minute on the Windows jobs on its own.

## Consequences

- A release's critical path is no longer quality-then-build in series; it is bounded by whichever of the pull
  request's own `CI` run and the Windows build is slower, and `publish` adds about a minute on top of a cache hit.
- The job that runs untrusted-in-spirit third-party build tooling (PyInstaller, Wails, NSIS) never holds a token that
  can create a release, a tag or an attestation; only `publish`, which runs none of that tooling, does. This is
  independent of, and outlives, the quality-gate question the split was first proposed to solve.
- A stale or wrong cache key would ship old code from a fresh commit; the mitigation is that the key covers every
  input path and the packaged-app smoke test proves the shipped sidecars start on every single build, cache hit or
  not.
- Caching build outputs (not test verdicts) is the pattern for any future PyInstaller-, Wails- or toolchain-adjacent
  cache in this pipeline: key it on a hash of every real input, restore only an exact key, save only from `main`, and
  never let a hit skip a check that proves the artifact actually works.
- Measured effect on the PRD's Success Metrics is recorded in
  [CI and releases](../operations/ci-and-releases.md#measuring-a-run); the PRD itself is deleted once its phases are
  delivered ([ADR 0028](0028-planned-work-is-specified-as-prds-and-deleted-when-built.md)).
