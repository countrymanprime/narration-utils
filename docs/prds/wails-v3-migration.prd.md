# Wails v3 Migration: Move the Desktop Shell from Wails v2.16 to the v3 Beta

**Source:** owner decision D29 of 2026-09-24 ([implementation plan, section 6](implementation-plan.md#6-owner-decisions-2026-09-24)): "Migrate the desktop shell to Wails v3 beta (pinned, starting at `v3.0.0-beta.25`) and zoom with its runtime `Window.SetZoom`". Stack S26, lane A stream A1 (implementation plan, section 8). Tracking issue [#512](https://github.com/countrymanprime/narration-utils/issues/512). Wails sources are read at `github.com/wailsapp/wails/v2@v2.16.0` and `github.com/wailsapp/wails/v3@v3.0.0-beta.25`; `file:line` citations into this repository are at `c1d7e4e`.

## Problem Statement

The header zoom controls the owner asked for ([App Navigation and Zoom Controls](app-navigation-and-zoom-controls.prd.md), Q3) need to set the webview's real page zoom while the app runs. Wails v2.16 has no call for that: its only zoom setting is the startup `windows.Options.ZoomFactor`, and the WebView2 object that could change it is private to Wails. The owner chose to move the shell to Wails v3, whose windows have `SetZoom`, `GetZoom`, `ZoomIn`, `ZoomOut` and `ZoomReset`, over carrying a patched Wails v2 or imitating zoom in CSS (D29).

The move touches every place the host meets Wails: the program's start (`wails.Run`), the one bound object and its generated bindings, every live event, the file dialogs, the browser, notifications, quitting, and the whole native build: `wails build -nsis` made the program, its icon and version resource, the setup program and its WebView2 bootstrapper from `apps/desktop/wails.json`. v3 has no `wails build` of that kind. Every other stream of the 2026-09-24 train adds bindings or events, so this runs first and alone (D42).

## Evidence

- `apps/desktop/main.go:41-52` starts the app with `wails.Run(&options.App{...})`: title, size, minimum size, the asset server with the `/media` middleware, `OnStartup`/`OnShutdown`, `Bind: []interface{}{app}` and the single-instance lock.
- Every other v2 call is in eleven files and goes through `github.com/wailsapp/wails/v2/pkg/runtime` with the host's context: 18 `EventsEmit`, 4 dialog calls, 2 `BrowserOpenURL`, `Quit`, the four window calls of a second launch, and `InitializeNotifications`/`SendNotification`.
- The UI reaches the host only through `apps/ui/src/api/wailsClient.ts` ([ADR 0062](../adr/0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md)): 171 calls into the generated `apps/ui/wailsjs/go/main/Host.js` and every event through `EventsOn` from `wailsjs/runtime/runtime.js`. The mock backend is chosen at build time (`apps/ui/src/main.tsx:242`), so `window.go` appears only in tests.
- The REAPER bridge's own events (`apps/desktop/internal/bridge/wire.go`) are read by Go services from `events.log`; they reach the UI only as the state events `app.go` emits, so they move with those emitters and no lane B file changes.
- The build: `.github/actions/build-native/action.yml:84-97` runs `wails doctor` and `wails-build.mjs -s -nsis`; `scripts/release/wails-build.mjs` wraps `wails build`; `apps/desktop/build/windows/installer/project.nsi` includes the `wails_tools.nsh` v2 wrote on every build and embeds the bootstrapper v2 downloaded into `installer/tmp/`.
- Wails v3 beta.25 differences found in its sources, each handled below: events arrive in the page as `{name, data}`; a failed Go method rejects with a `RuntimeError` instead of its text; a cancelled Windows file dialog is an error (`cancelled by user`) instead of an empty path; `ZoomControlEnabled` defaults to off (Ctrl+wheel would stop); the browser's right-click menu is on in a production build; a macOS app keeps running after its last window closes; Linux links GTK 4 and WebKitGTK 6.0 instead of GTK 3 and WebKit2GTK 4.1; the rendered Windows manifest carries a three-part version; on Windows `SetZoom` and `ZoomOut` never go below 100% (`webview_window_windows.go:930-957`).
- What stays: WebView2's user data folder is `%APPDATA%\narration-utils.exe` and the page origin is `http://wails.localhost` in both versions (v2 `frontend.go:40`, v3 `assetserver_windows.go:7`, `edge/chromium.go:186-195`), so the theme and reader preferences in `localStorage` survive the update.

## Proposed Solution

Pin `github.com/wailsapp/wails/v3 v3.0.0-beta.25` and `@wailsio/runtime 3.0.0-beta.25`, the newest v3 tag on 2026-09-24. The Host becomes the one v3 service (`application.NewService`), its `Startup`/`Shutdown` become `ServiceStartup`/`ServiceShutdown`, and every other call into Wails goes through one new file, `apps/desktop/wailsapp.go`, which keeps v2's behaviour where v3 changed it. The bindings are regenerated as TypeScript into `apps/ui/wailsjs/` (the folder ADR 0062's rule names), the client subscribes through `Events.On` and keeps v2's error text, and a new import rule keeps `@wailsio/runtime` inside `src/api`. The build script runs the steps v3's Windows Taskfile runs, from `wails.json`, with no Taskfile. `Window.SetZoom` is reached through the named main window; the zoom UI, its binding and its persistence stay nav P2 and P3 (lane C's C2).

## Key Hypothesis

We believe a like-for-like move, with every v3 default that differs from v2 set back explicitly and tested, lets the rest of the train build on v3 without any page, binding or release asset changing. We'll know we're right when `Build (Windows)` and `ui-dist` are green, the 173 bindings keep their names and signatures, and the owner's launch of the v3 build on Windows (issue [#510](https://github.com/countrymanprime/narration-utils/issues/510) item 1) finds start, project open, REAPER launch, Ctrl+wheel and pinch zoom and the update check working.

## What We're NOT Building

- **No zoom UI, binding or remembered level.** Nav P2 and P3 do that on `Window.SetZoom` (lane C's C2); this stream only names the window and keeps Ctrl+wheel and pinch on.
- **No Taskfile, no `wails3 build`, no `build/config.yml`.** The build stays one script that CI and a developer both run.
- **No hot-reload `wails dev`.** v3's dev loop needs its Taskfile; UI work uses `pnpm --dir apps/ui dev:mock`, and `pnpm --dir apps/desktop dev` builds the UI and runs the app.
- **No new native menu** (nav Q7 A), no system tray, no second window.
- **No change to any binding's signature**, so `hostAPIVersion` stays 49.
- **No dropping of the beta pin**: that waits for a stable v3 (implementation plan, "Later").

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Builds | `Build (Windows)` and `ui-dist` green on every PR of the stack | CI |
| Bindings unchanged | The same 173 methods, the same argument and result types | diff of the generated names; UI typecheck |
| No regression in the host | Every `apps/desktop` Go test passes; new tests hold each changed default | `go test` |
| No regression in the client | Every `src/api` Vitest passes, including events and error text | Vitest |
| Installer | The per-user setup program is built and embeds a Microsoft-signed bootstrapper | CI step; `installer.test.mjs` |
| Launch on Windows | Owner's checklist on #510 item 1 all ticked | owner |

## Open Questions

- [x] **Q1. Which pin?** `v3.0.0-beta.25`, the newest v3 tag on 2026-09-24 (D29). `@wailsio/runtime` 3.0.0-beta.25 was published on 2026-09-22 and was inside pnpm's three-day `minimumReleaseAge`; the owner allowed it through a one-version `minimumReleaseAgeExclude` entry on 2026-09-25, removed once the cooldown has passed ([ADR 0200](../adr/0200-the-desktop-shell-runs-on-wails-v3-beta-pinned-at-v3-0-0-beta-25.md)).
- [ ] **Q2. Zoom range under v3 on Windows (for nav P2, its Q6).** v3 beta.25 cannot set a zoom below 100% on Windows, while WebView2's own Ctrl+wheel can. Recorded as Proposed [ADR 0201](../adr/0201-app-zoom-under-wails-v3-on-windows-runs-from-100-to-200-percent-and-reads-the-level-back-from-the-window.md); recommendation: nav P2's buttons run from 100% to 200%, reset works from any level, and the readout reads the level back from the window.
- [x] **Q3. Hot-reload dev loop?** Not built (What We're NOT Building); the recommendation is taken under D22.

## Users & Context

The narrator gets the same app; nothing on screen changes. The developers of the other lanes get v3's bindings and runtime to build on, and the owner launches the new build once on Windows before wave 1 starts (D42).

## Solution Detail

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | The Host as a v3 service; lifecycle, second launch, dialogs, browser, notifications, quit | 2 |
| Must | Regenerated bindings, the client on `@wailsio/runtime`, every event, v2's error text | 2 |
| Must | Ctrl+wheel and pinch zoom kept; the browser menu off; macOS quits with its window | 2 |
| Must | Build, per-user installer, release pipeline and the update's asset names unchanged | 2 |
| Must | Threat model and `SECURITY.md` for the new dependency | 2 |
| Must | Nav PRD reconciled with D29 | 1 |
| Should | Steady-state docs: build, bindings, events, diagrams | 3 |

**MVP scope:** phases 1 and 2. Phase 3 documents what phase 2 built.

## Technical Approach

**Host (`apps/desktop`).**
- `main.go`: `application.New` with the Host as the one service, the embedded UI through `AssetFileServerFS` (it finds `index.html` inside the embedded folder, as v2 did) and the `/media` middleware, the single-instance lock under the same id, and `Mac.ApplicationShouldTerminateAfterLastWindowClosed`. One window, `mainWindowOptions()`: named `main`, the same size and minimum size, `ZoomControlEnabled: true` and `DefaultContextMenuDisabled: true`.
- `wailsapp.go`: `emitEvent`, `mainWindow`, `bringWindowForward`, `pickFile`/`pickFiles`/`pickFolder` (a Windows cancel is "nothing selected"), `openInBrowser`, `quitApplication`. Each is a no-op or `errHostNotReady` when no application exists, which is every test.
- The notification service is started by hand on first use and never registered, so none of its methods becomes a binding.
- `ServiceStartup(ctx, options) error` and `ServiceShutdown() error` replace `Startup`/`Shutdown`; v3 binds every other exported method, so the old names would have become page-callable.

**UI (`apps/ui`).**
- `pnpm --dir apps/desktop run bindings` writes `wailsjs/github.com/countrymanprime/narration-utils/shell/{host,models}.ts` and `internal/liveflags/models.ts`. The v2 `wailsjs/go` and `wailsjs/runtime` are deleted.
- `wailsClient.ts` subscribes with `Events.On` and reads each event's `data`; `decode`/`decodeObject` turn a v3 `RuntimeError` back into its text; three pointer arguments pass `?? null`, the same bytes v2 sent for `undefined`.
- `wails-runtime-only-in-api` in `.dependency-cruiser.mjs`, with its test in `architectureRules.test.ts`.

**Build (`scripts/release/wails-build.mjs`, `.github/actions`).** `wails3 update build-assets` renders the Windows version resource, manifest and `wails_tools.nsh`, and the macOS `Info.plist`, from `wails.json` into a temporary folder; the manifest gets the four-part version Windows requires; `wails3 generate syso` embeds icon, version and manifest; `go build -tags production -trimpath -ldflags "-w -s -H windowsgui -X main.version=…"`; for `--installer`, `wails3 generate webview2bootstrapper` writes the bootstrapper the pinned CLI carries and `makensis` compiles `project.nsi`, whose code is unchanged. The CLI is installed with `CGO_ENABLED=0` at the pinned version; Linux runners install GTK 4 and WebKitGTK 6.0.

**Risks.** A beta: the pin is exact, and each bump is its own reviewed change. What a test cannot prove on Windows (the dialogs, zoom gestures, a second launch, notifications, the installer on a clean machine) is on the owner's launch checklist.

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Plan | This PRD, ADR 0200 and Proposed ADR 0201, the nav PRD reconciled with D29 | complete | - | - | - |
| 2 | Shell on v3 | Host, bindings, client, events, build, installer, release pipeline, threat model and `SECURITY.md` | complete | - | 1 | - |
| 3 | Steady-state docs | CI and releases, the in-app update, the codebase map and its diagrams, verification tooling | pending | - | 2 | - |
| 4 | Owner launch | The owner launches the v3 build on Windows ([#510](https://github.com/countrymanprime/narration-utils/issues/510) item 1) | pending | - | 2 | - |

### Phase Details

**Phase 2.** Scope as in Technical Approach. Acceptance: `go build` and `go test` of `apps/desktop`, its lint target, the UI typecheck and the `src/api` Vitest, the release-script tests, a local Linux build, and a cross-built Windows program and setup program; `Build (Windows)` and `ui-dist` green.

**Phase 3.** `docs/operations/ci-and-releases.md`, `docs/architecture/in-app-update.md`, `docs/architecture/codebase-map.md` and any diagram in `docs/architecture/` that names a moved file or binding, `docs/operations/verification-tooling.md`, `docs/design/design-system.md` (the import rules).

**Phase 4.** Owner only; wave 1 waits on it (D42). The first close-out after the box is ticked deletes this PRD.

### Parallelism Notes

Runs alone (D42). Lanes B and C work in parallel on files this stack does not touch; while it is open they add no binding and touch no Wails-generated or `.github/` file.

| Phase | Files | Collides with |
| --- | --- | --- |
| 1 | `docs/prds/wails-v3-migration.prd.md`, `docs/prds/README.md`, `docs/prds/app-navigation-and-zoom-controls.prd.md`, `docs/adr/0200-*`, `docs/adr/0201-*`, `docs/adr/README.md` | Nav P1 (the nav PRD) |
| 2 | `apps/desktop/{main.go,wailsapp.go,app.go,bindings*.go,dawcatalog.go,dawlink.go,jobs.go,measure_job.go,notifications.go,update*.go,go.mod,go.sum,wails.json,package.json}` and tests, `apps/desktop/build/windows/installer/project.nsi`, `apps/ui/wailsjs/**`, `apps/ui/src/api/wailsClient*.ts`, `apps/ui/{package.json,.dependency-cruiser.mjs,src/architectureRules.test.ts}`, `pnpm-lock.yaml`, `.github/actions/{build-native,setup-toolchain}`, `scripts/{release/wails-build*.mjs,release/assets.mjs,release/installer.test.mjs,toolchain.json,bootstrap.test.mjs}`, `.gitignore`, `.gitattributes`, `knip.jsonc`, `SECURITY.md`, `docs/architecture/threat-model.md` | Every stream that adds a binding or an event (D42) |
| 3 | The docs of Phase Details | Any stream editing the same docs |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Migrate to v3 (owner, 2026-09-24, D29) | Wails v3 beta, pinned | A patched v2; CSS zoom | v2 has no runtime zoom; see the nav PRD's Decisions Log |
| Pin (D29) | `v3.0.0-beta.25`, `@wailsio/runtime` 3.0.0-beta.25 | A newer beta | The newest tag on 2026-09-24; nothing newer existed |
| The pnpm cooldown (owner, 2026-09-25, ADR 0200) | A one-version `minimumReleaseAgeExclude` entry for `@wailsio/runtime@3.0.0-beta.25`, removed after the cooldown | Wait the three days | The owner: the cooldown is there for Dependabot's routine updates, and this pin is a reviewed, deliberate choice; the lockfile hash still pins the bytes |
| Build (ADR 0200) | One script runs the Taskfile's steps | Adopt v3's Taskfile and `wails3 build` | One entry point for CI and a developer; no new tool (go-task) in the release path |
| Bindings folder (ADR 0200) | `apps/ui/wailsjs/` kept, TypeScript output | v3's default `frontend/bindings` | ADR 0062's rule, Knip, ESLint and the quality scripts already name it |
| v2 defaults kept (ADR 0200) | Ctrl+wheel on, browser menu off, macOS quits with its window, error text, cancel is empty | v3's defaults | Nothing the narrator sees may change in a like-for-like move |
| Zoom range on Windows (proposed, Q2, ADR 0201) | 100% to 200% from the buttons | Patch Wails; CSS below 100% | v3 beta.25 floors `SetZoom` at 100% on Windows |
| ADRs | [0200](../adr/0200-the-desktop-shell-runs-on-wails-v3-beta-pinned-at-v3-0-0-beta-25.md) Accepted (the migration), [0201](../adr/0201-app-zoom-under-wails-v3-on-windows-runs-from-100-to-200-percent-and-reads-the-level-back-from-the-window.md) Proposed (zoom range) | One ADR | ADRs are one decision each; 0201 needs the owner |

## Research Summary

- **Read:** `apps/desktop/{main.go,app.go,bindings.go,notifications.go,update*.go,measure_job.go,dawlink.go,dawcatalog.go,jobs.go}`, `apps/ui/src/api/wailsClient{,.test}.ts`, `.github/actions/{build-native,setup-toolchain}/action.yml`, `scripts/release/{wails-build,assets,installer.test,sync-version}.mjs`, `project.nsi`; Wails v3 beta.25 `pkg/application/{application_options,webview_window,webview_window_windows,window_manager,dialogs,dialogs_windows,event_manager,single_instance,bindings}.go`, `pkg/services/notifications`, `internal/commands/{build_assets,updatable_build_assets,generate_webview2.go}`, `@wailsio/runtime/src/{events,calls,runtime}.ts`.
- **Run here:** `go build`/`go test` of `apps/desktop` on Linux with GTK 4, `GOOS=windows go build`; `wails3 generate bindings` (173 methods, the same names as v2's `Host.d.ts`); a Linux build through `wails-build.mjs`; a cross-built Windows program, `generate syso` and `makensis` of `project.nsi` against the rendered `wails_tools.nsh` (the setup program compiles); `notices.py`'s Go components (every licence named).
- **Not run here:** anything that opens the window. That is the owner's launch (Phase 4).
