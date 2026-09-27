# 0413. What stays of the other platforms when Windows is the only one

**Status:** Proposed (the worker's choices in applying D74; the owner confirms or overrides them on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-27
**Supersedes:** none. It details [ADR 0412](0412-windows-is-the-only-supported-platform-for-now.md)

## Context

[ADR 0412](0412-windows-is-the-only-supported-platform-for-now.md) records the owner's decision D74: Windows only, for now. D74 names two things to keep, Linux CI runners for platform-neutral checks and the Go module compiling on Linux as a development host, and asks for everything else to be removed. Four places were not clear-cut. In each, removing the non-Windows part would either break the Linux development host or change a contract that has nothing to do with platform support. No one was available to ask, so the worker picked the option that best matched D74 and recorded it here.

## Decision

1. **`port.Platforms` keeps `windows`, `darwin` and `linux`** (`apps/desktop/internal/port/registry.go`, and `PLATFORMS` in `libs/python/narration_common/ports/registry.py`). These are the names a descriptor may declare. They are not the platforms the app ships on. Removing `darwin` would change the provider-port contract ([ADR 0301](0301-providers-sit-behind-small-ports-with-a-registry-and-a-capability-descriptor.md), lane K). Removing `linux` would leave a Linux development host unable to name its own platform. With the CoreAudio row gone, no registered row declares `darwin`. The generic registry tests that use `darwin` or `linux` as example platforms stay.
2. **`scripts/release/wails-build.mjs` still builds on Linux, but no longer on macOS.** `pnpm --dir apps/desktop run package` on a Linux development machine produces an unsupported, unshipped binary for local checks. The macOS `.app` bundle step is removed.
3. **On any platform but Windows x64, the update check says the app does not update itself there.** It no longer links to a macOS or Linux asset, because none exists. `internal/update`'s `PlatformFor` returns `false` for `darwin/arm64` and `linux/amd64`, the same answer it already gave for `windows/arm64`. The `Platform.SelfReplace` flag and the `replaces` field of the update status stay, although Windows always replaces itself: `replaces` is part of the update binding's wire contract, and removing it is a UI and contract change of its own, not platform support. The startup test that pins the update check acts as the Windows build, so it runs on a Linux development host too.
4. **`setup-toolchain`'s `need-linux-native-deps` input stays.** CodeQL's Go job compiles the module on a Linux runner and needs GTK 4 and WebKitGTK 6.0 for the Wails package. That compile is analysis on a Linux host, not a Linux build of the app. Every other Linux caller already turns the input off.

## Consequences

- A Linux developer loses nothing they relied on: vet, tests and a local build still work. Only the macOS build path is gone.
- The provider capabilities binding still reports its payload per platform. A `provider-capabilities-darwin` golden would pin a platform the app no longer ships on, so it is removed. The binding's own tests still exercise a non-Windows platform, now as `linux`.
- If the owner wants a stricter cut (for example `port.Platforms` reduced to `windows`, or the Linux development build refused), a new ADR supersedes this one. That cut would first have to move every Linux-host `go test` to a Windows runner.
