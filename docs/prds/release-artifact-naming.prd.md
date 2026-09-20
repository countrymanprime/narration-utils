# Release Artifact Naming: Drop "shell", Add the Version

**Source:** user request of 2026-09-19 ("remove `shell` from the name of the artifacts in the release, but add the version"). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet.

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

Two independent changes, deliverable in order:

1. **Rename the program.** Build it as `narration-utils` (`narration-utils.exe` on Windows) instead of `narration-utils-shell`, and update the places that spell the old name.
2. **Put the version in the asset name.** `narration-utils-<version>-<platform>.<ext>` (for example `narration-utils-0.2.7-windows-x64.zip`), with the matching `.sha256`. The program inside stays unversioned so the REAPER launcher and users' shortcuts keep working across upgrades.

## Key Hypothesis

We believe a versioned asset name and a program named for the product will make downloads self-describing and stop the internal name leaking to narrators. We'll know we're right when every asset on a release matches `narration-utils-<version>-<platform>.<ext>`, `promote-release` verifies them, and no user-visible file is named `*-shell*`.

## What We're NOT Building

- A versioned executable name inside the archive; the launcher and user shortcuts would break on every upgrade. The version is already stamped into the exe's file properties (`wails.json` `info.productVersion`).
- Renaming the nx project or the `apps/desktop/` directory (`apps/desktop/package.json:2`); it is not user-visible and would churn `pnpm-lock.yaml` and nx caches.
- An NSIS installer or its naming (specified in `release-readiness-provisioning-and-docs-site.prd.md`, Phase 14).
- Changing the macOS bundle name `Narration Utils.app`.
- Renaming past releases' assets.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Asset names carry the version and no "shell" | 100% of assets on the next RC | Inspect the release; `assets.mjs verify` with a version argument |
| Program name inside the archives | `narration-utils[.exe]` on Windows and Linux | Unpack each asset |
| Promotion still works | `promote-release` verifies and re-publishes the same names | A dry run of the workflow on an RC |
| REAPER launcher still finds the app | Launch from REAPER on a built copy (fallback path) and on a checkout | Manual, per `full-verification-gate` (Lua has no tests) |
| Packaging tests | Updated `assets.test.mjs` covers names and version | `pnpm check` |

## Open Questions

- [ ] **A1. Which "artifacts" did you mean?** The release assets already have no "shell", so either the program inside the zip is what you saw, or you want the asset pattern changed. Options: (a) rename the program and add the version to the asset name (this PRD); (b) only add the version. Recommendation: (a).
- [ ] **A2. Name of the program.** Options: `narration-utils` (recommended, matches the assets and the docs), `Narration Utils` (matches the macOS bundle; a space in the exe name complicates the Lua launcher and shell quoting). Recommendation: `narration-utils`.
- [ ] **A3. Version position and form.** Options: `narration-utils-<version>-<platform>` (recommended, sorts by product then version), or `<platform>-<version>`. Whether RC assets say `-rc`: the RC and stable versions are the same bare semver today, and `promote-release` re-publishes the RC files unchanged (`promote-release.yml:46-63`). Options: (a) same names for RC and stable, distinguished by the release (recommended, no rebuild or rename at promotion); (b) `-rc` in the RC name, which forces a rename or rebuild at promotion and changes the checksum text.
- [ ] **A4. Is the ADR 0027 asset line a decision?** ADR 0027 says "one asset per platform". Options: (a) update `ci-and-releases.md` and leave the ADR; (b) a new ADR (next free number, 0037 at dc9d01a) recording the naming rule and superseding that line. Recommendation: (b) only if the ADR text states the pattern; check in Phase 2.
- [ ] **A5. Local builds.** `apps/desktop/package.json:7` forces `.exe`. Recommendation: drop `-o` and follow `wails.json`, so local and CI names agree.

## Users & Context

**Primary User**: an independent narrator installing or upgrading the app, and the maintainer publishing releases.
**Current behavior**: downloads `narration-utils-windows-x64.zip`, unzips `narration-utils-shell.exe`; cannot tell versions apart by file name.
**Success state**: the file says what it is and which version it is.
**Job to Be Done**: When I download a release, I want the file name to tell me the product and version, so I can keep, compare or roll back builds without opening them.

## Solution Detail

