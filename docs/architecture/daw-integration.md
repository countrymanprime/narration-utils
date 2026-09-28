# DAW Integration Boundary

**Status: native Wails desktop workspace and REAPER file bridge implemented.**

## REAPER rules

- Keep business logic in Go and user-facing UI in React. The two packaged Python analysis sidecars remain Manuscript Guide and Transcript Compare. Keep only project discovery, manifest construction, marker/take mutations, and cursor navigation in REAPER Lua.
- Reading a project's track and item metadata does not need REAPER at all: the Go `tracks` package parses the `.rpp` file directly, so the [Tracks](../utilities/tracks.md) list in the audio engine panel works in a standalone launch. The "project discovery in Lua" rule above applies to state only a running REAPER knows (selection, edit cursor, take markers); anything derivable from the saved project file stays in Go.
- The installed launcher resolves its adjacent Wails executable and resource bridge; checkout paths are a development-only fallback.
- The launcher does not read or write ExtState paths. Go resolves the shared layered JSON settings and passes explicit marker colors with the marker-export command.
- Import `NarrationUtils_Launcher.lua` into REAPER's Action list. It starts the non-blocking native Wails workspace and its file-session bridge for REAPER-only operations. There is no loopback server, REST endpoint, browser tab, or port override.
- The workspace is a native Wails window. REAPER launches the executable directly; it does not use a loopback port, REST endpoint, browser tab, or port override.
- For new work, carry REAPER project, track, item, and take GUIDs in the shared finding record; use project-time ranges only as fallbacks.
- The bridge's protocol, commands, reachability heartbeat and test harness are in [the REAPER bridge](reaper-bridge.md). Going to and looping a finding by GUID, with the stale rule and how Stop restores the narrator's time selection and repeat, is in [going to and looping a finding](reaper-navigation.md).
- The app can locate and start `reaper.exe` itself (project-workspace-and-daw-link PRD, Phases 6 and 8): `apps/desktop/internal/daw.LocateReaperExecutable` reads the Windows Uninstall registry key (falling back to the `.rpp` file association), `daw.Resolve` lets a `DAW.reaper_path` Settings override always win, and `daw.Launch` starts it detached - never through the sidecar supervisor's kill-on-close job object, so REAPER outlives the app. The `Host.DawLaunch` binding passes the current project's linked `.rpp`, plus `NarrationUtils_Launcher.lua` as a trailing script argument when the `DAW.auto_start_launcher` Settings toggle is on (owner decision D10, default off): REAPER 6.80+ auto-runs a script argument at startup with the project already open, confirmed on a real REAPER 7.80 ([spike S6](../research/reaper-spike-s6-daw-reachability.md), [ADR 0092](../adr/0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md)).
- Manuscript line identity is stored on items as namespaced extension data and read back through the bridge; see [manuscript-line-identity.md](manuscript-line-identity.md) and [ADR 0026](../adr/0026-manuscript-line-identity-in-item-extension-data.md).
- All mutation actions must be explicitly triggered by the narrator, wrapped in REAPER undo blocks, and report failures without partially applying unrelated actions. Transcript Compare therefore inspects take markers after analysis and only writes its pending findings when the narrator selects **Export markers**.
- Before export, the REAPER adapter marks a finding as already marked when the same active take has a marker within 0.15 seconds with the same case-insensitive issue prefix (`MISREAD:`, `SKIPPED:`, or `EXTRA:`). Export rechecks immediately before every add and reports added and skipped counts. The Review page's approved marker for one accepted finding (`add_finding_marker`, [adding the approved marker](reaper-navigation.md#adding-the-approved-marker)) uses the same rule (`existing_take_marker` in `narration_bridge_core.lua`) and the same name, in one undo block.

## Settings layering

Every user setting is resolved by the Go host through the same layered rules against the same on-disk JSON files, not REAPER ExtState. The Python sidecars receive their settings through their explicit command contracts. Three tiers, most-specific first:

