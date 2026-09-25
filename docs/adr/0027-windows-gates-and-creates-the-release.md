# 0027. Windows gates pull requests and creates the release; macOS and Linux are optional, separate builds

- **Status:** Accepted
- **Date:** 2026-09-19
- **Related:** Its asset names are superseded by [ADR-0197](0197-every-release-asset-name-carries-the-bare-version.md).

## Context and problem

Narration Utils is Windows-first, and Windows is where most of the DAWs it integrates with run. Yet every pull request built all three native packages, the prerelease workflow waited for all three before publishing anything, and a macOS or Linux failure could hold up work that only Windows users depend on. The native build also could not start until every lint and test job had finished. Neither `main` ruleset had a required status check, so the old "all package jobs must pass" wording in `docs/operations/ci-and-releases.md` described a gate that did not exist.

## Decision drivers

- Narration Utils is Windows-first, and Windows is where most of the DAWs it integrates with run.
- A macOS or Linux failure should not hold up work that only Windows users depend on.
- The native build should not wait for every lint and test job to finish.

## Considered options

1. Windows gates pull requests and creates the release; macOS and Linux are optional, separate builds
2. Keep the status quo: every pull request builds all three native packages, and the prerelease waits for all three
3. A Windows installer built with `wails build -nsis`
4. A single `SHA256SUMS.txt` for all assets

## Decision outcome

**Chosen option: Windows gates pull requests and creates the release; macOS and Linux are optional, separate builds**, because the app is Windows-first, and a macOS or Linux failure could otherwise hold up work that only Windows users depend on.

- **Windows is the gate.** Pull requests build one native package, on Windows (`CI / Build (Windows)`); a failed Windows build fails CI. The Go quality job also runs on Windows only. The UI bundle is built in its own job (`.github/workflows/_ui-dist.yml`), so the Windows build runs alongside the quality jobs instead of after them.
- **Windows creates the release.** The prerelease workflow (`.github/workflows/prerelease.yml`) builds Windows and, in that same job, creates the GitHub prerelease with the Windows zip.
- **macOS and Linux are optional, separate builds.** `build-macos.yml` and `build-linux.yml` each build one platform from the release tag and attach its asset with `gh release upload --clobber`. The Windows release job starts them with `gh workflow run` after the release exists, so they are their own runs: a failure does not turn the prerelease run red. Each also accepts `workflow_dispatch` and `workflow_call` with a `tag`, so one platform can be re-run for any release. Both delegate to `_attach-platform.yml`.
- **One asset per platform**, named `narration-utils-<platform>.<ext>`, each with a `.sha256` beside it: `windows-x64` is a zip of `narration-utils-shell.exe` (`.zip`), `macos-arm64` is a zip of the app bundle (`.zip`), `linux-x64` is a tarball of the binary (`.tar.gz`). The table, including which platforms are `required`, lives in `scripts/release/assets.mjs`, which also packages and verifies them. There is no Windows installer: the CI runner has no NSIS, so `wails build -nsis` only warned and previous releases already shipped the bare executable, which is now zipped (it is about 400 MB uncompressed) and keeps the name the REAPER launcher looks for.
- **Promotion** (`promote-release.yml`) runs `assets.mjs verify`. It requires the Windows asset and a matching checksum. A macOS or Linux asset that is absent is ignored, so that release is Windows-only; one that is present must be complete and match its checksum.

### Consequences

- **Good:** A macOS or Linux failure can no longer delay or block a pull request, the Windows release, or its promotion, and macOS runner minutes are spent only on merged commits.
- **Bad:** macOS and Linux build problems are first found after merge, and a release may ship without them. Re-run the failed workflow for that platform to add it later, even after promotion.
- **Bad:** Linux Go tests and the Linux native libraries are no longer exercised on pull requests.
- **Neutral:** Checksums are per asset rather than a single `SHA256SUMS.txt`, because the assets are uploaded at different times. A release candidate published before this change carries the old file and cannot be promoted with the new workflow.
- **Neutral:** Promoting while a macOS or Linux upload is in flight can copy a half-uploaded platform; verification rejects that (asset without checksum) rather than shipping it.
- **Neutral:** To change any of this, write a new ADR that supersedes this one (see `docs/adr/README.md`).

### Confirmation

`CI / Build (Windows)` fails CI on a failed Windows build. Promotion (`promote-release.yml`) runs `assets.mjs verify`, which requires the Windows asset and a matching checksum, and requires any macOS or Linux asset that is present to be complete and match its checksum.

## Pros and cons of the options

### Every pull request builds all three native packages

- Bad, because a macOS or Linux failure could hold up work that only Windows users depend on.

### A Windows installer built with `wails build -nsis`

- Bad, because the CI runner has no NSIS, so `wails build -nsis` only warned.

### A single `SHA256SUMS.txt` for all assets

- Bad, because the assets are uploaded at different times.
