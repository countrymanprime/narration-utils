# In-App Update: the App Knows Its Version and Replaces Itself from GitHub Releases

**Source:** owner intent of 2026-09-21 (implementation plan decision D14): "we should include the version internal to the packaged app. something it can reference internally and look at the releases on github for new versions to download and replace itself with". It replaces Phase 2 of [Release Artifact Naming](release-artifact-naming.prd.md) (version in the asset file names), which D14 drops. Citations are `file:line` on branch `docs/release-supply-chain-hardening-p6-checklist-and-steady-state` at 52cba7f4. Nothing here is built yet.

## Problem Statement

A narrator gets a new build by finding the GitHub release page, downloading a 400 MB zip, unzipping it over the old program and starting it again. The app cannot say which version it is, so a narrator cannot tell whether a fix they read about is in the copy they run, and the app cannot tell them a newer one exists. Every release since `v0.2.0-rc` is a pre-release, so even a narrator who watches the repository sees only release candidates and has no reason to know that one of them is the one to use.

## Evidence

- **The app has no idea of its own version.** `Bootstrap` returns `apiVersion` (the host binding contract, `apps/desktop/app.go:35`, `:626`) and no application version. The only place a version reaches the executable is the Windows file properties, `apps/desktop/wails.json` `info.productVersion`, which `scripts/release/sync-version.mjs:51-57` keeps equal to the root `package.json`. Nothing in Go reads it. There is no `-ldflags` in the build (`.github/actions/build-native/action.yml:49-50` runs `wails build -s` and `apps/desktop/package.json:7` runs `wails build -o narration-utils-shell.exe`).
- **The version is stamped at exactly two points, before the build.** `prerelease.yml` computes the bare semver from Nx Release and passes it to the build action (`build-native/action.yml:21-28`, `npm pkg set version=... && node scripts/release/sync-version.mjs`); `_attach-platform.yml` derives it from the tag (`${TAG#v}` minus `-rc`). A pull-request build has no version input and uses the checked-in `0.1.0`. RC and stable are the same bare semver and the same bytes: `promote-release.yml` re-publishes the RC files unchanged.
- **What a release holds.** Per platform one asset, `narration-utils-<platform>.<ext>`, with a `.sha256` beside it (`scripts/release/assets.mjs:66-77`); no version in the name and, by decision D14, none will be added. The Windows zip holds one file, the self-contained `narration-utils-shell.exe` (about 421 MB unpacked): the Go host, the frontend, and the Python sidecars as embedded resources (`apps/desktop/main.go:16-24`) that the app extracts into a per-user cache keyed by their content (`app.go:229-294`, `resourceKey` at `:323`). So a Windows update is the replacement of one file; nothing else in the install folder is versioned.
- **Every asset, and the executable inside the Windows zip, carries build provenance** ([ADR 0071](../adr/0071-releases-carry-build-provenance-and-promote-refuses-a-file-the-release-workflows-did-not-build.md), [CI and releases](../operations/ci-and-releases.md#build-provenance)); the ADR names the in-app updater as a consumer: "an in-app updater can call the same check (or verify the bundle it downloads)". The first stable release is Windows-only and unsigned (D7), so Authenticode is not available to check.
- **The app already has the machinery for a download the narrator chooses.** `assets.Install` (`apps/desktop/internal/assets/store.go:75-107`) downloads into an adjacent `.installing` directory, verifies size and SHA-256, and renames it into place; it reports no byte progress (`snapshotTts` sends 0 until the job ends, `app.go:830-843`) and has no size cap, disk check or redirect policy. Install jobs are `{id, phase, message, percent, error}` objects polled through `...InstallState` and cancelled through `...InstallCancel` (`app.go:779-899`), and [ADR 0015](../adr/0015-real-progress-only.md) forbids a faked bar.
- **The busy rule exists.** `canAttachLocked` (`app.go:526-565`) refuses to displace a manuscript import draft, a Story Bible build, a voice or model download, a transcript run or a teleprompter session; it is what the REAPER second launch and the project picker use.
- **Restarting is not free.** The single-instance lock (`main.go:38`, a Wails `SingleInstanceLock`) makes a second copy started while the first is alive forward its arguments and exit, so a relaunch must wait for the old process to go. Sidecars run in a kill-on-close Job Object owned by the supervisor (`apps/desktop/internal/process/job_windows.go`); a process the host starts is not in it. The REAPER launcher reads the app path from `narration-utils-app-path.txt`, which the host rewrites on every start from `os.Executable()` (`app.go:244`, `:304-318`), so a replacement at the same path and name needs no launcher change.
- **The docs say what may happen at startup.** [First-use dependency provisioning](../architecture/first-use-dependency-provisioning.md) (acceptance criteria) requires that first launch performs no optional asset download and that updates of models are opt-in; it says nothing about the app's own update. `SECURITY.md` lists downloads that skip integrity checks and pipeline weaknesses as in scope, and "anything that sends content off the machine without an explicit action".
- **The release list is small and public.** Releases are RC pre-releases (`v0.2.0-rc` ...) and, after the first promote, stable tags (`v0.2.7`); the newest ten RCs are kept (`prerelease.yml`, the prune step). The GitHub API lists them unauthenticated at 60 requests per hour per address and supports conditional requests.

## Proposed Solution

1. **The app knows its version.** One source (the root `package.json`, synchronized by `sync-version.mjs`) is stamped into a Go `version` variable with `-ldflags` by CI and by a local build script, and is also the Windows file version. `Bootstrap` returns it and Settings shows it. The version is bare semver, the same for a release candidate and its promotion; a development build reports `0.0.0-dev`. (Together with renaming the program to `narration-utils`, this is [Release Artifact Naming](release-artifact-naming.prd.md) Phase 1.)
2. **The app looks for a newer release, and never installs without a click.** A Go-side check reads the GitHub Releases API of this repository (owner and name compiled in), picks the newest release for the chosen channel whose bare version is higher than its own and that carries the platform asset and its checksum, and reports it. It runs at most once a day on startup, silently, unless the narrator turned it off, and on **Check now**. The release list is a trust boundary: it is decoded and validated in Go before anything uses it.
3. **One explicit click downloads, verifies and replaces (Windows).** **Download and install** shows what will happen, then a progress dialog with real byte progress: download the zip to the per-user cache, check its SHA-256 against the release's `.sha256`, extract the one executable, run it once to prove it is the version the release names, then, if nothing is busy, swap it in beside the running one, relaunch with the same arguments and keep the old file until the new build has started. macOS and Linux (preview assets) say an update exists and link to the release.
4. **A failed update never strands the narrator.** A failure before the swap leaves the running app untouched; a failure after it restores the old file; a new build that does not start restores itself on the next launch.

## Key Hypothesis

We believe a version the app can show and a one-click, verified, restartable update will get narrators onto fixed builds without their finding a release page, and without the app ever changing anything they did not choose. We'll know we're right when a Windows narrator on version N sees "Version N+1 is available" at most a day after it is released, installs it with one confirmed click, and is back in the same project with the same REAPER launcher on version N+1; and when no release, download or replacement ever happens without that click.

## What We're NOT Building

- **Silent or background installs.** The check is metadata only. Nothing downloads, and nothing is replaced, without an explicit action (the first-use provisioning rule, applied to the app itself).
- **A version in the asset file names** (D14 dropped Release Artifact Naming Phase 2). Asset names stay `narration-utils-<platform>.<ext>`; ADR 0027's "one asset per platform" line is untouched.
- **Code signing or Authenticode checks** (D7): no workflow signs, and the app does not pretend to check a signature.
- **A delta or partial update.** The unit is the whole executable; a delta would need a format, a signer and a server.
- **A separate update server, a static manifest or telemetry.** The source is the repository's GitHub releases; the request carries no identifier beyond the standard `User-Agent`; nothing is sent about the narrator, the project or the machine.
- **Self-replacement on macOS and Linux** (preview assets; a `.app` bundle and a bare ELF have other rules). They are notified only.
- **An installer-managed update** (the NSIS installer is release-readiness Phase 14, later). A per-machine install that the user cannot write to falls back to "download and open the folder".
- **Downgrade, or a channel switch that moves backwards.** An equal or lower version is never installed.
- **Attestation verification inside the app** in the first delivery (see Open Question U4 and Phase 6). Integrity is TLS plus the release's SHA-256 plus the version and name rules; the attestation is documented as the check a person can run.
- **The interaction-feedback stack's notification centre.** The notice uses the existing Toast and the Settings surface; the notification path arrives later.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| The app reports its own version | Bootstrap, Settings and the Windows file properties agree, and equal the release tag's bare semver | Unit test on the stamped variable, contract test, `Get-Item ... VersionInfo` on a built exe |
| Version comparison is total and safe | 0 panics and 0 wrong answers over generated and hostile tags, including `v0.2.7-rc` against `0.2.7` | Property and fuzz tests (ADR 0044 style) |
| The release list is hostile-input safe | A manifest with wrong types, oversized fields, unknown hosts, duplicate or missing assets is refused with a named reason, never trusted | Table tests and a Go fuzz target on the decoder |
| Nothing is installed without a click | 0 downloads and 0 replacements from a check | Test with a fake release server that fails any download outside an install job |
| The download is verified | A hash mismatch, a wrong size, a zip with a path outside the expected name and an older or equal version all end with nothing installed | Unit tests plus the end-to-end apply test |
| End-to-end apply works | On a copy of a built app in a temp folder: check, download from a fake server, verify, swap, relaunch, the new version reports itself, the old file is removed after the start | `go test` with `httptest`, and a Windows rehearsal on a real built copy (reported if the build cannot be produced locally) |
| A failed update rolls back | A crash-on-start replacement is restored automatically on the next launch | Test with a staged executable that exits non-zero |
| The REAPER launcher still finds the app | The renamed program is found in a bundle and in a checkout, and the app-path file is name-independent | Lua harness tests (`integrations/reaper/tests/launcher_test.lua`) |
| The startup check never blocks | The window is usable and the app works offline with the check failing | Test with an unreachable server; startup time unchanged |
| Coverage | The new Go package meets the ratchet floor for a new logic directory (D18) | `scripts/ci/coverage-gate.mjs` |

## Open Questions

All are answered by the owner's decisions and the implementation plan's rule D22 (adopt the recommendation). Those that need the owner's review are in [ADR 0072](../adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md) (Proposed).

- [x] **U1. Where does the app look?** Options: (a) the GitHub Releases API of this repository, unauthenticated; (b) a static `latest.json` published with each release; (c) a separate update service. Answer: (a). It needs no new publishing step, the owner named "the releases on github", and the release is the one place the assets already are. The repository owner and name are compiled in; the JSON is validated in Go; the URL of a download is built from the compiled-in repository, the tag and the known asset name, never taken from the JSON.
- [x] **U2. Which releases count (the channel)?** Options: (a) stable only; (b) release candidates and stable. Answer: default (b) named `candidates`, with the choice `stable` in Settings (`Updates.channel`). Every current release is an RC pre-release, so a stable-only default would never find one. A promoted release has the same bare version as its RC, so a narrator on the RC is not offered its promotion.
- [x] **U3. When does it check?** Answer: once a day at most, on startup, after the window is up, in the background, silent on any failure, unless the narrator turned it off (`Updates.check_on_startup`, default on); and on **Check now**. The last result and the `ETag` are cached in the per-user cache so a check costs nothing against the rate limit when nothing changed. Never blocks and never runs while offline use matters more than the answer.
- [x] **U4. How is the download trusted?** Options: (a) SHA-256 from the release plus version and name rules; (b) also verify the build attestation of the zip in Go (`sigstore-go`, Apache-2.0, AGPL-compatible) against the expected signer workflow of ADR 0071. Answer: (a) now, (b) as Phase 6, deferred. The `.sha256` sits in the same release as the zip, so it detects a damaged or partial download and not a swapped release; the integrity that matters (which workflow built the file) is exactly what (b) adds, and it needs Sigstore's trusted root and a large dependency tree that this delivery weighs and does not adopt (recorded in the ADR, with a follow-up issue). Until then the docs say plainly: the guarantee is TLS to GitHub, a checksum from the same release, a strictly newer version, and names fixed at compile time; a person can run `gh attestation verify`.
- [x] **U5. How does Windows replace a running executable?** Answer: the running `.exe` can be renamed but not overwritten. Stage the new file in the install folder as `narration-utils.exe.new`, rename the running one to `narration-utils.exe.old`, rename the new one into place, start it with the same arguments and let it wait for the old process to exit before it opens its window (the single-instance lock), then quit the old one. Keep `.old` until the new build has finished starting.
- [x] **U6. macOS and Linux?** Answer: notify only, with a link to the release (D7, preview assets).
- [x] **U7. What if the install folder is not writable (Program Files, a locked-down share)?** Answer: detect it before downloading; offer "download and open the folder" instead of an install, and never ask for elevation.
- [x] **U8. What if the new build does not start?** Answer: a pending-update record is written before the swap and cleared when the new build has served its first `Bootstrap`; a launch that finds it still pending (the previous start never got there) restores the `.old` file and relaunches it. A failure before the swap, or a relaunch that fails to spawn, restores immediately in the old process.
- [x] **U9. What is "the version"?** Answer: bare semver `MAJOR.MINOR.PATCH`, from the root `package.json`; the release tag is `v<version>` or `v<version>-rc`, which both name that version. A development build (no `-ldflags`) is `0.0.0-dev`, checks but does not install.
- [x] **U10. One click or two?** Answer: one confirmed click (a dialog that names the version and says the app will restart) authorizes download and install. The install step re-checks the busy rule at the moment of the swap; if something started in the meantime, the verified file stays staged and the dialog says what to finish and offers **Install now**.
- [x] **U11. A "skip this version" or "remind me later"?** Answer: no (YAGNI). The notice shows once per launch when a check finds a version; the narrator can turn the automatic check off.
- [x] **U12. Program name and the launcher.** Answer (D14): `narration-utils` (`.exe` on Windows); the launcher's name logic is updated with harness tests, and the app-path file stays name-independent. See [Release Artifact Naming](release-artifact-naming.prd.md).

## Users & Context

**Primary user:** an independent narrator running Narration Utils on Windows, usually launched from REAPER, who does not follow the repository.
**Secondary user:** the maintainer, who wants a fix to reach narrators without a manual announcement.
**Current behavior:** watches a release page or is told; downloads 400 MB; unzips over the program; restarts REAPER's launcher path if it moved.
**Success state:** the app says "Version 0.2.7 is available"; one click later they are on it, in the same project.
**Job to Be Done:** When a fix ships, I want the app to tell me and to put it on my machine safely, so I keep narrating on a current build without managing files.

## Solution Detail

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Program named `narration-utils[.exe]`; version stamped into the binary (`-ldflags`), returned by `Bootstrap`, shown in Settings | 1 |
| Must | Update check against this repository's releases: hostile-input-safe decode, channel, monotonic compare, cache with `ETag`, daily automatic check with an opt-out, `Check now` | 2 |
| Must | Explicit download with real byte progress, size cap, disk-space precheck, cancel, SHA-256 verification, one-file zip extraction | 3 |
| Must | Windows apply: busy refusal, rename swap, relaunch with the same arguments, single-instance hand-off, rollback | 4 |
| Must | "Update available" notice (Toast) and the Settings surface; the download and install dialog; release-notes link | 2, 3, 5 |
| Must | Threat-model and provisioning docs updated; steady-state docs; both PRDs deleted | 5 |
| Should | Non-writable install folder fallback (download and open the folder) | 4 |
| Should | Smoke run of the staged executable before the swap | 4 |
| Could | Attestation verification of the zip and the extracted executable in Go | 6 (deferred) |
| Won't | Silent install, delta updates, signing, macOS and Linux self-replace, an update server, telemetry | - |

**MVP scope:** Phases 1 to 5 on Windows: version, check, download, verified swap with rollback, and the UI. The attestation check is the first thing after it.

**User flow**
1. The narrator opens the app. A day or more since the last check, the app asks GitHub for the release list in the background. Nothing is shown unless a newer version is found.
2. A Toast says "Version 0.2.7 is available" and Settings > About and updates shows the version, the channel and **Download and install**, **Release notes** and **Check now**.
3. The narrator clicks **Download and install**, reads the confirmation (the app restarts; the project reopens as launched; unsaved import work must be finished) and confirms.
4. A dialog shows "Downloading 0.2.7", bytes and percent, with **Cancel**; then "Checking the download"; then "Installing" (not cancellable, with the notice ADR 0057 requires).
5. The app restarts on 0.2.7 with the same project and launcher. The old file is removed once the new build has started.
6. If something was busy at step 4's end, the dialog says what to finish and offers **Install now**; the download is kept.

## Technical Approach

**Feasibility:** HIGH for the check, download and Windows swap (standard library only: `net/http`, `archive/zip`, `crypto/sha256`, `os`, `os/exec`, and `golang.org/x/sys`, already a dependency). MEDIUM for the attestation check (deferred).

**Architecture notes**

- **Stamping.** `apps/desktop/version.go` declares `var version = "0.0.0-dev"`; `wails build` gets `-ldflags "-X main.version=<root version>"` from one script, `scripts/release/wails-build.mjs`, which both `build-native/action.yml` and `apps/desktop/package.json` run, so CI and a local build agree. The root `package.json` stays the single source; `sync-version.mjs` keeps `wails.json` `productVersion` equal. A test builds the package with the flag and checks the reported version.
- **A new package `apps/desktop/internal/update`,** Go only, no Wails imports, so it is testable without a window: `version.go` (parse and compare), `manifest.go` (decode and validate the release list), `check.go` (the HTTP call with `ETag` and the cache file), `stage.go` (download through `assets`, verify, extract), `apply_windows.go` and `apply_other.go` (swap, relaunch, rollback). The host glue is `apps/desktop/update.go` (jobs and the busy rule, on `h.services()` where it reads services) and `apps/desktop/bindings_update.go`.
- **The release list is the fifth trust boundary** (after Ready and Bootstrap, binding results, live events and persisted files, [wire contracts](../architecture/wire-contracts.md)), and it is validated Go-side: a response body capped at 1 MiB; a strict decode into fixed structs; a tag accepted only as `v<MAJOR>.<MINOR>.<PATCH>` or the same with `-rc` (each part at most six digits); a release accepted only if it is not a draft, its channel matches, and it has exactly one asset with the platform's compiled-in name and exactly one `.sha256` of that name, each with a plausible size; the download URL is built as `https://github.com/<repository>/releases/download/<tag>/<name>` from compiled-in parts, redirects are followed only to `https` hosts under `github.com` and `githubusercontent.com`, and the asset's reported `digest`, when present, must agree with the checksum file. Anything else drops that release with a logged reason (`update_manifest_invalid`, never the values) and the check falls back to "no update found".
- **The UI's boundary.** Every new binding result and event gets a Zod schema behind `parseWire` ([ADR 0069](../adr/0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)) and a golden payload written by a Go test and validated by the UI's contract tests; the mock passes the same schemas.
- **Bindings** (all on `h.services()` where they read a service, a row in `stressReaders` for each, `hostAPIVersion` bumped at all three sites and `Host.{js,d.ts}` regenerated in each phase that changes the contract): `UpdateStatus` (the version, channel, last check and the found update), `UpdateCheck`, `UpdateDownload` (starts the job), `UpdateJobState`, `UpdateJobCancel`, `UpdateInstall`.
- **The job contract** copies the install jobs: `{id, phase, message, percent, bytesDone, bytesTotal, error}` polled by the UI; phases `downloading`, `verifying`, `ready`, `installing`, `error`, `cancelled`. Real bytes from the response body, never an estimate ([ADR 0015](../adr/0015-real-progress-only.md)). `assets.Install` gains an options form (progress callback, size cap, HTTP client with a redirect policy) and keeps its current signature for the voice and model callers.
- **The busy rule** is `canAttachLocked` plus "an update job is running": the update never displaces an import draft, a Story Bible build, a download, a comparison or a teleprompter session.
- **Apply (Windows).** Preconditions: idle, a writable install folder (a probe file), enough free disk for the staged file, the staged executable present and running `--version` prints the expected version. Then the rename swap of Open Question U5, the relaunch with `os.Args[1:]` (`--project-folder`, `--session-dir`, `--daw`, and the rest) started detached and outside any Job Object, `--relaunch-after <pid>` making the new process wait for the old one before it starts Wails (so the single-instance lock is free), sidecars stopped and the old process quitting through the normal shutdown. The REAPER launcher path file is rewritten by the new build on start from the same path and name.
- **Rollback.** `update/pending.json` in the per-user cache holds `{from, to, startedAt}` from just before the swap; the new build clears it and deletes `.old` after its first `Bootstrap` call; a start that finds it present with a `.old` file beside the executable restores the old executable and relaunches it. A spawn failure or any error between the two renames restores at once.
- **Settings.** A new `Updates` tool with two fields, `check_on_startup` (bool, default `true`) and `channel` (choice `candidates` or `stable`, default `candidates`), global scope only; defaults in `config/defaults.json` and `builtinDefaults`; shown in a Settings category "About and updates" with the version and the update panel above the fields.
- **Docs that must change with the code:** the provisioning doc and `SECURITY.md` (the startup check and the new download), `docs/operations/ci-and-releases.md` (version stamping, the new exe name), the threat model, `docs/architecture/in-app-update.md` and a user guide section (steady state).

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A tampered or swapped release is installed | Low, high impact | HTTPS to GitHub only, names and URL fixed at compile time, strictly newer version, SHA-256 from the release, a run of the staged file that must report the named version; attestation verification as Phase 6; the docs state the limit plainly (Open Question U4, ADR 0072) |
| The update leaves no working app | Low, high impact | The old file is renamed, not deleted, until the new build has started; automatic restore; failures before the swap change nothing; a rehearsal on a copy of a real build |
| Antivirus or SmartScreen blocks the relaunch of an unsigned exe | Medium | Documented (D7); the failure to spawn restores the old file; the release notes say "unsigned" |
| Rate limit (60 an hour) or a GitHub outage | Medium | At most one automatic check a day, `ETag`, silent failure, `Check now` reports the reason |
| The check is felt as tracking | Low | Metadata only, opt-out in Settings, no identifiers, documented in `SECURITY.md` and the provisioning doc |
| The rename orphans the REAPER launcher | Low | The app-path file is written from `os.Executable()` and is name-independent; harness tests for the launcher name logic; the exe path and name are unchanged by an update |
| A per-machine install cannot be written | Medium | Detected up front; fall back to "download and open the folder" |
| Interrupted power or a killed process between the two renames | Very low | The pending record and the `.old` file make the next launch restore; documented manual recovery (rename `.old` back) |
| Two apps started while updating (REAPER launches again) | Low | The relaunched process waits for the old one; the single-instance lock stays the only hand-off |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | This PRD | Write this PRD with its decisions and ADR 0072 (Proposed); reconcile [release-artifact-naming](release-artifact-naming.prd.md) (Phase 2 dropped) | complete | - | - | ADR 0072 |
| 1 | Rename and stamp the version | Program `narration-utils`; `-ldflags` stamping; `Bootstrap` version; Settings shows it; launcher name logic with harness tests; `hostAPIVersion` bump | complete | - | 0 | ADR 0073 |
| 2 | The update check | `internal/update` version and manifest, the check with `ETag` cache and the daily startup check, `Updates` settings, `UpdateStatus` and `UpdateCheck`, Zod schemas, mock, the Settings panel and the Toast notice, `hostAPIVersion` bump | complete | - | 1 | ADR 0072 |
| 3 | Download, verify, stage | `assets` progress and cap, disk precheck, the download job with real bytes, hash and name checks, one-file extraction, the download dialog | pending | - | 2 | - |
| 4 | Apply, relaunch, roll back (Windows) | Busy refusal, the rename swap, the relaunch and hand-off, rollback, the non-writable fallback, the end-to-end apply test and a rehearsal on a built copy | pending | - | 3 | - |
| 5 | UI polish, docs, steady state | Notice and dialog polish, visual states, the threat model, provisioning and `SECURITY.md` edits, `ci-and-releases.md`, `docs/architecture/in-app-update.md`, the user guide, ADRs, both PRDs deleted | pending | - | 4 | - |
| 6 | Attestation verification in the app | Verify the zip and the extracted executable against their attestation bundle for the signer workflow of ADR 0071 (sigstore-go), or record why not | deferred | - | 4 | - |

**Phase 1 - Rename and stamp the version.** Goal: the app knows its version and no user-visible file is named `*-shell*`. Scope: `wails.json` `outputfilename`; `scripts/release/assets.mjs` `SHELL_BINARY` (renamed) and `assets.test.mjs`; the workflow globs `narration-utils-shell*` (`prerelease.yml`, `_attach-platform.yml`); `apps/desktop/package.json` build script and `scripts/release/wails-build.mjs`; `version.go` and the Bootstrap field, its contract, schema, mock and golden files; the launcher's name logic and its harness tests; the Settings About text; `ci-and-releases.md` names. Success signal: `pnpm check` and the visual suite; the Windows zip built locally holds `narration-utils.exe`; `--version` prints the root version; the Lua harness passes. Manual REAPER launch of the renamed program is recorded as pending for the owner (the harness pins the name logic).

**Phase 2 - The update check.** Goal: the app can tell, safely, that a newer release exists. Scope: `internal/update` (version, manifest, check, cache), the `Updates` settings, `UpdateStatus` and `UpdateCheck` and their schemas and goldens, the mock, the startup check, the Settings panel with **Check now**, the Toast. Success signal: unit, property and fuzz tests; the startup check makes no request when disabled or within a day; a fake release server drives the UI states in the mock.

**Phase 3 - Download, verify, stage.** Goal: an explicit download that is verified and staged, with real progress. Scope: `assets` options, the disk precheck, `UpdateDownload`, `UpdateJobState`, `UpdateJobCancel`, the dialog. Success signal: tests for hash mismatch, wrong size, oversized body, hostile zip, cancel and disk full; nothing outside the per-user cache is written.

**Phase 4 - Apply, relaunch, roll back.** Goal: the Windows swap works and cannot strand the narrator. Scope: `apply_windows.go`, `UpdateInstall`, the busy and writable checks, the relaunch hand-off, the pending record and rollback, `ADR 0074`. Success signal: the end-to-end test against a temp folder and a fake release server; a rehearsal on a copy of the built app in a temp directory.

**Phase 5 - UI polish, docs, steady state.** Goal: the feature is finished and documented and both PRDs are gone. Scope as in the table. Success signal: `pnpm check`, the visual suite and atlas as needed, doc screenshots refreshed if a Settings image changed.

**Phase 6 - Attestation verification (deferred).** Goal: the zip and the executable are checked against the workflow attestation in the app. Scope: evaluate and, if it is a fair cost, add `sigstore-go` with an embedded trusted root and the signer identity from `PLATFORMS` in `assets.mjs`; otherwise the ADR records why not. Filed as an issue when Phase 5 lands.

**Parallelism Notes:** the phases are a chain: each needs the previous one's contract. Phase 6 can run after Phase 4.

**Parallel-session compatibility**

| Phase | Files touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/{wails.json,package.json,app.go,app_test.go}`, `apps/ui/src/hostApi.ts`, `apps/ui/src/api/*`, `scripts/release/*`, `integrations/reaper/NarrationUtils_Launcher.lua` and its test, `.github/workflows/{prerelease,_attach-platform}.yml`, `.github/actions/build-native/action.yml` | [Project Workspace](project-workspace-and-daw-link.prd.md) Phase 5 edits the same launcher; the release-readiness pipeline phases edit the same workflows; `hostAPIVersion` and the ADR numbers are serialization points |
| 2 | `apps/desktop/internal/update/`, `apps/desktop/{app.go,bindings.go}`, `internal/settings`, `config/defaults.json`, `apps/ui/src/components/settings/*`, the visual catalog | Every PRD that adds a binding or a Settings category; the interaction-feedback stack (Toast) |
| 3 | `apps/desktop/internal/assets/store.go`, `apps/desktop/update.go` | Release-readiness Phase 2 hardens the same `assets` package (disk check, resume); rebase onto it |
| 4 | `apps/desktop/internal/update/apply_*.go`, `apps/desktop/main.go` | Release-readiness Phase 14 (installer) changes how the app is installed; the swap must keep working for the portable zip |
| 5 | `docs/`, `SECURITY.md`, the visual catalog, `docs/prds/` | Any PRD touching `ci-and-releases.md` |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| The version lives inside the app, not in asset file names (D14) | Yes; asset names unchanged | Versioned asset names (the dropped Phase 2) | The owner's intent; a name does not help an app that must find its own newer version |
| Where the version comes from | Root `package.json` via `sync-version.mjs`, stamped by `-ldflags` (and the Windows file version) | A generated Go file; `debug.ReadBuildInfo` | One source that CI and a local build share; `-ldflags` needs no generated tracked file |
| Version form | Bare semver; a development build is `0.0.0-dev` | Include `-rc` in the binary | RC and its promotion are the same bytes (`promote-release.yml`), so they must report the same version |
| Update source | The repository's GitHub Releases API, Go side, unauthenticated | A static manifest; an update server | Nothing new to publish; the CSP stays unchanged; named by the owner |
| Channel | `candidates` (RC and stable) by default, `stable` optional; setting `Updates.channel` | Stable only | All current releases are pre-releases |
| Automatic check | At most once a day on startup, metadata only, silent, opt-out `Updates.check_on_startup` | On every start; never | A useful default that respects the rate limit and offline use |
| No download without a click | Always | Auto-download on a found update | The first-use provisioning rule, applied to the app itself |
| Integrity now | TLS + SHA-256 from the release + strictly newer + names and URL fixed at compile time + a run of the staged exe that must report the named version | Attestation verification now | `sigstore-go` needs a trusted root and a large tree; recorded and deferred (Phase 6, ADR 0072) |
| Signing (D7) | None; documented | Authenticode | Not available; owner's call |
| Apply on Windows | Rename the running exe, place the new one, relaunch, hand off the single-instance lock, keep `.old` until started | Helper updater process; an installer | One file to replace; no second program to sign or ship |
| Rollback | Pending record + `.old`; automatic restore | Manual only | A silent broken update is the worst outcome |
| macOS and Linux | Notify only | Self-replace | Preview assets (D7) |
| Non-writable install folder | Fall back to "download and open the folder"; never elevate | Ask for elevation | Elevation is a system change the app does not make |
| Program name (D14) | `narration-utils`, `.exe` on Windows | `Narration Utils` | Matches the assets; no space |
| REAPER launcher | Name logic updated with harness tests; the app-path file stays name-independent | Rely on the app-path file only | The bundle and checkout fallbacks still look for the name |
| Progress and cancel | Real bytes; cancel during download; install step not cancellable and says so (ADR 0057) | Estimated bar | ADR 0015 |
| Notification surface | Existing Toast and a Settings surface | Wait for the notification centre | It is a later stack |
| Skip or remind-later | Not built | Per-version skip | YAGNI |
| New wire payloads (D16) | Zod schema and golden payload each; the release manifest is the fifth trust boundary, validated Go-side | Trust the API | Standing rule |
| Coverage (D18) | New logic directory `internal/update` at the 80% floor | - | Standing rule |
| Licence (D17) | No new dependency in Phases 1 to 5 | `sigstore-go` (Apache-2.0, compatible) | Weighed and deferred |
| Number of ADRs | 0072 Proposed (trust model, channel, startup check), 0073 (the program name and the stamped version), 0074 (the apply and rollback) | One ADR | Each records a separate decision |

## Research Summary

Read in the repository: `apps/desktop/{main.go,app.go,bindings.go,services.go,wails.json,package.json,project.json}`, `apps/desktop/internal/{assets,settings,process,tts}`, `apps/ui/src/api/{wailsClient.ts,contracts,schemas}`, `apps/ui/src/components/settings/Settings.tsx`, `scripts/release/{assets.mjs,sync-version.mjs}`, `.github/actions/build-native/action.yml`, `.github/workflows/{prerelease,_attach-platform,promote-release}.yml`, `integrations/reaper/NarrationUtils_Launcher.lua` and its harness test, [ADR 0015](../adr/0015-real-progress-only.md), [ADR 0027](../adr/0027-windows-gates-and-creates-the-release.md), [ADR 0030](../adr/0030-the-app-starts-without-a-project-and-picks-one-from-recents.md), [ADR 0041](../adr/0041-host-bindings-read-project-services-through-one-snapshot-accessor.md), [ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md), [ADR 0069](../adr/0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md), [ADR 0071](../adr/0071-releases-carry-build-provenance-and-promote-refuses-a-file-the-release-workflows-did-not-build.md), the provisioning and standalone-launch architecture docs, `SECURITY.md`, and the release-readiness and supply-chain PRD text about assets. Not verified when this was written: the exact response fields of the GitHub Releases API (checked against the live repository in Phase 2 and pinned in a test fixture), whether Wails' build passes `-ldflags` through unchanged on every platform (checked in Phase 1), the behavior of a Windows relaunch under REAPER's process tree (checked in the Phase 4 rehearsal; REAPER's own behavior is a pending owner step), and the size and binary cost of `sigstore-go` (Phase 6).

---

*Generated: 2026-09-21*
*Status: IN DELIVERY - phases 0 to 2 delivered, phases 3 to 5 pending, phase 6 deferred*
