# 0082. Windows installs per user from an NSIS setup program that Wails builds and the release carries beside the update zip

- **Status:** Accepted
- **Date:** 2026-09-21
- **Related:** Its asset names are superseded by [ADR-0197](0197-every-release-asset-name-carries-the-bare-version.md)

## Context and problem

A narrator's only way to get the app was to download a 400 MB zip holding `narration-utils.exe` and run it from wherever it was unpacked: no Start Menu entry, no shortcut, no uninstaller, no check that the WebView2 runtime is present ([standalone launch](../architecture/standalone-launch.md#packaging), [the release readiness PRD](../prds/release-readiness-provisioning-and-docs-site.prd.md) phase 14, Open Question 10, answered: NSIS through Wails' `-nsis`; per user or per machine to be decided and recorded here).

Facts established before writing any definition (2026-09-21):

- **No installer was ever built.** Nothing passed `-nsis` in CI (`.github/actions/build-native` ran `wails build -s`); only the developer script `apps/desktop/package.json` `build:windows` did. `docs/operations/ci-and-releases.md` said the runner had no NSIS, and `wails doctor` on the hosted Windows runner lists `nsis` as "Available", meaning not installed. Wails v2.16.0 (`pkg/commands/build/nsis_installer.go`) writes its embedded default `project.nsi` when none exists, always rewrites `wails_tools.nsh`, downloads Microsoft's WebView2 bootstrapper into `tmp/`, and when `makensis` is missing prints "Warning: Cannot create installer: makensis not found" and returns success. A build that asks for an installer can therefore succeed without one.
- **The Wails default is not right for this app** in four ways. It installs the program as `Narration Utils.exe` (`INFO_PROJECTNAME` plus `.exe`), while the REAPER launcher and the updater expect `narration-utils.exe` ([ADR 0073](0073-the-executable-is-named-narration-utils-and-carries-its-version.md)); it names the setup file `Narration Utils-amd64-installer.exe` (a space, and not one of the unversioned asset names of [ADR 0071](0071-releases-carry-build-provenance-and-promote-refuses-a-file-the-release-workflows-did-not-build.md)); it makes the desktop shortcut unconditionally; and its uninstaller runs `RMDir /r $INSTDIR`, which deletes whatever else is in a folder the narrator chose, and deletes the WebView2 data folder (`%APPDATA%\narration-utils.exe`), which holds the narrator's theme choice.
- **Per machine would break the updater's promise.** [ADR 0074](0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md) replaces the running program by renaming it and its copy in the install folder and never asks for elevation; it probes that the folder is writable first. Under `C:\Program Files` a standard user cannot write, so the update panel would say "installed where it is not allowed to replace itself" and offer only the download.

## Decision drivers

- A narrator's only way to get the app was a 400 MB zip run from wherever it was unpacked: no Start Menu entry, no shortcut, no uninstaller, no check that the WebView2 runtime is present.
- The release readiness PRD's Open Question 10 was answered: NSIS through Wails' `-nsis`, with per user or per machine to be decided here.
- The Wails default definition is wrong for this app in four ways (the program name, the setup file name, an unconditional desktop shortcut, and an uninstaller that deletes the whole folder and the WebView2 data).
- A per-machine install would break the in-app updater's promise to replace itself without elevation (ADR-0074).
- A Wails build that asks for an installer can succeed without one when `makensis` is missing.

## Considered options

1. A per-user NSIS setup program that Wails builds from a checked-in `project.nsi`, carried beside the update zip
2. A per-machine install under `C:\Program Files`
3. The Wails default NSIS definition
4. Keep the status quo: the zip only

## Decision outcome

**Chosen option: a per-user NSIS setup program that Wails builds from a checked-in `project.nsi`, carried beside the update zip**, because the zip alone gave no Start Menu entry, shortcut, uninstaller or WebView2 check, and a per-machine install would stop the in-app updater replacing the program without elevation.

