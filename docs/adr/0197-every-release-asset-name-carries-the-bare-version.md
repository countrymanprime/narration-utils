# 0197. Every release asset name carries the bare version

**Status:** Accepted
**Date:** 2026-09-24
**Supersedes:** the asset names of [ADR 0027](0027-windows-gates-and-creates-the-release.md) ("one asset per platform, named `narration-utils-<platform>.<ext>`"), of [ADR 0082](0082-windows-installs-per-user-from-an-nsis-setup-program-that-wails-builds-and-the-release-carries-beside-the-update-zip.md) decision 3 and of [ADR 0085](0085-the-third-party-notices-are-generated-from-the-release-and-ship-as-their-own-asset-and-not-inside-the-update-zip.md); the "asset names stay unversioned" part of owner decision D14 (`docs/prds/implementation-plan.md`)

## Context

Every release asset had the same name in every release (`narration-utils-windows-x64-setup.exe`, `narration-utils-windows-x64.zip`, `THIRD-PARTY-NOTICES.txt`), so three downloads of three versions sat in a Downloads folder as `narration-utils-windows-x64-setup.exe`, `narration-utils-windows-x64-setup (1).exe` and `(2)`, with nothing to say which was which. The owner asked for the version in the name "so if I download 3 different versions, I can see what it is at a glance". D14 had dropped exactly that (phase 2 of the release-artifact-naming PRD) in favour of the version inside the program; the version inside the program stays, and this adds it to the names too.

The in-app updater ([ADR 0072](0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)) finds its zip by an exact, compiled-in name, so an installed copy that predates this change looks for `narration-utils-windows-x64.zip` and will not find it on a release made after it. The owner chose, over keeping the update zip unversioned or publishing an unversioned copy beside it for a transition, to rename every asset and have those copies reinstalled once by hand: every release so far is a release candidate.

## Decision

1. **Every asset is `narration-utils-<version>-<name>`**, where `<version>` is the bare `MAJOR.MINOR.PATCH` stamped into the program ([ADR 0073](0073-the-executable-is-named-narration-utils-and-carries-its-version.md)): `narration-utils-0.2.7-windows-x64.zip`, `narration-utils-0.2.7-windows-x64-setup.exe`, `narration-utils-0.2.7-THIRD-PARTY-NOTICES.txt`, `narration-utils-0.2.7-macos-arm64.zip`, `narration-utils-0.2.7-linux-x64.tar.gz`, each with its `.sha256` beside it naming the versioned file. The version comes first after the product so a folder sorted by name groups a release's files together.
2. **The version is bare, never the tag.** A candidate `v0.2.7-rc` and its promotion `v0.2.7` are the same bytes ([ADR 0073](0073-the-executable-is-named-narration-utils-and-carries-its-version.md)), so they publish the same names, and promote still re-publishes the files it downloaded without renaming or rebuilding.
3. **`scripts/release/assets.mjs` names, packages and verifies by version.** `package <platform> [<version>]` names the files for the root `package.json` version (which `build-native` sets to the release version before building) unless one is given; `verify <dir> <version>` needs the version and refuses a file named for any other version as an unexpected file. `prerelease.yml` passes the computed version, `promote-release.yml` derives it from the tag. What the build writes into `apps/desktop/build/bin` keeps its unversioned name (`narration-utils.exe`, NSIS's `OutFile` `narration-utils-windows-x64-setup.exe`, `THIRD-PARTY-NOTICES.txt`); packaging gives the released name.
4. **The updater builds the name from each release's tag.** `update.Platform` holds the platform key and extension, and `AssetName(version)` / `ChecksumName(version)` build the name for the version the tag names (`apps/desktop/internal/update/manifest.go`). A release whose files are named for another version, or carry no version, is refused like one with no asset; the cached list is re-validated the same way (`check.go`). The zip's content (one `narration-utils.exe`) and the checksum's format are unchanged.
5. **The release notes name the versioned files** (`scripts/release/generate-notes.mjs` reads the names from `assets.mjs`).

## Consequences

- Downloads of different versions can be told apart by name, and the checksum file names which version it is for.
- **An installed copy from before this change cannot update itself to a release made after it.** It finds no asset with the name it knows and treats the release as unusable, so it silently reports no update. It has to be updated once by hand (run the new setup program, or replace the program from the new zip); from then on the updater finds the versioned names. Accepted by the owner because every release so far is a pre-release.
- A release candidate published before this change carries unversioned names, so `verify` finds none of its files and promote refuses it; the next candidate can be promoted (the same rule as candidates without attestations or without a setup program).
- The build folder and the release now name the setup program and the notices differently; `assets.mjs` is the one place that maps one to the other.
- Changing the name pattern again means changing `assets.mjs` and `update.Platform.AssetName` in one pull request and a new ADR that supersedes this one; the tests of both hold the pattern.
