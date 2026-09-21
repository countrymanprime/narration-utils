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
- Path traversal, command injection, or unsafe file handling when opening projects, manuscripts, or archives.
- Weaknesses in the release pipeline (for example an installer or checksum that does not match the reviewed build, or a release asset without valid build provenance; see [CI and releases](docs/operations/ci-and-releases.md#build-provenance)).

Problems in a third-party dependency belong upstream, but tell us if we ship a version that is affected.