1. **The Windows installer is per user.** It runs unelevated (`RequestExecutionLevel user`), installs to `%LOCALAPPDATA%\Programs\Narration Utils` (an update of an existing install goes to the folder recorded in its `InstallLocation` value), registers the uninstaller under `HKCU`, and creates the shortcuts in the user's own Start Menu and desktop. The folder is writable by the narrator, so the in-app updater works on an installed copy. A per-machine install is not offered: the definition refuses `WAILS_INSTALL_SCOPE` other than `user`. A narrator who unpacks the zip into Program Files, or an administrator who wants one copy for every account, gets the updater's existing answer (cannot replace itself, with the reason, and the download) and updates by running the new setup program or replacing the file.
2. **Wails builds it; only what differs from the default is checked in.** The definition is `apps/desktop/build/windows/installer/project.nsi` (`.gitignore` lists it as the one tracked file of that folder: `wails_tools.nsh` is regenerated on every build from the values in `wails.json`, which `scripts/release/sync-version.mjs` keeps equal to the release version, and `tmp/` holds the downloaded bootstrapper). It differs from the default by: per user as above; `PRODUCT_EXECUTABLE` `narration-utils.exe`; `OutFile` `narration-utils-windows-x64-setup.exe` (unversioned); the Start Menu shortcut always and the desktop shortcut as a choice the narrator can untick on a components page; a finish page that can start the app; welcome text that says the build is unsigned and needs no administrator rights; and an uninstaller that deletes only `narration-utils.exe`, its `.new`, `.old` and `.failed` copies (what [ADR 0074](0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md) leaves beside it), the shortcuts and its own entry, then removes the folder only if it is empty. It **leaves** the narrator's settings (`%APPDATA%\narration-utils`), the asset cache (`%LOCALAPPDATA%\narration-utils`, downloaded voices and models and the update staging area), the WebView2 data (`%APPDATA%\narration-utils.exe`, the theme choice) and every project's sidecar folders, and says so on the uninstall confirmation page and in the uninstall log. The WebView2 runtime is detected by the default macro and installed by Microsoft's bootstrapper only when missing; the installer opens no connection otherwise. Unsigned (owner decision D7): nothing signs the setup program, and the welcome text and release notes say so.
3. **The release carries it beside the zip.** `narration-utils-windows-x64-setup.exe` and its `.sha256` are release assets of the `windows-x64` platform in `scripts/release/assets.mjs`, required like the zip (a Windows build that loses its installer cannot be promoted), attested by the same release-job step, and verified by the same `verify --attestations`. The in-app updater keeps using the zip and the names it already matches (`narration-utils-windows-x64.zip` and its `.sha256`); it ignores every other asset, so the setup program changes nothing for it. The setup program is for a first install and for a narrator who reinstalls.
4. **A build that asks for an installer and gets none fails.** `scripts/release/wails-build.mjs` removes a stale setup program before running Wails and fails after it when `-nsis` was passed and the file is missing; `assets.mjs package` refuses to package Windows without it, before zipping. `.github/actions/build-native` passes `-nsis` on Windows, installs NSIS (`choco install nsis`, version pinned) when `makensis` is not on the runner, prints its version, and checks that the WebView2 bootstrapper Wails embedded carries a valid Microsoft Authenticode signature (Wails fetches it from Microsoft without pinning a hash).
5. **What is not proven here.** `makensis` runs only in CI (it is not installed on the development machine and this change installed nothing), so a definition that CI builds and the checks above accept is still not an install on a clean machine: that run (install, shortcuts, launch, uninstall leaves settings) is the owner's step in the first stable rehearsal (PRD phase 16).

### Consequences

- **Good:** A narrator has an installer, a Start Menu entry, an optional desktop shortcut, an entry in Settings > Apps, and an uninstaller that cannot delete what is not theirs to lose. The in-app updater works on an installed copy.
- **Neutral:** The release grows by the setup program (about the size of the zip, compressed with NSIS's default zlib; `lzma` would shrink it at the cost of minutes of CI time and is a later change). Each release candidate now holds two large files, so a candidate built before this change has no setup program and cannot be promoted (the same rule that already applied to candidates without attestations); the next candidate can.
- **Neutral:** The definition cannot be compile-checked outside CI. `scripts/release/installer.test.mjs` holds the properties that matter (per user, the file names, what the uninstaller deletes and leaves, no network, no signing, the file is tracked) so a later edit cannot undo them unnoticed; the compile itself is checked by the `Build (Windows)` job.
- **Bad:** **Accepted risk: NSIS comes from Chocolatey.** `choco install nsis --version=3.11.0` runs the community package's install script in the same job that later attests the release, and the archive checksum lives inside that package, so a tampered package could alter the setup program's bytes before they are attested. The version is pinned, the log prints `makensis -VERSION`, and the release is still verified (attestation names the workflow, not the tool). Downloading the official zip against a SHA-256 kept in the repository, or building in a job that holds no `id-token` or `contents: write`, would close it; neither is done here because the hash has to be computed from a real download (nothing was downloaded on the development machine). A follow-up for whoever next touches the Windows job.
- **Neutral:** **Accepted: the install folder is the narrator's choice.** The default is inside the profile, and an unelevated installer cannot write to Program Files or Windows. A narrator (or `/D=`) can still pick a folder other local users can write to, where another user could replace the program; the installer does not restrict the directory, because installing to another drive is legitimate. The uninstaller cannot delete anything but its own files there.
- **Bad:** Two installs for one person (per-machine from the zip and per-user from the setup program) are not detected; the per-user entry in Settings > Apps is the only uninstall entry the setup program makes.
- **Neutral:** The uninstaller leaves the WebView2 data and the asset cache; a narrator who wants a clean machine deletes those folders by hand (the README says where).
- **Neutral:** Changing to per machine, to signing the setup program, or to another technology (MSI, MSIX) means a new ADR that supersedes this one.

### Confirmation

`scripts/release/installer.test.mjs` holds the properties that matter (per user, the file names, what the uninstaller deletes and leaves, no network, no signing, the file is tracked), and the `Build (Windows)` job checks the compile. `scripts/release/wails-build.mjs` fails when `-nsis` was passed and the setup program is missing, and `assets.mjs package` refuses to package Windows without it. An install on a clean machine is the owner's manual step in the first stable rehearsal.

## Pros and cons of the options

### A per-machine install

- Bad, because under `C:\Program Files` a standard user cannot write, so the update panel would say "installed where it is not allowed to replace itself" and offer only the download.

### The Wails default NSIS definition

- Bad, because it installs the program as `Narration Utils.exe`, while the REAPER launcher and the updater expect `narration-utils.exe`.
- Bad, because it names the setup file `Narration Utils-amd64-installer.exe` (a space, and not one of the unversioned asset names).
- Bad, because it makes the desktop shortcut unconditionally.
- Bad, because its uninstaller runs `RMDir /r $INSTDIR`, which deletes whatever else is in the folder, and deletes the WebView2 data folder that holds the narrator's theme choice.

### Keep the status quo: the zip only

- Bad, because it gives no Start Menu entry, no shortcut, no uninstaller and no check that the WebView2 runtime is present.
