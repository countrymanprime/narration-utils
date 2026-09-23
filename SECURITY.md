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
- Downloads of models, voices, the reader's offline dictionary or binaries that skip the integrity checks described in
  [first-use dependency provisioning](docs/architecture/first-use-dependency-provisioning.md), and a downloaded dataset or the lookup index
  the app builds from it (the dictionary, [ADR 0097](docs/adr/0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md))
  that can crash the app, exhaust its memory or reach outside its install folder when it is parsed or read.
- The in-app update ([ADR 0072](docs/adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)): once a day the app asks GitHub for the list of releases of this repository (it sends no identifier beyond the program name and version, and it can be switched off in Settings). Reports about that request revealing more than that, about the app trusting the release list beyond what it validates, or about an update being applied without the narrator's click are in scope.
- Path traversal, command injection, or unsafe file handling when opening projects, manuscripts, or archives, including the
  recorded audio a REAPER project names (the teleprompter reads the last seconds of a chapter's recording to find where to resume,
  [ADR 0111](docs/adr/0111-the-resume-point-comes-from-transcribing-the-recorded-tail-and-placing-it-with-the-tracker.md)), or when a
  sidecar reads the audio and writes the per-item cache files an analysis names (for example the recording-coverage manifest,
  which the host builds from the saved REAPER project; the app's only input to a check is a chapter id), or the audio
  an analysis manifest names (for example the per-take divergence manifest).
- Weaknesses in the release pipeline (for example an installer or checksum that does not match the reviewed build, or a release asset without valid build provenance). What the pipeline promises, and what it does not: every release asset has a SHA-256 file (it detects a damaged download, not a tampered one) and a build-provenance attestation you can check with `gh attestation verify` ([Build provenance](docs/operations/ci-and-releases.md#build-provenance)); the releases are **unsigned** by decision, so Windows SmartScreen warns and that warning alone is not a vulnerability; and the owner-only settings that back the pipeline (rulesets, the `production` environment, immutable releases, action pinning) are listed in [Tracking work on GitHub](docs/operations/github-workflow.md#repository-settings-that-only-the-owner-can-change).

- The arguments and session files the app hands its local sidecars, for example a value from the interface becoming a
  sidecar option, or the teleprompter's stop, control and credits-text files in the session folder
  ([ADR 0150](docs/adr/0150-the-teleprompter-reads-credits-as-a-host-rendered-script-file-not-a-chapter.md)).
- The file protocol between the app and REAPER (the session folder under REAPER's resource path, the command files the Lua bridge reads, the paths it opens from a command, the commands that move REAPER's selection, cursor, time selection and transport, which the Review page sends only when the narrator presses Go to, Loop or Stop, on a finding or on one read of a pickup or duplicate group, and only while REAPER is answering, and the one that adds an approved take marker, which it sends only for an accepted finding after the narrator confirms), the arguments a DAW or a shortcut starts the app with (`--daw REAPER` from the REAPER launcher, `--daw Audacity` from the installer's "Narration Utils for Audacity" Start Menu entry, `--project-folder`, `--session-dir`), and the local `/media` route that plays a project's audio.

Problems in a third-party dependency belong upstream, but tell us if we ship a version that is affected.

## What the app does on the network

There is no telemetry, no account and no listening port. The only requests the shipped program makes are the once-a-day release check above (off with one setting), the downloads of models, voices, the offline dictionary and an update that you confirm with a click. Looking a word up in the manuscript reader reads that dictionary on your computer: it sends nothing. The interface's fonts ship with the program, so opening it contacts no font host ([#238](https://github.com/countrymanprime/narration-utils/issues/238)). The Teleprompter's Moonshine engine (Windows) comes with a library that has a downloader of its own; the shipped program never uses it and runs Moonshine only from a model installed and hash-checked through Settings > Local assets ([ADR 0107](docs/adr/0107-moonshine-ships-inside-the-windows-teleprompter-sidecar-and-runs-only-from-a-verified-catalog-install.md)), so a request from it to Moonshine's servers is a vulnerability. The [threat model](docs/architecture/threat-model.md) lists every boundary, what protects it in the code and what risk is left with its owner; a report about a risk it already lists is still welcome, but it is a known limit, not a new vulnerability.