| Priority | Capability |
| --- | --- |
| Must | Program built as `narration-utils[.exe]` (`wails.json`, `assets.mjs` `SHELL_BINARY`, the `apps/desktop/package.json` build script) |
| Must | `assetName`, `checksumName` and `verifyAssets` take the version; `packageAsset` and the workflows pass it |
| Must | REAPER launcher fallback and checkout paths use the new name, verified in REAPER |
| Must | `assets.test.mjs` and `ci-and-releases.md` updated |
| Should | ADR recording the naming rule if A4 says so |
| Won't | Versioned exe, nx project rename, installer naming |

**User flow**: publish the RC, then macOS and Linux attach, then promote. Each asset is `narration-utils-<version>-<platform>.<ext>` throughout, and the program inside is `narration-utils`.

## Technical Approach

**Feasibility**: HIGH; the version is already available at both packaging entry points.

**Architecture notes**
- Read the version inside `assets.mjs` from the root `package.json` (`readRootVersion`, `sync-version.mjs:9`), which the build action has already stamped, or take it as an argument. `verifyAssets` (`:88`) must receive the version explicitly because `promote-release.yml:49` runs in a job that has not built anything; pass `${TAG#v}` minus `-rc`, as `promote-release.yml:55-57` already computes.
- Keep the Windows build (`prerelease.yml`) and the macOS/Linux attach (`_attach-platform.yml`) on the same version derivation. They derive it from different places (the `version` job output versus the tag), and an inconsistency would put two versions on one release.
- Changing `outputfilename` moves the Windows toast identity from `narration-utils-shell.exe` to `narration-utils.exe`; check it on a built copy (open item N4).

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Launcher cannot find the renamed program | Medium | Change `NarrationUtils_Launcher.lua:60` in the same PR; manual REAPER check of both the bundle fallback and a checkout run; the app-path file path is unaffected |
| Windows and macOS/Linux assets get different versions | Low | One shared derivation and a `verify` step that asserts all three names share a version |
| Old local build output confuses the launcher | Low | Say in the PR that `apps/desktop/build/bin` should be cleaned |
| Users' shortcuts point at the old exe name | Low | Only affects installs of pre-release builds; note it in the release notes |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Rename the program | `wails.json`, `assets.mjs` constant, `apps/desktop/package.json` build script, Lua launcher name, tests, docs; manual REAPER verification | pending | 2 | - | - |
| 2 | Version in asset names | `assetName`/`checksumName`/`verifyAssets` take the version; workflows pass it; tests; `ci-and-releases.md`; ADR if A4 says so | pending | 1 | - | - |

**Phase 1 - Rename the program.** Goal: no user-visible file is named `*-shell*`. Scope: the spellings above plus `assets.test.mjs` and `docs/operations/ci-and-releases.md:42`. Success signal: `pnpm check`; the Windows zip holds `narration-utils.exe`; a manual REAPER launch works through both launcher paths.

**Phase 2 - Version in asset names.** Goal: names carry the version. Scope: `scripts/release/assets.mjs`, `assets.test.mjs`, `_attach-platform.yml`, `promote-release.yml`, `prerelease.yml`, `ci-and-releases.md:51,56-58`. Success signal: an RC run produces, verifies and promotes three consistently named assets.

**Parallelism Notes**: the phases touch different lines of `assets.mjs` and its test; do them in one PR if simpler, or Phase 1 first.

**Parallel-session compatibility**

| Phase | Files touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/wails.json`, `apps/desktop/package.json`, `scripts/release/assets.mjs` and test, `integrations/reaper/NarrationUtils_Launcher.lua`, `docs/operations/ci-and-releases.md` | The REAPER automation and project-workspace PRDs edit the launcher; `release-readiness` phases touch the same workflows and docs |
| 2 | `scripts/release/assets.mjs` and test, `.github/workflows/{prerelease,_attach-platform,promote-release}.yml`, ADR | `release-readiness-provisioning-and-docs-site.prd.md` (release pipeline phases), ADR numbering |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Windows gates and creates the release; one asset per platform (prior, ADR 0027) | Keep | - | Standing decision |
| Program name | `narration-utils` (proposed) | `Narration Utils` | Matches assets; no space |
| Version placement | Asset name only (proposed) | Versioned exe | Launcher and shortcuts stay stable |
| RC versus stable names | Identical (proposed) | `-rc` suffix | Promotion reuses files unchanged |

## Research Summary

Everything above was read from the workflows, `scripts/release/`, `apps/desktop/wails.json`, `apps/desktop/package.json` and the launcher on this branch. Not verified: the exact toast identity after the rename, and whether the macOS/Linux attach jobs can ever produce a different version than the Windows job for the same tag.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
