# DAW Integration Boundary

**Status: native Wails desktop workspace and REAPER file bridge implemented.**

## REAPER rules

- Keep business logic in Go and user-facing UI in React. The two packaged Python analysis sidecars remain Manuscript Guide and Transcript Compare. Keep only project discovery, manifest construction, marker/take mutations, and cursor navigation in REAPER Lua.
- Reading a project's track and item metadata does not need REAPER at all: the Go `tracks` package parses the `.rpp` file directly, so the [Tracks](../utilities/tracks.md) page works in a standalone launch. The "project discovery in Lua" rule above applies to state only a running REAPER knows (selection, edit cursor, take markers); anything derivable from the saved project file stays in Go.
- The installed launcher resolves its adjacent Wails executable and resource bridge; checkout paths are a development-only fallback.
- The launcher does not read or write ExtState paths. Go resolves the shared layered JSON settings and passes explicit marker colors with the marker-export command.
- Import `NarrationUtils_Launcher.lua` into REAPER's Action list. It starts the non-blocking native Wails workspace and its file-session bridge for REAPER-only operations. There is no loopback server, REST endpoint, browser tab, or port override.
- The workspace is a native Wails window. REAPER launches the executable directly; it does not use a loopback port, REST endpoint, browser tab, or port override.
- For new work, carry REAPER project, track, item, and take GUIDs in the shared finding record; use project-time ranges only as fallbacks.
- The bridge's protocol, commands, reachability heartbeat and test harness are in [the REAPER bridge](reaper-bridge.md).
- The app can locate and start `reaper.exe` itself (project-workspace-and-daw-link PRD, Phases 6 and 8): `apps/desktop/internal/daw.LocateReaperExecutable` reads the Windows Uninstall registry key (falling back to the `.rpp` file association), `daw.Resolve` lets a `DAW.reaper_path` Settings override always win, and `daw.Launch` starts it detached - never through the sidecar supervisor's kill-on-close job object, so REAPER outlives the app. The `Host.DawLaunch` binding passes the current project's linked `.rpp`, plus `NarrationUtils_Launcher.lua` as a trailing script argument when the `DAW.auto_start_launcher` Settings toggle is on (owner decision D10, default off): REAPER 6.80+ auto-runs a script argument at startup with the project already open, confirmed on a real REAPER 7.80 ([spike S6](../research/reaper-spike-s6-daw-reachability.md), [ADR 0092](../adr/0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md)).
- Manuscript line identity is stored on items as namespaced extension data and read back through the bridge; see [manuscript-line-identity.md](manuscript-line-identity.md) and [ADR 0026](../adr/0026-manuscript-line-identity-in-item-extension-data.md).
- All mutation actions must be explicitly triggered by the narrator, wrapped in REAPER undo blocks, and report failures without partially applying unrelated actions. Transcript Compare therefore inspects take markers after analysis and only writes its pending findings when the narrator selects **Export markers**.
- Before export, the REAPER adapter marks a finding as already marked when the same active take has a marker within 0.15 seconds with the same case-insensitive issue prefix (`MISREAD:`, `SKIPPED:`, or `EXTRA:`). Export rechecks immediately before every add and reports added and skipped counts.

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

## Audacity boundary

- Audacity is a future adapter, not a Lua port. Its closest finding representation is a UTF-8 label track. The layered Python config module and React workspace are DAW-agnostic, so an Audacity adapter reuses them directly.
- Use its optional `mod-script-pipe` only from a local desktop process and only after the user has enabled it.
- **Audacity 3.x only, for now** (owner decision 2026-09-23). Audacity 4.0.0 ships without the Macro Manager and the scripting pipe, and every pipe-based phase of the [PRD](../prds/audacity-integration.prd.md) needs that pipe. Revisit when a 4.x release restores it ([launcher feasibility note](../research/audacity-launcher-feasibility.md)).
- **The launcher is a Start Menu entry, not an Audacity artifact** ([ADR 0145](../adr/0145-the-audacity-launcher-is-an-installer-start-menu-entry-and-a-picker-switch-keeps-an-audacity-launch.md), PRD Phase 10). Nothing Audacity loads can start a program: no macro or scripting command does it, and Audacity compiles Nyquist's `system` as a stub. So the installer's "Narration Utils for Audacity" entry starts `narration-utils.exe` with exactly `--daw Audacity`, and the narrator picks the project in the app. `ProjectSwitch` keeps an Audacity launch's label, where every other launch becomes `Standalone` (`pickerSwitchDAW`, `apps/desktop/bindings.go`), so the picked project opens with the Audacity adapter. No Audacity-side file ships, and `scripts/release/installer.test.mjs` pins the entry.
- First adapter scope: import findings as labels, navigate/export reviewed labels, and preserve the DAW-neutral finding data. Take management has no direct Audacity equivalent.
- **`--daw Audacity`** ([ADR 0144](../adr/0144-a-launch-names-its-daw-with-daw-and-an-audacity-launch-opens-no-reaper-bridge.md), PRD Phase 5). The app accepts it the way the REAPER launcher passes `--daw REAPER`; `dawadapter.Classify` is the only reader of the label (case-insensitive; anything but REAPER or Audacity selects nothing). An Audacity launch opens no REAPER file bridge even if a `--session-dir` is passed, its review workflow refuses every request with "Audacity support is not available yet. …" until the pipe client (Phase 4) lands, and it resolves the three settings tiers below with no Audacity-specific code (proved by `apps/desktop/audacity_test.go` and `libs/python/tests/test_config_audacity.py` on an `.aup3` project with no `.rpp`).

