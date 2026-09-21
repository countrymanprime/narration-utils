# Release Artifact Naming: Drop "shell", Add the Version

**Source:** user request of 2026-09-19 ("remove `shell` from the name of the artifacts in the release, but add the version"). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. **Reconciled 2026-09-21 with owner decision D14 (stack S15):** Phase 2 (the version in the asset file names) is **dropped**; the version lives inside the app instead and the app finds newer releases itself ([In-App Update](in-app-update.prd.md)). Phase 1 (rename the program) stays and is delivered with the version stamping of that PRD's Phase 1. The evidence below is kept as written, including the `dc9d01a` paths; the layout move since then renamed `shell/` to `apps/desktop/`.

## Problem Statement

A narrator downloading a release sees an unversioned file name, and the program inside the download still carries the internal project name `narration-utils-shell` (the Go/Wails "shell"), which means nothing to them. Two files with the same name from different releases are indistinguishable once they sit in a Downloads folder.

## Evidence

- **Release asset names already have no "shell" in them.** `scripts/release/assets.mjs:66-67` builds `narration-utils-<platform>.<ext>` plus `.sha256`: `narration-utils-windows-x64.zip`, `narration-utils-macos-arm64.zip`, `narration-utils-linux-x64.tar.gz`. The version is not in the name. The older RC assets that did contain "shell" (`narration-utils-shell.exe`, `narration-utils-shell-macos-arm64.zip`, `narration-utils-shell-linux-x64.tar.gz`) are recorded as history in `release-readiness-provisioning-and-docs-site.prd.md:35`.
- **"Shell" survives inside the archives.** The Windows zip holds `narration-utils-shell.exe`, the Linux tarball holds an ELF named `narration-utils-shell`, and macOS holds `Narration Utils.app` (named from `apps/desktop/wails.json:3`). The binary name comes from `apps/desktop/wails.json:4` (`"outputfilename": "narration-utils-shell"`); CI runs `wails build -s` with no `-o` (`.github/actions/build-native/action.yml:49`). `apps/desktop/package.json:7` separately hardcodes `wails build -o narration-utils-shell.exe` for local builds, and forces `.exe` on every OS.
- **Where names are set and consumed.**
  - Name construction and packaging: `scripts/release/assets.mjs:14` (`SHELL_BINARY`), `:31,33,53,55` (binary lookup), `:66-77` (`assetName`, `checksumName`, `packageAsset`), `:88-105` (`verifyAssets`, which takes no version).
  - Upload: `prerelease.yml:96-97` (`gh release create ... release-assets/*`), `_attach-platform.yml:173-174` (`gh release upload`), `promote-release.yml:46-63` (downloads, verifies, re-creates the stable release with the same files; nothing renames).
  - Tests: `scripts/release/assets.test.mjs:38-90` stage and assert `narration-utils-shell[.exe]` and `.../Contents/MacOS/narration-utils-shell`.
- **The version is available at every packaging point.** `prerelease.yml:37-53` outputs the bare semver (no `-rc`) and passes it to the build action (`:76-79`); `_attach-platform.yml:134-144` derives it from the tag (`${TAG#v}` minus `-rc`); `build-native/action.yml:21-28` stamps it into `package.json`, `apps/desktop/package.json` and `wails.json` `info.productVersion` before building (`sync-version.mjs:51-57`). The PR build has no version input and uses the checked-in `0.1.0`.
- **One consumer of the exe name would break.** `integrations/reaper/NarrationUtils_Launcher.lua:60-62` builds `shell_name` (`narration-utils-shell[.exe]`) for its bundle-root fallback and for the checkout path `apps/desktop/build/bin/<name>`. The path recorded in `narration-utils-app-path.txt` (`:37`, written from `os.Executable()` at `apps/desktop/app.go:251-269`) is name-independent. `integrations/reaper` has no automated tests.
- **Not tied to the name:** single-instance GUID (`apps/desktop/main.go:38`), app data folder `narration-utils/` (`apps/desktop/app.go:102-161`), and installer registry keys (no installer exists; `apps/desktop/build/windows/` holds only `icon.ico`). The Windows toast identity is the executable base name (open item N4 in `story-bible-and-import-ux-briefs.prd.md:85`), so a rename changes it cosmetically.
- **Docs that state the current names:** `docs/operations/ci-and-releases.md:42,51,56-58`; `docs/adr/0027-windows-gates-and-creates-the-release.md:16` ("One asset per platform"); the README does not name assets.

