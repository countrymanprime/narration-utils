# 0412. Windows is the only supported platform for now

**Status:** Accepted (owner decision D74, 2026-09-27; supersedes ADR 0402 and amends ADRs 0027, 0070, 0071, 0072, 0073, 0197 and 0200)
**Date:** 2026-09-27
**Supersedes:** [ADR 0402](0402-coreaudio-capture-is-a-pyav-avfoundation-sidecar-backend-addressed-by-device-name.md). Amends the macOS and Linux clauses of [ADR 0027](0027-windows-gates-and-creates-the-release.md) (the optional separate builds), [ADR 0070](0070-workflow-actions-are-pinned-to-a-commit-and-zizmor-gates-the-workflows.md) (the workflow-level grant of `build-macos.yml` and `build-linux.yml`), [ADR 0071](0071-releases-carry-build-provenance-and-promote-refuses-a-file-the-release-workflows-did-not-build.md) (`_attach-platform.yml` as a second signer), [ADR 0072](0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md) (macOS and Linux notify only), [ADR 0073](0073-the-executable-is-named-narration-utils-and-carries-its-version.md) (the macOS bundle), [ADR 0197](0197-every-release-asset-name-carries-the-bare-version.md) (the macOS and Linux asset names) and [ADR 0200](0200-the-desktop-shell-runs-on-wails-v3-beta-pinned-at-v3-0-0-beta-25.md) (the macOS `Info.plist` and bundle in the build)

## Context

The app has been Windows first since [ADR 0030](0030-the-app-starts-without-a-project-and-picks-one-from-recents.md), and Windows has gated pull requests and created every release since [ADR 0027](0027-windows-gates-and-creates-the-release.md). Around that, the project kept macOS and Linux alive as preview platforms:

- `build-macos.yml` and `build-linux.yml` built and attached an unsmoked, installer-less asset after every Windows release, through a second signing workflow, `_attach-platform.yml`.
- The release scripts, the update manifest and the docs carried both platforms.
- The CoreAudio capture backend ([ADR 0402](0402-coreaudio-capture-is-a-pyav-avfoundation-sidecar-backend-addressed-by-device-name.md), [CoreAudio Capture](../prds/coreaudio-capture.prd.md)) added a macOS-only row to the capture port. Nobody could verify it on Apple hardware, and its registry row made the sidecar capabilities test depend on which rows loaded on the machine running it (the `{'coreaudio', 'dshow'}` flake of `test_live_asr.py`).

Nobody uses the app on macOS or Linux. On 2026-09-27 the owner decided (D74, on [#509](https://github.com/countrymanprime/narration-utils/issues/509), recorded under "Owner standing rules" in the [agent train](../operations/agent-train.md)): Windows only, for now. Linux and macOS support is removed until the app is in a steadier state or someone uses those systems, because it slows the project down. `Build (Windows)` stays the build gate.

## Decision

**Windows x64 is the only platform the app is built, released, installed, updated and supported on.**

Removed:

- **The release pipeline's other platforms:** `build-macos.yml`, `build-linux.yml` and the reusable `_attach-platform.yml`. Also removed: the `Windows release` job's step that started them, with its `actions: write`; the `macos-arm64` and `linux-x64` rows of `scripts/release/assets.mjs`, whose `PLATFORMS` table now holds only `windows-x64`; and the macOS `.app` bundle step of `scripts/release/wails-build.mjs`. Promote verifies the Windows files only.
- **The macOS-only feature, the CoreAudio capture backend:** the sidecar adapter (`capture_avfoundation.py`, `devices_avfoundation.py`), its tests and registry entry, and the Go `coreaudio` row of `internal/captureport`. It can be restored from commit `bf9f0093` (#720) and ADR 0402, which this ADR supersedes. Its PRD stays, marked deferred by D74.
- **The other platforms' update and packaging paths:** the `macos-arm64` and `linux-x64` keys of `internal/update`'s `PlatformFor`. On any platform but Windows x64, the app reports that it does not update itself.
- **Every "macOS and Linux are previews" statement,** in the README, `SECURITY.md`, the threat model, the operations and architecture docs and the PRDs. Each one now says Windows only and points here.

Kept, because none of it is platform support:

- **Linux CI runners for platform-neutral checks.** These are the docs link checks, the Lua bridge harness, the Playwright visual, atlas and aria suites, the Python sidecar tests, lint, `ui-dist`, the version job, the release publish job (which builds nothing), CodeQL and the Pages build. A check that runs on a Linux runner proves the code, not a Linux app.
- **The Go module building on Linux as a development host.** Cloud worker sessions and the pre-commit hook run `go vet` and Go tests on Linux. So the `//go:build !windows` files stay (`*_other.go` in `internal/assets`, `internal/daw`, `internal/process`, `internal/update` and the root package), as does `setup-toolchain`'s `need-linux-native-deps` input, which CodeQL's Go job uses to compile the module on Linux. These keep the code building. They make no promise that the result runs as an app.
- **The port registries' platform field.** `port.Platforms` and a descriptor's `Platforms` stay generic. They still decide per platform, and `moonshine` still declares Windows only. [ADR 0413](0413-what-stays-of-the-other-platforms-when-windows-is-the-only-one.md) records this and the other choices the worker made while applying D74.

## Consequences

- One platform to build, smoke, attest and document. A release is complete when the Windows files are, which was already the only thing promote required.
- The `test_capabilities_reflects_the_real_engines_and_backends_registries` flake goes away with the `coreaudio` row: the capture registry now has one row, `dshow`.
- A narrator on macOS or Linux has no download and no update. A developer on Linux can still build, vet and test the Go host and run the UI in a browser.
- `port.Platforms` still lists `darwin` and `linux` so that the registries and their tests can express a per-platform row. That costs nothing, and returning another platform needs no change to the port contract.
- **What brings a platform back:** someone who uses it, and an app steady enough that a second platform no longer slows the Windows work. The owner decides. Then write a new ADR that supersedes this one, and restore from the commit before this removal:
  - the workflows, from `.github/workflows/build-macos.yml`, `build-linux.yml` and `_attach-platform.yml`;
  - the `assets.mjs` rows and the `wails-build.mjs` bundle step;
  - the update keys;
  - CoreAudio, from `bf9f0093`.

  A returning platform needs its own smoke test before it ships. The previews never had one.