## The DAWAdapter seam

The review workflow (`apps/desktop/internal/transcript`, Transcript Compare) reaches a DAW only through `apps/desktop/internal/dawadapter.Review` ([ADR 0143](../adr/0143-the-review-workflow-calls-a-daw-through-dawadapter-and-the-event-vocabulary-is-part-of-the-contract.md), [Audacity integration PRD](../prds/audacity-integration.prd.md) Phase 3). The REAPER bridge is its first implementation; the planned Audacity pipe client (`internal/audacitybridge`, PRD Phase 4) is meant to be the second.

| `Review` method | What the review workflow asks | REAPER bridge command | Result events |
| --- | --- | --- | --- |
| `PrepareReview(run)` | The selected audio to compare against the manuscript | `prepare_compare` | `COMPARE_PREPARED` |
| `InspectFindings(run, path)` | Which findings the DAW already carries as a marker or label (the reviewed-state signal) | `inspect_compare_results` | `COMPARE_MARKER` per finding, `COMPARE_INSPECTED` |
| `NavigateToFinding(run, id)` | Move the cursor or selection to one finding | `jump_to_compare_marker` | none |
| `ExportFindings(run, path, colors)` | Write the pending findings into the DAW, skipping ones already there | `export_compare_markers` | `COMPARE_EXPORT_MARKER` per finding, `COMPARE_EXPORTED` |
| `Subscribe`, `Dispatch` | Receive what the DAW reported, in order, once | `events.log` fan-out ([the REAPER bridge](reaper-bridge.md)) | `ERROR` for a failed run |

- **Requests in, events out.** Every method only hands a request to the DAW and returns an error when it could not; the answer arrives later as an event tagged with the run ID. `dawadapter.Event` and `Subscription` alias the bridge's types, so the event tags and fields in `internal/bridge/wire.go` are part of the contract: a second adapter reports as the same events rather than the service growing a second parser.
- **Only the review workflow.** Pickups, line identity, project state, render config, take creation and reachability keep `*bridge.Client`. They are REAPER-only, with no Audacity equivalent, and share the same client (so the same event cursor) as the adapter.
- **Construction.** The host builds the service with `transcript.NewWithReview` and `dawadapter.ReviewForDAW(daw, client)`: on an Audacity launch an adapter that answers `ErrAudacityNotAvailable` to every request, otherwise `dawadapter.ReviewFor(client)`, which returns a nil `Review` for a nil client (a standalone launch). `transcript.New` still takes a `*bridge.Client` and wraps it with `ReviewFor`; `internal/transcript/adapter_test.go` runs the whole review loop against a fake adapter.
- **Not yet in the interface.** Marking a finding reviewed and exporting the reviewed set (PRD Phases 7 and 8) have no REAPER command today; they are added to `Review`, with a REAPER implementation, when those phases land.

## Acceptance criteria

- A REAPER adapter can navigate, loop, and add an approved marker from a valid finding.
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
  one shared `linkDawFile()` action Settings' project-scoped DAW panel, the header pill, and the Tracks page
  already use (`project-workspace-and-daw-link.prd.md`, W19) — no separate binding, no new file dialog. It is
  hidden once a project is already linked, since it would have nothing left to offer.

**What detection does not do.** It never gates a feature: Tracks and Proofing are still gated on a *linked* project
file (see above), not on whether a DAW was *detected*. This keeps the two facts — "is a DAW on this machine" and
"is a DAW file linked to this project" — from becoming a second, redundant gate a narrator has to satisfy twice.

**Trust boundary.** Registry/filesystem inspection to detect third-party software and opening a browser to a
hardcoded, compile-time URL are both covered in [the threat model](threat-model.md); the URL's spoofing risk is nil
because it is a Go constant, never derived from anything the narrator or network supplies.
