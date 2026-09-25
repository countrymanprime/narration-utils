# 0073. The executable is named `narration-utils` and carries its own version

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

Owner decision D14 moved the version into the app: "we should include the version internal to the packaged app. something it can reference internally and look at the releases on github for new versions to download and replace itself with". Two things follow. The program a narrator unpacks was called `narration-utils-shell` (the internal name of the Go/Wails part), which means nothing to them; and the program had no way to say which version it is: the only version in the build was the Windows file property, which Go never reads. The release-artifact-naming PRD (`docs/prds/release-artifact-naming.prd.md`, deleted when the work was done; recover it from git history) had a second phase that put the version in the asset file names; D14 dropped it, so [ADR 0027](0027-windows-gates-and-creates-the-release.md)'s "one asset per platform, named `narration-utils-<platform>.<ext>`" stands unchanged.

## Decision drivers

- The owner's decision D14: include the version inside the packaged app, so it can look at the GitHub releases for new versions and replace itself.
- The program a narrator unpacked was called `narration-utils-shell`, which means nothing to them.
- The program had no way to say which version it is: the only version in the build was the Windows file property, which Go never reads.

## Considered options

1. Name the program `narration-utils` and stamp its bare semver version into the binary at build time
2. Keep the status quo: `narration-utils-shell`, with the version only in the Windows file property
3. Put the version in the release asset file names (the second phase of the release-artifact-naming PRD)
4. Also rename the nx project, the `apps/desktop/` directory and the Go module path

## Decision outcome

**Chosen option: name the program `narration-utils` and stamp its bare semver version into the binary at build time**, because the owner's decision D14 moved the version into the app, and the old name `narration-utils-shell` meant nothing to a narrator.

1. **The program is `narration-utils`, and `narration-utils.exe` on Windows.** `apps/desktop/wails.json` `outputfilename` says so; `scripts/release/assets.mjs` packages exactly that file; the workflows' attestation globs are `apps/desktop/build/bin/narration-utils*`; the macOS bundle keeps `Narration Utils.app` with `narration-utils` inside. The nx project, the directory `apps/desktop/` and the Go module path keep their names (renaming them is not user-visible and would churn the lockfile and the Nx cache).
2. **The REAPER launcher looks for the new name and never depends on it where it can avoid it.** `integrations/reaper/NarrationUtils_Launcher.lua` derives `narration-utils[.exe]` for its two fallbacks (the bundle root, and `apps/desktop/build/bin` in a checkout) and no longer looks for the old name. The path in `narration-utils-app-path.txt` is written by the app from `os.Executable()`, is used as it is, and stays name-independent, so a renamed or relocated program (and an in-app update at the same path) needs no launcher change. The launcher's name logic is pinned by the Lua harness (`integrations/reaper/tests/launcher_test.lua`): bundle and checkout, Windows and not, and the old name refused.
3. **The version is bare semver, stamped into the binary at build time from one source.** The root `package.json` version, already synchronized by `sync-version.mjs`, is passed as `-ldflags "-X main.version=<version>"` by `scripts/release/wails-build.mjs`, which CI (`build-native`) and the local `build` script both run. A release candidate and its promotion are the same bytes (`promote-release.yml` re-publishes the files), so they report the same version and the script refuses a suffix. A build without the stamp reports `0.0.0-dev`. `Bootstrap` returns it (`version`, in the wire contract and its Zod schema, golden payloads and mock), and Settings > About shows it. `narration-utils --version` prints it and exits, which is how a downloaded build is asked its version before it replaces the running one.
4. **`hostAPIVersion` is 6** (Bootstrap gained a required field).

### Consequences

- **Good:** The app can say which version it is, and the in-app update ([ADR 0072](0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)) has something to compare.
- **Neutral:** No user-visible file is called `*-shell*`. A narrator with a shortcut to a pre-rename `narration-utils-shell.exe` has to point it at `narration-utils.exe`; only pre-release builds are affected. The Windows notification identity is the executable's base name, so notifications now appear as `narration-utils`.
- **Neutral:** A stale `apps/desktop/build/bin/narration-utils-shell.exe` from before the rename is ignored by the launcher; clean the folder.
- **Neutral:** A locally built program is stamped with the checked-in root version, not the version of the next release: only the release workflows compute that.
- **Neutral:** Changing the name or the stamping means a new ADR that supersedes this one.

### Confirmation

The launcher's name logic is pinned by the Lua harness (`integrations/reaper/tests/launcher_test.lua`): bundle and checkout, Windows and not, and the old name refused. The `version` field of `Bootstrap` is in the wire contract, its Zod schema, the golden payloads and the mock.

## Pros and cons of the options

### Keep the status quo: `narration-utils-shell`

- Bad, because the name means nothing to a narrator.
- Bad, because the program had no way to say which version it is: the Windows file property is never read by Go.

### Also rename the nx project, the directory and the Go module path

- Bad, because renaming them is not user-visible and would churn the lockfile and the Nx cache.