## Proposed Solution

1. **Rename the program.** Build it as `narration-utils` (`narration-utils.exe` on Windows) instead of `narration-utils-shell`, and update the places that spell the old name. (Phase 1, delivered by stack S15.)
2. ~~**Put the version in the asset name.**~~ **Dropped (D14).** Asset names stay `narration-utils-<platform>.<ext>` with a `.sha256` beside each. The version is stamped into the program and shown by the app, and the app checks the GitHub releases for a newer one ([In-App Update](in-app-update.prd.md)).

## Key Hypothesis

We believe a program named for the product stops the internal name leaking to narrators, and that the version belongs inside the app (where it can be shown and compared) rather than in a file name (D14). We'll know we're right when no user-visible file is named `*-shell*`, `promote-release` still verifies the unchanged asset names, and the REAPER launcher finds the renamed program.

## What We're NOT Building

- A version in the asset file names (dropped by D14, see Decisions Log).
- A versioned executable name inside the archive; the launcher and user shortcuts would break on every upgrade. The version is stamped into the exe's file properties (`wails.json` `info.productVersion`) and, by the In-App Update PRD, into the program itself.
- Renaming the nx project or the `apps/desktop/` directory (`apps/desktop/package.json:2`); it is not user-visible and would churn `pnpm-lock.yaml` and nx caches.
- An NSIS installer or its naming (specified in `release-readiness-provisioning-and-docs-site.prd.md`, Phase 14).
- Changing the macOS bundle name `Narration Utils.app`.
- Renaming past releases' assets.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| No "shell" in a user-visible name | 0 files in the Windows zip, the Linux tarball or the macOS bundle | Unpack each asset; `assets.test.mjs` |
| Program name inside the archives | `narration-utils[.exe]` on Windows and Linux | Unpack each asset |
| Promotion still works | `promote-release` verifies and re-publishes the same (unchanged) asset names | `assets.mjs verify` tests; a dry run of the workflow on an RC |
| REAPER launcher still finds the app | The bundle and checkout fallbacks find `narration-utils[.exe]`; the app-path file is name-independent | Lua harness tests (`launcher_test.lua`); a real REAPER launch is an owner step |
| Packaging tests | Updated `assets.test.mjs` covers the new names | `pnpm check` |

## Open Questions

- [x] **A1. Which "artifacts" did you mean?** The release assets already have no "shell", so either the program inside the zip is what you saw, or you want the asset pattern changed. Options: (a) rename the program and add the version to the asset name (this PRD); (b) only add the version. **Answer (D14): rename the program (Phase 1); the version goes inside the app, not in the asset names.**
- [x] **A2. Name of the program.** Options: `narration-utils` (recommended, matches the assets and the docs), `Narration Utils` (matches the macOS bundle; a space in the exe name complicates the Lua launcher and shell quoting). **Answer: `narration-utils`.**
- [x] **A3. Version position and form.** **Moot (D14): asset names stay unversioned.** The RC and stable assets are byte-identical and named the same, so promotion still changes nothing; the app reports the bare semver.
- [x] **A4. Is the ADR 0027 asset line a decision?** **Moot (D14): the "one asset per platform" line stays untouched**; no naming-rule ADR is needed. The program rename is recorded in ADR 0073 (written by Phase 1) with the version stamping.
- [x] **A5. Local builds.** `apps/desktop/package.json:7` forces `.exe`. **Answer: drop `-o` and follow `wails.json`, so local and CI names agree** (the local build goes through `scripts/release/wails-build.mjs`, which also stamps the version).

## Users & Context

**Primary User**: an independent narrator installing or upgrading the app, and the maintainer publishing releases.
**Current behavior**: downloads `narration-utils-windows-x64.zip`, unzips `narration-utils-shell.exe`.
**Success state**: the program is called `narration-utils`, and the app itself says which version it is ([In-App Update](in-app-update.prd.md)).
**Job to Be Done**: When I download a release, I want the program to carry the product name, so nothing internal leaks into what I see.

## Solution Detail

| Priority | Capability |
| --- | --- |
| Must | Program built as `narration-utils[.exe]` (`wails.json`, `assets.mjs` `SHELL_BINARY`, the `apps/desktop/package.json` build script) |
| Must | REAPER launcher fallback and checkout paths use the new name, verified in REAPER |
| Must | `assets.test.mjs` and `ci-and-releases.md` updated |
| Should | ADR recording the rename with the version stamping (ADR 0073) |
| Won't | Versioned exe, versioned asset names (D14), nx project rename, installer naming |

