# In-app update

**Status: implemented on Windows.** The app knows its own version, looks for a newer release on this repository's GitHub releases, and, after one confirmed click, downloads it, checks it and replaces itself. macOS and Linux (preview assets) are told a newer release exists and are linked to it. Verifying the release's build attestation inside the app is not built: it is [#199](https://github.com/countrymanprime/narration-utils/issues/199). The decisions are [ADR 0072](../adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md) (Proposed: the source, channel, startup check and integrity level), [ADR 0073](../adr/0073-the-executable-is-named-narration-utils-and-carries-its-version.md) (the program name and the stamped version) and [ADR 0074](../adr/0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md) (the swap and the rollback); the work was specified in the in-app update and release artifact naming PRDs (deleted when it was done: `git show <commit>:docs/prds/in-app-update.prd.md`, see the [PRD index](../prds/README.md)). The narrator's view is in [the user guide](../guides/using-the-app/settings.md#about-and-updates).

## What the narrator sees

1. Settings > **About & updates** shows the version, the channel, when the app last looked and what it found. A background check that finds a newer version also raises a toast ("Version 0.2.7 is available. See Settings, About & updates.").
2. **Download update** asks first, then shows a progress dialog with the megabytes received, a **Cancel** while it downloads, and the checks that follow (checksum, unpacking), which cannot be cancelled and say so ([ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)).
3. **Install and restart** asks again ("closes and starts again on version 0.2.7 with the same project"), refuses while an import, a Story Bible build, a download, a comparison or a teleprompter session is running, then replaces the program and restarts it with the same arguments. Where the app may not replace itself (Program Files, a locked folder) it says why and offers **Show the downloaded file** instead; it never asks for elevation.
4. Nothing is downloaded and nothing is replaced without those clicks. The only thing the app does on its own is the metadata request below.

## The version

The root `package.json` version is the single source ([CI and releases](../operations/ci-and-releases.md#the-version-inside-the-program)); `scripts/release/wails-build.mjs` stamps it into `main.version` with `-ldflags`. It is bare semver (`0.2.7`): a release candidate and its promotion are the same bytes and report the same version. `Bootstrap.version` carries it and `narration-utils --version` prints it and exits without opening a window (the update flow asks a downloaded program this before it swaps it in). A build with no stamp (`go run`, `go test`, `wails dev`) is `0.0.0-dev` and is never offered an update.

## Where it looks: the release list is a trust boundary

`internal/update.Checker` asks `GET https://api.github.com/repos/countrymanprime/narration-utils/releases?per_page=30`, unauthenticated, with the repository compiled in (`update.Repository`): no setting, argument or response can point it elsewhere. It sends `Accept`, `X-GitHub-Api-Version`, `If-None-Match` and a `User-Agent` of `narration-utils/<version>`, and nothing about the narrator, the project or the machine.

| When | What |
| --- | --- |
| Automatic | 12 s after the window is up, at most once a day (2 h after a failure), silent on any failure, off with `Updates.check_on_startup` (default on). The answer and its `ETag` are cached in `%LOCALAPPDATA%\narration-utils\update\check.json`, so an unchanged list is a `304` that costs nothing against the 60 requests an hour limit. |
| Explicit | **Check now** (disabled while settings are unsaved: a check uses the saved ones). A rate-limit answer is remembered until it resets and holds for a click too. |
| Never | On a platform with no release (only `windows/amd64`, `darwin/arm64` and `linux/amd64` have one), or for a development build. |

The response is validated in Go before anything uses it (`internal/update/manifest.go`, fuzzed and tested with hostile lists): a 4 MiB body cap, at most 60 entries read, a tag accepted only as `v<MAJOR>.<MINOR>.<PATCH>` or the same with `-rc` (each part at most six digits) whose `prerelease` flag agrees with it, exactly one asset with the platform's compiled-in name and one `.sha256` of that name, plausible sizes (an asset up to 2 GiB, a checksum up to 4 KiB), a well-formed digest. A release that fails is dropped with a reason that names the problem and never the value; the others are kept. Every URL is **built** from the compiled-in repository, the tag and the known name (`https://github.com/<repo>/releases/download/<tag>/<name>`); nothing the list says about where to download is used. The cache file is re-validated like a fresh answer on every read.

A release is an update only if its bare version is strictly greater than the running one (an RC and its promotion tie, so a narrator on the RC is not offered the promotion). The channel `candidates` (the default: every release so far is a release candidate) or `stable` (promoted releases only) filters the list; `Updates.channel` is a global setting and a project's own file cannot change it.

## What is downloaded and how it is checked

`internal/update.Stager` stages an update in `%LOCALAPPDATA%\narration-utils\update\staged\app-update\windows-x64\<version>\`, never over the running program and never in a project:

1. The release's `.sha256` (at most 4 KiB) is read first. It must be `sha256sum` output that names this release's zip, and must agree with the digest GitHub lists for the file when the release lists one.
2. The disk is checked before anything is written (4 times the zip plus 64 MB) and again with the exact unpacked size.
3. The zip is fetched through `assets.InstallWith` with real byte progress, only from GitHub over HTTPS (`github.com` and the release-asset hosts, at most 5 redirects), and read no further than its declared size, into a staging folder that is renamed into place only after the size and SHA-256 match.
4. Exactly one entry named `narration-utils.exe` is unpacked (a regular file, non-empty, at most 1.5 GiB, copied in one bounded pass and renamed only when whole); any other entry, name, path, link or size is refused. A record (`staged.json`) keeps the program's size and SHA-256 and the zip checksum it came from; a staged program is reused only if the release still publishes that checksum.

**What this proves and what it does not.** TLS to GitHub, a checksum from the same release, a strictly newer version and names fixed at compile time. The `.sha256` beside a file only detects a damaged or partial download: it is not evidence of where the file came from. The build attestation is ([CI and releases](../operations/ci-and-releases.md#build-provenance)); a person can run `gh attestation verify` on the download, and verifying it inside the app is the follow-up (#199: `sigstore-go` was weighed at about 370 modules and 16 MB more binary and not adopted). The first stable release is unsigned (D7) and SmartScreen or antivirus software may object to it.

## The install and the rollback

`internal/update.Install` (called by `UpdateInstall` for the narrator's confirmed click, after the busy rule of `canAttachLocked` and a writable install folder):

1. The staged program is copied beside the running one as `<name>.new` while it is hashed, and must match the size and SHA-256 it was staged with.
2. The copy is run once with `--version` and must print the version the release names.
3. `%LOCALAPPDATA%\narration-utils\update\pending.json` records `{from, to, executable, attempts}`.
4. The running program is renamed to `<name>.old` (Windows allows renaming a running program, not overwriting it) and the copy takes its name and path, so the REAPER launcher's recorded path (`narration-utils-app-path.txt`, rewritten on every start from `os.Executable()`) stays valid.
5. The copy is started detached, outside any job object, with `--relaunch-after <pid>` and the original arguments (`--project-folder`, `--session-dir`, `--daw`, and the rest); the old process closes itself a moment after `UpdateInstall` answers.

`main` runs `update.Startup` before the window and the single-instance lock: it strips `--relaunch-after`, waits up to 30 s for that process to exit, and looks at the record. The first `Bootstrap` the new build serves is the confirmation (`update.Confirm`): it removes `<name>.old`, `<name>.failed` and the record. A launch that finds the record for its own version already on its second start, with the first start's process gone (it never confirmed), restores `.old`, keeps the failed build as `.failed`, starts the old program and exits; a launch that finds the first start's process still running is a second instance that will forward and exit, and changes nothing. Every rename is retried for about a second and a half (antivirus holds a new program open for a moment), the busy rule is checked again just before the swap, and only one install can run at a time. A failure at any step before the start puts everything back; if putting the old program back is impossible the record and `.old` are kept and the error names the file to rename. The record's `executable` is only compared with the running program, never used as a path, so a planted record cannot make the app touch another file.

| File beside the program | Meaning |
| --- | --- |
| `<name>.new` | the verified copy, present only during an install |
| `<name>.old` | the version that was replaced, kept until the new one has started |
| `<name>.failed` | a new version that did not start and was rolled back |

### Installed copies and the installer

A first install comes from the Windows setup program (`narration-utils-windows-x64-setup.exe`), which is **per user** on purpose ([ADR 0082](../adr/0082-windows-installs-per-user-from-an-nsis-setup-program-that-wails-builds-and-the-release-carries-beside-the-update-zip.md)): it installs to `%LOCALAPPDATA%\Programs\Narration Utils`, a folder the narrator can write to, so the check above (`WritableDir`) passes and the update swaps the program in place, exactly as for an unpacked zip. The setup program is never what the updater downloads: it fetches `narration-utils-windows-x64.zip` and its `.sha256` by exact name and ignores every other asset of a release. A per-machine copy (a zip unpacked under Program Files, or a folder an administrator owns) fails the writable check and gets `ErrNotWritable`'s answer with the download; the narrator updates it by running the new setup program or replacing the file. An update leaves `<name>.new`, `<name>.old` and `<name>.failed` beside the program only while it runs or after a rollback, and the uninstaller removes those too, so a rolled-back copy does not keep the install folder alive. Uninstalling does not touch `%LOCALAPPDATA%\narration-utils\update` (staged downloads and the pending record): that folder is part of the asset cache the uninstaller leaves.

**If the program is missing after a crash between the two renames** (a power cut, a killed process), rename `narration-utils.exe.old` back to `narration-utils.exe`.

## Code map

| Piece | Where |
| --- | --- |
| Version, tags, the release list, the check and its cache | `apps/desktop/internal/update/{version,manifest,check}.go` |
| Download, checksum, unpack, disk space, redirect policy | `apps/desktop/internal/update/{stage,disk*}.go`, `internal/assets` (`InstallWith`) |
| Install, startup, confirm, rollback, relaunch | `apps/desktop/internal/update/{install,startup,spawn_*,folder_*}.go`, `main.go` |
| Host jobs and bindings | `apps/desktop/{update,update_job,update_install,bindings_update}.go` |
| Settings | `Updates.check_on_startup` (bool), `Updates.channel` (`candidates`, `stable`): `fieldSchemas`, `config/defaults.json`, `builtinDefaults` |
| UI | `apps/ui/src/components/settings/{UpdatesPanel,UpdateDownloadDialog,AboutPanel}.tsx`, `api/{contracts,schemas}/update.ts` |

Bindings: `UpdateStatus` (from the cache, no request), `UpdateCheck`, `UpdateOpenNotes` (no argument: the host opens the notes of the release it found), `UpdateDownload`, `UpdateJobState`, `UpdateJobCancel`, `UpdateInstall`, `UpdateShowDownload`; the `update:status` event. Every payload has a Zod schema and a golden file written by a Go test ([wire contracts](wire-contracts.md)); the mock host answers all of it and can be put in any state with `?mockUpdate=available|found|downloading|download-fails|ready|install-blocked|install-refused|failed|current|development`.

## Tests

- Unit and property tests for versions and tags, table and fuzz tests for the release list and the relaunch arguments (seed corpora run in the gate, [ADR 0044](../adr/0044-property-and-fuzz-tests-are-deterministic-in-the-gate.md)), `httptest` fake GitHub servers for every failure of the check and the download.
- The install tests run **real programs**: `internal/update/testdata/fakeapp` (which uses the same `Startup` and `Confirm` as `main`) is replaced while it runs, relaunched with the original arguments after the old one is killed, and restored after two starts that never confirmed.
- A rehearsal with two real builds is not in the gate (it opens the application's window): `go test -tags rehearsal -run Rehearsal ./internal/update` with `REHEARSAL_OLD` and `REHEARSAL_NEW` set to two `narration-utils.exe` builds (build the second with `wails build -o narration-utils-099.exe -ldflags "-X main.version=0.9.9"`). On 2026-09-21 it swapped a real 0.1.0 for a real 0.9.9 while 0.1.0 was running, and the new build loaded its window, asked for its `Bootstrap` and confirmed.
- Not proven by any test, because it needs a real release: the first update from one published release candidate to the next (the owner's first attested release, [#188](https://github.com/countrymanprime/narration-utils/issues/188), is the same milestone), and a launch from REAPER after an update.

## Limits

No silent installs, no delta updates, no signing (D7), no update server, no telemetry, no self-replacement on macOS or Linux, no downgrade or same-version install, no "skip this version". A new build that reaches its first `Bootstrap` and is then broken is not rolled back. Changing any of this needs a new ADR that supersedes the one above.