1. Project override - `<project folder>/narration-utils/settings.json` (see Project-sidecar rules below).
2. Per-user global - `%APPDATA%/narration-utils/global-settings.json`.
3. Repo default - `config/defaults.json`, checked in.

REAPER never parses this JSON. The Wails host owns setting resolution and passes marker colors with the explicit marker-export command.

## Project-sidecar rules

- Store generated, reviewable metadata beside the `.rpp` project in a tool-specific folder.
- Do not rewrite source media or make user choices in place. Keep analyzer output, decision state, and cache data distinct.
- Use `<project>/narration-utils/manuscript/manuscript.json` as the common manuscript input. Source DOCX, Markdown, plain-text and EPUB files are copied into the manuscript source folder at explicit import time; runtime tools never parse them. Existing canonical PDF-derived v1 data remains readable, but new PDF import is fail-closed pending corpus parity.
- A project's settings overrides live in one shared sidecar, `<project>/narration-utils/settings.json` (sectioned by tool name), separate from each tool's own generated-output folder - it holds user-set overrides, not analyzer output.
- Findings (the shared record every analyzer emits, [findings-contract.md](findings-contract.md)) live under `<project>/narration-utils/findings/`: one regenerated JSON file per analyzer and scope, plus one shared append-only `review.json` decision history. Only the Go host writes there; `resetDerived` clears the whole folder when the manuscript it is anchored to is replaced or cleared.
- Analysis evidence ([ADR 0100](../adr/0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md)) lives under `<project>/narration-utils/analysis/`: `ledger/` (one record per analyzer run), `cache/` (per-source results such as transcript words) and `coverage/` (the recording coverage service's stored results and, while a check runs, its working folder, [ADR 0128](../adr/0128-the-coverage-service-reads-the-saved-project-keeps-words-per-source-range-and-leaves-model-and-language-out-of-the-parameter-hash.md)); the confirmed track-to-chapter links are `<project>/narration-utils/chapter-track-map.json`. All of it is derived from the saved `.rpp`, never live REAPER state, and `resetDerived` clears it with the findings.
- The narrator's answers to chapter stage suggestions (confirm, dismiss, revert) are an append-only list in `<project>/narration-utils/stage-decisions.json`, keyed by the manuscript's `documentId` and kept beside the chapter status in `manuscript-notes.json`, never inside it ([stage recommendations](stage-recommendations.md#the-narrators-decisions), [ADR 0161](../adr/0161-stage-decisions-live-in-their-own-sidecar-and-confirm-writes-the-record-before-the-status.md)). A file kept for another `documentId` reads as empty, and `resetDerived` deletes it.

## Audacity boundary

- Audacity is a future adapter, not a Lua port. Its closest finding representation is a UTF-8 label track. The layered Python config module and React workspace are DAW-agnostic, so an Audacity adapter reuses them directly.
- Use its optional `mod-script-pipe` only from a local desktop process and only after the user has enabled it.
- **Audacity 3.x only, for now** (owner decision 2026-09-23). Audacity 4.0.0 ships without the Macro Manager and the scripting pipe, and every pipe-based phase of the [PRD](../prds/audacity-integration.prd.md) needs that pipe. Revisit when a 4.x release restores it ([launcher feasibility note](../research/audacity-launcher-feasibility.md)).
- **The launcher is a Start Menu entry, not an Audacity artifact** ([ADR 0145](../adr/0145-the-audacity-launcher-is-an-installer-start-menu-entry-and-a-picker-switch-keeps-an-audacity-launch.md), PRD Phase 10). Nothing Audacity loads can start a program: no macro or scripting command does it, and Audacity compiles Nyquist's `system` as a stub. So the installer's "Narration Utils for Audacity" entry starts `narration-utils.exe` with exactly `--daw Audacity`, and the narrator picks the project in the app. `ProjectSwitch` keeps an Audacity launch's label, where every other launch becomes `Standalone` (`pickerSwitchDAW`, `apps/desktop/bindings.go`), so the picked project opens with the Audacity adapter. No Audacity-side file ships, and `scripts/release/installer.test.mjs` pins the entry.
- First adapter scope: import findings as labels, navigate/export reviewed labels, and preserve the DAW-neutral finding data. Take management has no direct Audacity equivalent.
- **`--daw Audacity`** ([ADR 0144](../adr/0144-a-launch-names-its-daw-with-daw-and-an-audacity-launch-opens-no-reaper-bridge.md), PRD Phase 5). The app accepts it the way the REAPER launcher passes `--daw REAPER`; `dawport.Classify` is the only reader of the label (case-insensitive; anything but REAPER or Audacity selects nothing). An Audacity launch opens no REAPER file bridge even if a `--session-dir` is passed, its review workflow refuses every request with "Audacity support is not available yet. …" until the pipe client (Phase 4) lands, and it resolves the three settings tiers below with no Audacity-specific code (proved by `apps/desktop/audacity_test.go` and `libs/python/tests/test_config_audacity.py` on an `.aup3` project with no `.rpp`).

## The DAW port

Every DAW action reaches an engine through `apps/desktop/internal/dawport` ([ADR 0300](../adr/0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md); the DAW port PRD, deleted and delivered), which replaced the narrower `dawadapter.Review` seam [ADR 0143](../adr/0143-the-review-workflow-calls-a-daw-through-dawadapter-and-the-event-vocabulary-is-part-of-the-contract.md) introduced for the review workflow alone; `internal/dawadapter` is retired (Phase 8). An adapter per engine — `dawport/reaper` today, `dawport/audacity` as a declaration only until its pipe client exists — declares a `port.Level` for each capability and implements one small role interface for every capability it has (`ReviewSession` is the review workflow's role, `dawadapter.Review` before P8). A `dawport.Resolver` alone decides what is usable right now, from that declaration, runtime reachability and the narrator's per-capability `DAW.capability.<name>` toggle.

| Capability | Role interface | REAPER's level today |
| --- | --- | --- |
| `review` | `ReviewSession` | Supported |
| `navigate` | `Navigator` | Supported |
| `markers` | `MarkerWriter` | Supported |
| `pickups` | `PickupList` | Supported |
| `line_identity` | `LineStamper` | Supported |
| `render_config` | `RenderConfigurer` | Supported |
| `cleanup_tools` | `CleanupLauncher` | Supported |
| `retake_lanes` | `RetakeLanePicker` | Supported |
| `project_state` | `ProjectStateReader` | Supported |
| `take_create` | `TakeCreator` | Supported |
| `heartbeat` | `Heartbeat` | Supported |
| `project_read` | `ProjectReader` | Supported (works offline, REAPER closed) |
| `track_state` | `TrackStateReader` | Experimental |
| `track_select` | `TrackSelector` | Experimental |
| `record` | `Recorder` | Experimental |
| `punch` | `Puncher` | Experimental |
| `regions` | `RegionWriter` | Experimental |
| `takes` | `TakeSelector` | Experimental |
| `fx_chains` | `FXManager` | Experimental |
| `silence_trim` | `SilenceTrimmer` | Experimental (built, not yet wired to a binding) |
| `item_gain` | `GainAdjuster` | Experimental (built, not yet wired to a binding) |
| `render_with_fx` | `FXRenderer` | NotYetAvailable (declared for the mastering port's `daw` row, [ADR 0306](../adr/0306-mastering-is-a-provider-port-and-measurement-stays-one-in-process-judge.md); the only role that makes the engine render, each render on the narrator's approval) |
| `master_chain_read` | `MasterChainReader` | NotYetAvailable (declared with `render_with_fx`: lists the track and master FX a render would run) |

- **Requests in, events out**, unchanged from ADR 0143: an asynchronous role's method only hands a request to the engine and returns an error when it could not be sent; the answer arrives later as an event tagged with the run ID. `dawport.Event` and `Subscription` alias the bridge's own types, so the event tags and fields in `internal/bridge/wire.go` stay part of the contract: a second adapter reports the same events rather than the service growing a second parser.
- **No consumer holds the concrete bridge client any more.** Every package that used to keep `*bridge.Client`/`*bridge.Actions` now takes a role from a `dawport.Resolver` through `dawport.Role[T]` instead (DAW port PRD Phases 5a-5d); only `internal/bridge` (the transport) and `dawport/reaper` (the one adapter that wraps it) still hold it. Only `dawport` itself, the composition root (`app.go`'s `configureLocked`, which alone picks the launch's adapter and transport by kind) and the picker switch (`pickerSwitchDAW`, `apps/desktop/bindings.go`) still branch on a DAW's kind or label — everything else asks the resolver for a capability. `internal/dawport/boundary_test.go` enforces both rules with a small, named exceptions list that shrinks as the remaining ones are retired.
- **Per-capability toggles replace the one switch.** `DAW.capability.<name>` (`auto | on | off`, append-only in `config/defaults.json`) lets the narrator turn on one capability without the rest: `auto` means on when Supported, and on when Experimental only while the old `DAW.experimental_reaper_actions` switch (still read) is also on. Promoting a verified REAPER command from Experimental to Supported (the booth actions enablement PRD, after the owner's REAPER verification pass) is then a one-line change to `dawport/reaper`'s declaration, not a new caller change.
- **The UI reads one binding and one event.** `Host.DawCapabilities()` and `daw_capabilities_changed` carry `{daw, reachable, capabilities: {<name>: {level, available, reason?, message?}}}` (`apps/ui/src/api/schemas/daw.ts`); a control never words its own refusal, reading `CapabilityGate`/`useCapability` instead ([design-system.md](../design/design-system.md#primitive-components)).
- **The REAPER review session** (`dawport/reaper`'s unexported `review` type, `review.go`) puts exactly the bridge command a request needs: `prepare_compare`, `inspect_compare_results`, `jump_to_compare_marker`, `export_compare_markers`, answered by `COMPARE_PREPARED`, `COMPARE_MARKER` per finding then `COMPARE_INSPECTED`, no event, and `COMPARE_EXPORT_MARKER` per finding then `COMPARE_EXPORTED` respectively — unchanged from ADR 0143's `dawadapter.Reaper`. On an Audacity launch, `dawport/audacity.UnavailableReview()` refuses every request with ADR 0144's sentence instead.
- **Construction.** In `configureLocked`, the host picks the review session by the launch's `--daw`: `reaper.ReviewFor(client)` (nil for a standalone launch, since there is no bridge to wrap) unless the launch is Audacity, which gets `audacity.UnavailableReview()` regardless. `transcript.NewWithReview` builds the service over whichever session that is; `internal/transcript/adapter_test.go` runs the whole review loop against a fake `dawport.ReviewSession`.
- **Take management** (take creation, pickups, line identity, render setup) has no Audacity equivalent (see "Audacity boundary" above); rather than being absent from the port, those roles are simply `NotYetAvailable` on the Audacity adapter, like every other capability it does not implement yet.
- **Not yet in the interface.** Marking a finding reviewed and exporting the reviewed set have no REAPER command today; they are added to `ReviewSession`, with a REAPER implementation, when those phases land.

## Acceptance criteria

- A REAPER adapter can navigate, loop, and add an approved marker from a valid finding. (Built: review dashboard PRD Phases 6 to 8; the checks in REAPER for the marker and from the Review page are pending with the owner, [checklist](reaper-navigation.md#manual-verification-checklist).)
- Failure to resolve a stale GUID produces a reviewable warning and does not operate on an adjacent item.
- Audacity planning never requires REAPER ExtState or take-marker semantics.

## The DAW catalog and "Get it" flow

Upstream of everything else on this page: a first-time narrator has no DAW installed yet, and nothing above helps
until one exists on the machine. `apps/desktop/internal/dawcatalog` (Go) answers, on demand, whether a supported
DAW appears to be installed, and Settings' global-scope **DAW Integration** category shows that fact with a way to
get the DAW and a way to re-check after installing it. The app never downloads, verifies, bundles, or executes a
DAW installer — it only opens the vendor's own download page in the narrator's default browser and reads
registry/filesystem state.

**Catalog.** `dawcatalog.Catalog` is a Go literal — today just `dawcatalog.REAPER` (name, publisher, one neutral
licensing line, and `reaper.fm`'s own download-page URL) — never loaded from a file or fetched at runtime, so the
destination of every "Get it" click is auditable in code review. Audacity has no entry yet: it is deferred until
`docs/roadmap.md`'s own precondition (a proven shared contract and REAPER workflow) is met, to avoid advertising a
capability with no working adapter behind it.

**Detection.** `dawcatalog.Detect`/`DetectAll` run on demand, never polled, behind a fakeable `Detector` interface.
The Windows lookup is `apps/desktop/internal/daw.LocateReaperExecutable` — the same registry-then-file-association
locator `project-workspace-and-daw-link` Phase 6 built and verified against a real REAPER install (ADR 0092) — so
this package answers "is a supported DAW here" with the identical fact that PRD's launcher already resolves,
instead of a second, possibly-drifting lookup. A portable REAPER install that never registers itself is a soft
false negative: the narrator can still use "Get REAPER" or their own copy, and nothing here blocks any feature on
detection (see below).

**The UI.** `Host.DawCatalogList()` returns the catalog plus each entry's live detection state; `Host.DawCatalogOpenDownloadPage(id)` looks the id up server-side in `dawcatalog.Catalog` and calls `runtime.BrowserOpenURL` — the id, not a URL, crosses the Wails boundary, so nothing UI-supplied can pick an arbitrary destination (the same trusted-URL discipline `update.go`'s `openReleaseNotes` already uses for release notes). `DawCatalogPanel` (`apps/ui/src/components/settings/DawCatalogPanel.tsx`), shown in Settings' global-scope DAW Integration category:

- Lists each entry with a detected/not-detected dot and its publisher/licence line.
- Offers a **"Get `<name>`"** button on an undetected entry, which opens the vendor's download page; the button
  disables and reads "Opening…" while the browser call is in flight, so a narrator cannot open two tabs.
- Offers a **"Check again"** button that re-runs the same detection call the panel's mount already makes (one call
  site, two triggers — the same pattern `LocalAssets`' mount-plus-"Try again" uses), reading "Checking…" and
  disabled meanwhile, so a narrator who just installed a DAW sees it detected without leaving Settings.
- Offers a **"Link a REAPER project file"** handoff button on a detected-but-not-yet-linked entry, which calls the
  one shared `linkDawFile()` action Settings' project-scoped DAW panel, and the audio engine panel
  already use (`project-workspace-and-daw-link.prd.md`, W19) — no separate binding, no new file dialog. It is
  hidden once a project is already linked, since it would have nothing left to offer.

**What detection does not do.** It never gates a feature: Tracks and Proofing are still gated on a *linked* project
file (see above), not on whether a DAW was *detected*. This keeps the two facts — "is a DAW on this machine" and
"is a DAW file linked to this project" — from becoming a second, redundant gate a narrator has to satisfy twice.

**Trust boundary.** Registry/filesystem inspection to detect third-party software and opening a browser to a
hardcoded, compile-time URL are both covered in [the threat model](threat-model.md); the URL's spoofing risk is nil
because it is a Go constant, never derived from anything the narrator or network supplies.