**User flow**: publish the RC, then macOS and Linux attach, then promote. Each asset is `narration-utils-<platform>.<ext>` throughout, and the program inside is `narration-utils`.

## Technical Approach

**Feasibility**: HIGH; the version is already available at both packaging entry points.

**Architecture notes**
- ~~Read the version inside `assets.mjs` ...~~ Dropped with Phase 2: the asset functions take no version.
- The program's version is stamped by the In-App Update PRD's Phase 1 (`-ldflags`, one build script for CI and local builds). The Windows build (`prerelease.yml`) and the macOS/Linux attach (`_attach-platform.yml`) already derive the same bare version (the `version` job output versus the tag).
- Changing `outputfilename` moves the Windows toast identity from `narration-utils-shell.exe` to `narration-utils.exe`; check it on a built copy (open item N4).

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Launcher cannot find the renamed program | Medium | Change `NarrationUtils_Launcher.lua:60` in the same PR; manual REAPER check of both the bundle fallback and a checkout run; the app-path file path is unaffected |
| Old local build output confuses the launcher | Low | Say in the PR that `apps/desktop/build/bin` should be cleaned |
| Users' shortcuts point at the old exe name | Low | Only affects installs of pre-release builds; note it in the release notes |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Rename the program | `wails.json`, `assets.mjs` constant, `apps/desktop/package.json` build script, Lua launcher name with harness tests, tests, docs; delivered together with the version stamping of [In-App Update](in-app-update.prd.md) Phase 1 | pending (stack S15) | - | - | - |
| 2 | Version in asset names | **Dropped by D14.** Asset names stay unversioned; the version lives in the app | dropped | - | - | - |

**Phase 1 - Rename the program.** Goal: no user-visible file is named `*-shell*`. Scope: the spellings above plus `assets.test.mjs` and `docs/operations/ci-and-releases.md:42`. Success signal: `pnpm check`; the Windows zip holds `narration-utils.exe`; a manual REAPER launch works through both launcher paths.

**Phase 2 - Version in asset names.** Dropped (D14). Nothing is built; the text is kept so the reason is on record.

**Parallelism Notes**: only Phase 1 remains.

**Parallel-session compatibility**

| Phase | Files touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/wails.json`, `apps/desktop/package.json`, `scripts/release/assets.mjs` and test, `integrations/reaper/NarrationUtils_Launcher.lua`, `docs/operations/ci-and-releases.md` | The REAPER automation and project-workspace PRDs edit the launcher; `release-readiness` phases touch the same workflows and docs |
| 2 | (dropped) | - |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Windows gates and creates the release; one asset per platform (prior, ADR 0027) | Keep | - | Standing decision |
| Program name | `narration-utils` (decided) | `Narration Utils` | Matches assets; no space |
| Version placement (D14, 2026-09-21) | **Inside the app** (stamped into the binary, shown in Settings, used to find newer releases); Phase 2 dropped | Asset name; versioned exe | The owner's intent; launcher and shortcuts stay stable |
| Asset names (D14) | Unchanged: `narration-utils-<platform>.<ext>` + `.sha256`; ADR 0027's "one asset per platform" line is untouched | `narration-utils-<version>-<platform>.<ext>` | Follows from the version living in the app |
| RC versus stable names | Identical | `-rc` suffix | Promotion reuses files unchanged |
| REAPER launcher (D14) | Name logic updated with Lua harness tests; the app-path file stays name-independent | Rely on the app-path file alone | The bundle and checkout fallbacks look for the name |
| Local builds (A5) | Drop `-o`; `scripts/release/wails-build.mjs` builds and stamps | Keep the `.exe`-forcing script | One name everywhere |

## Research Summary

Everything above was read from the workflows, `scripts/release/`, `apps/desktop/wails.json`, `apps/desktop/package.json` and the launcher on this branch. Not verified: the exact toast identity after the rename, and whether the macOS/Linux attach jobs can ever produce a different version than the Windows job for the same tag.

---

*Generated: 2026-09-19*
*Status: IN DELIVERY (2026-09-21): Phase 1 in stack S15, Phase 2 dropped by D14*
