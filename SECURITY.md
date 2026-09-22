# Security policy

## Supported versions

Narration Utils is pre-1.0. Only the latest release (including the latest pre-release candidate) receives fixes.

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository, or
<https://github.com/countrymanprime/narration-utils/security/advisories/new>. Do not open a public issue for a
vulnerability.

Include what you found, the version, and steps to reproduce. There is one maintainer, so expect an acknowledgement
within about a week and a fix or a plan as soon as practical. Reports are credited unless you ask otherwise.

## What is in scope

Narration Utils runs locally and processes your manuscripts and audio on your machine. Reports about these are
especially welcome:

- Anything that sends manuscript, audio, or project content off the machine without an explicit action.
- Downloads of models or binaries that skip the integrity checks described in
  [first-use dependency provisioning](docs/architecture/first-use-dependency-provisioning.md).
- The in-app update ([ADR 0072](docs/adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)): once a day the app asks GitHub for the list of releases of this repository (it sends no identifier beyond the program name and version, and it can be switched off in Settings). Reports about that request revealing more than that, about the app trusting the release list beyond what it validates, or about an update being applied without the narrator's click are in scope.
- Path traversal, command injection, or unsafe file handling when opening projects, manuscripts, or archives.
- Weaknesses in the release pipeline (for example an installer or checksum that does not match the reviewed build, or a release asset without valid build provenance). What the pipeline promises, and what it does not: every release asset has a SHA-256 file (it detects a damaged download, not a tampered one) and a build-provenance attestation you can check with `gh attestation verify` ([Build provenance](docs/operations/ci-and-releases.md#build-provenance)); the releases are **unsigned** by decision, so Windows SmartScreen warns and that warning alone is not a vulnerability; and the owner-only settings that back the pipeline (rulesets, the `production` environment, immutable releases, action pinning) are listed in [Tracking work on GitHub](docs/operations/github-workflow.md#repository-settings-that-only-the-owner-can-change).

Problems in a third-party dependency belong upstream, but tell us if we ship a version that is affected.
