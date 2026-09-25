# 0071. Releases carry build provenance, and promote refuses a file the release workflows did not build

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

A release is an unsigned 400 MB executable built and published by GitHub Actions. Until now the only check on a downloaded zip was its `.sha256`, which sits beside the file it protects, so a swapped asset with a matching checksum would pass, and `promote-release.yml` would have promoted it. The owner approved build attestations (owner decisions D7, D14 and D22 of the implementation plan; the PRD `docs/prds/release-supply-chain-hardening.prd.md`, deleted when the work was done; recover it from git history; the steady state is [CI and releases](../operations/ci-and-releases.md#build-provenance)). The first stable release is Windows-only and unsigned (D7), and the app will later check GitHub releases and replace itself (D14), so the attestations have to be checkable by a program as well as by a person.

## Decision drivers

- The only check on a downloaded zip was its `.sha256`, which sits beside the file it protects, so a swapped asset with a matching checksum would pass and be promoted.
- The first stable release is Windows-only and unsigned (D7).
- The app will later check GitHub releases and replace itself (D14), so the attestations have to be checkable by a program as well as by a person.
- The owner approved build attestations (owner decisions D7, D14 and D22).

## Considered options

1. Attest every release asset with `actions/attest` (SLSA build provenance, level 2), and verify the attestations before promote publishes
2. SLSA level 3, with the build moved into an isolating reusable workflow
3. Keep the status quo: only the `.sha256` beside each asset
4. Immutable releases

## Decision outcome

**Chosen option: attest every release asset with `actions/attest` (SLSA build provenance, level 2), and verify the attestations before promote publishes**, because a `.sha256` beside the file it protects lets a swapped asset with a matching checksum pass and be promoted.

1. **Every release asset is attested with `actions/attest`** (SLSA build provenance, level 2; level 3 needs the build moved into an isolating reusable workflow, which one maintainer and one repository do not justify). The subjects are the archive, its `.sha256`, and the executable inside it (`narration-utils-shell.exe`, and the Linux binary), so a file can be verified after the archive is extracted. Windows attests in the `release` job of `prerelease.yml` before the prune and `gh release create`; macOS and Linux attest in the `attach` job of `_attach-platform.yml` before `gh release upload`. The step is in the same job as the build and fails closed: no attestation, no release. Nothing here signs the executable (D7).
2. **Promote verifies before it publishes.** `assets.mjs verify <dir> --attestations` runs `gh attestation verify <file> --repo <repository> --signer-workflow <repository>/<workflow> --source-ref refs/heads/main --deny-self-hosted-runners` for the archive and the checksum of every platform present. The signer is `prerelease.yml` for Windows and `_attach-platform.yml` for macOS and Linux (the reusable workflow is the signer, not `build-macos.yml`); the ref is `main`. `--repo` alone would accept an attestation from any workflow in the repository, including one on a pull request's branch. `pnpm release:verify-assets` stays offline; only promote passes `--attestations`. Promote does not attest again: the bytes are unchanged and an attestation belongs to a digest.
3. **The flags were checked against real attestations,** not assumed: a throwaway workflow on a scratch branch attested files directly and through a reusable workflow, and `gh attestation verify` accepted the `owner/repo/path` form of `--signer-workflow` for each signer, rejected the top-level workflow as the signer of a reusable-workflow attestation, rejected the wrong `--source-ref`, and could not find an attestation for a modified copy. The certificate's `subjectAlternativeName` is `https://github.com/<repository>/.github/workflows/<signer>@<ref>`. The same throwaway run proved the `subject-path` globs used by the workflows on a Windows runner and with a macOS-shaped output directory.
4. **Cutover.** A release candidate built before this change has no attestations and cannot be promoted, as a candidate with `SHA256SUMS.txt` could not be promoted after ADR 0027. Candidates beyond the newest ten are pruned anyway.

### Consequences

- **Good:** Promote refuses an unattested, modified or off-`main` asset, so "Windows is the gate" now includes "built by this repository's workflow from `main`".
- **Neutral:** The first real release candidate after this lands is the first attestation of a real release; the flags are proven on it and on the first promote (a pending step for the owner, listed in [GitHub workflow](../operations/github-workflow.md)). If a signer path is renamed, the table in `assets.mjs` is the one place to change.
- **Good:** An in-app updater can call the same check (or verify the bundle it downloads) for the zip, the `.sha256` and the extracted executable.
- **Neutral:** Attestations prove which workflow, commit and run built a file; they do not prove the source is benign and do not change how SmartScreen treats an unsigned executable.
- **Neutral:** Immutable releases stay off: they would break the late macOS and Linux attach and the prune, so they wait for a spike (an issue) and the first stable. Changing any of this means a new ADR that supersedes this one.

### Confirmation

Promote runs `assets.mjs verify <dir> --attestations` (`gh attestation verify` with `--signer-workflow`, `--source-ref refs/heads/main` and `--deny-self-hosted-runners`) for the archive and the checksum of every platform present. The attest step is in the same job as the build and fails closed. The flags were checked against real attestations in a throwaway workflow.

## Pros and cons of the options

### SLSA level 3

- Bad, because it needs the build moved into an isolating reusable workflow, which one maintainer and one repository do not justify.

### Keep the status quo: only the `.sha256`

- Bad, because the checksum sits beside the file it protects, so a swapped asset with a matching checksum would pass, and `promote-release.yml` would have promoted it.

### Immutable releases

- Bad, because they would break the late macOS and Linux attach and the prune.
