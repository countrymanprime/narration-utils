# Codebase map

Narration Studio names every top-level folder for the role of what is in it, and keeps its stable launch
and integration paths while organizing implementation around the product domain that owns its behavior.
The decision and the old-to-new path map are in
[ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md).

## Repository layout

```text
apps/
  desktop/        Go/Wails desktop host (app.go, bindings*.go, internal/, cmd/, build/: icons and the Windows setup program definition)
  ui/             React + Tailwind app; its tests/ hold the Playwright visual and atlas suites
sidecars/         Python programs frozen into the app and run on demand
  manuscript-guide/  manuscript-teleprompter/  transcript-compare/   (each: core/ CLI backend, tests/)
libs/
  python/         narration_common, the cross-tool Python contracts
integrations/
  reaper/         REAPER launcher and Lua bridge
  audacity/       placeholder notes for a future Audacity driver
config/           shipped JSON: defaults, asset catalogs, roadmap
tests/
  fixtures/       manuscripts and other data used by tests across projects
tools/
  docs-site/      the public docs site: MkDocs config, include list and link hooks; reads docs/ in place
scripts/          repo automation, release and CI tooling
docs/             documentation, ADRs and PRDs
```

Only these entries may exist at the repository root. `scripts/ci/layout.test.mjs` runs in `pnpm check` and fails
on any other top-level entry, or on a tracked file that still names a retired path; the allowlist and the
old-to-new path map live in `scripts/ci/layout.json`.

### Where tests go

Tests follow the toolchain. Colocate them where the toolchain wants that: Go `_test.go` beside the package,
Vitest `*.test.tsx` beside the component, Storybook stories beside the primitive, `node:test` files beside
the script. Otherwise a project has one `tests/` folder at its root (`libs/python/tests`,
`sidecars/<name>/tests`, `scripts/release/tests`). The Playwright visual, atlas and aria suites live in
`apps/ui/tests`, one folder each, because they drive the whole app or the whole Storybook rather than one file. Data shared by several
projects lives in `tests/fixtures`. Go code and tests name repo-relative locations through
`apps/desktop/internal/layout`, and `scripts/release/prepare-resources.py` keeps its own constants, so the
next move is a one-line change in each.

### Projects

Every folder above except `docs/` is an Nx project with a `project.json`; `pnpm check` and CI run their
`lint`, `format`, `test` and `build` targets, and CI runs only the projects a change affects. See
[Nx projects and the quality gate](../operations/ci-and-releases.md#nx-projects-and-the-quality-gate).

## Stable boundaries

- `apps/desktop/` is the Go/Wails desktop host, on Wails v3 beta ([ADR 0200](../adr/0200-the-desktop-shell-runs-on-wails-v3-beta-pinned-at-v3-0-0-beta-25.md)). It exposes generated, typed Wails
  bindings and native events only; it has no loopback HTTP surface, port, or
  browser fallback. `main.go` creates the application and its one window, and every other call into Wails
  (events, the window, file dialogs, the browser, quitting) goes through `wailsapp.go`. Its Go module path is still
  `github.com/countrymanprime/narration-utils/shell`; nothing imports it.
- `apps/ui/` is the React application. It communicates only through the
  typed API facade; feature components do not import HTTP transport code.
- `sidecars/*/core/` remain stable Python CLI entrypoints for DAW integrations.
- `integrations/reaper/` is the REAPER-only bridge. Its field order and protocol are
  compatibility contracts. A checkout finds the sidecars, catalogs and launcher relative to
  `integrations/reaper` (two levels up is the repo root); packaged builds use `resources/`.
  `integrations/reaper/tests/` is the Lua bridge harness (see [the REAPER bridge](reaper-bridge.md)).
- `libs/python/narration_common/` contains only cross-tool contracts such
  as canonical manuscript access, settings, logging, progress, and bridge
  encoding, and `narration_common/ports`, the provider ports' Protocols, registries and conformance suites
  (see [provider ports](provider-ports.md)), and `narration_common/recording`, the format of a recorded take (a PCM WAV
  that never overwrites a file) and the engine-neutral recorder any capture row records through
  ([ADR 0357](../adr/0357-the-built-in-recorders-capture-engine-is-a-wasapi-shared-mode-row-of-the-capture-port-through-portaudio-in-the-sidecar.md)).
  Feature-specific analysis stays with its tool.

## How the parts connect

Everything runs on the narrator's machine. The only things that leave it are the three boxes at the bottom, and each is a request the narrator can see and switch off, except the fonts, which are a known finding ([#238](https://github.com/countrymanprime/narration-utils/issues/238)). The diagram is a container view: one box per running thing or store, one arrow per call that crosses a boundary; the table under it says what each arrow is. The [threat model](threat-model.md) walks the same boundaries one by one, and the flows that need a sequence are drawn beside the doc that owns them.

```mermaid
flowchart LR
  ui["apps/ui<br/>React app in the<br/>WebView2 webview"]
  subgraph host["narration-utils.exe: apps/desktop (Go, Wails)"]
    bindings["bindings*.go<br/>typed bindings"]
    services["h.services()<br/>manuscript, guide,<br/>settings, transcript,<br/>teleprompter"]
    assets["internal/assets"]
    update["internal/update"]
    supervisor["internal/process<br/>Supervisor"]
    bridgeclient["internal/bridge<br/>(every DAW action goes<br/>through internal/dawport)"]
    media["media.go<br/>/media route"]
  end
  subgraph sidecars["sidecars/ (frozen Python)"]
    guide["manuscript-guide"]
    compare["transcript-compare"]
    teleprompter["manuscript-teleprompter"]
  end
  lua["integrations/reaper<br/>Lua bridge inside REAPER"]
  rpp[("REAPER project<br/>.rpp and its audio")]
  project[("project folder<br/>narration-utils/")]
  cache[("user cache<br/>assets/, update/, runtime/")]
  session[("session folder<br/>commands/, events.log")]
  huggingface["Hugging Face"]
  github["GitHub"]
  ui --> bindings
  ui --> media
  bindings --> services
  bindings --> assets
  bindings --> update
  services --> supervisor
  services --> bridgeclient
  supervisor --> guide
  supervisor --> compare
  supervisor --> teleprompter
  guide --> project
  compare --> project
  compare --> cache
  teleprompter --> cache
  bridgeclient --> session
  lua --> session
  media --> rpp
  lua --> rpp
  services --> rpp
  assets --> cache
  assets --> huggingface
  assets --> github
  update --> github
  update --> cache
  services --> project
  classDef offmachine stroke-dasharray: 5 5
  class huggingface,github offmachine
```

| Arrow | What it is | Read more |
| --- | --- | --- |
| `apps/ui` to `bindings*.go` | One Wails binding call per action through the generated `apps/ui/wailsjs/` TypeScript (`pnpm --dir apps/desktop run bindings`), a JSON string back; events (`teleprompter:event`, `teleprompter:state`, `transcript:state`, `coverage:state`, `job:ended`, `update:status`, `system:*`) go the other way | [wire contracts](wire-contracts.md) |
| `apps/ui` to `media.go` | The webview asks `/media` for a track's audio (Range requests); the route serves only a source file that the current project's `.rpp` names | [ADR 0012](../adr/0012-media-route-for-track-playback.md) |
| `services` and `media.go` to the project file | The host reads the `.rpp` (tracks, items, source files) and never writes it; REAPER's own Lua bridge changes the project (markers, regions, item data), one undo block per command | [Tracks](../utilities/tracks.md) |
| `services` to `internal/process` to a sidecar | `exec.CommandContext` with an argv slice, no shell, inside a Windows Job Object; results come back on stdout (NDJSON for the teleprompter) and in files | [ADR 0022](../adr/0022-live-sidecar-events-over-wails-and-stop-file.md) |
| sidecars to the stores | Read the manuscript and write results in the project folder; load a model with `--model-dir` from the user cache, local files only | [first-use provisioning](first-use-dependency-provisioning.md) |
| `internal/bridge` and `integrations/reaper` to the session folder | The host writes `commands/NNNNNNNN.cmd` atomically; the Lua bridge appends `events.log`; nothing listens on a socket | [the REAPER bridge](reaper-bridge.md) |
| `internal/assets` to Hugging Face and GitHub | Pinned URLs, size and SHA-256, staging then rename, only after the narrator confirms | [first-use provisioning](first-use-dependency-provisioning.md) |
| `internal/update` to GitHub | The release list once a day at most; a download only after two clicks; the program is replaced on Windows | [in-app update](in-app-update.md) |

The settings, the recents list and the host log live in `%APPDATA%/narration-utils`, beside the user cache (`%LOCALAPPDATA%/narration-utils`); `services` reads and writes them and no arrow is drawn for it. *Verified 2026-09-21 against `apps/desktop/app.go` (`configureLocked`, `packagedResources`), `bindings.go`, `bindings_assets.go`, `media.go`, `internal/process/`, `internal/bridge/`, `internal/assets/`, `internal/update/`, `integrations/reaper/NarrationUtils_Launcher.lua` and `apps/ui/index.html` (the fonts are bundled since #238, so the webview asks no other host). A box names the folder or file that owns it, a dashed arrow or box is a request the narrator did not ask for or a host that is not ours, and a label names the mechanism, not the intent.*

## Go host ownership

`apps/desktop/bindings.go` is the auditable generated-Wails binding index. The native app does not expose HTTP routes.

Every binding reads the project-scoped services (manuscript, Story Bible, settings, transcript, teleprompter) through `h.services()` in `apps/desktop/services.go`, never off the `Host` directly, because a project switch replaces them; `hostguard_test.go` fails `go test` otherwise. The asset registry (voices, Whisper and spaCy models) is not project-scoped: it is built once at start and never replaced, so the asset bindings read it without a snapshot. See [host binding concurrency](host-binding-concurrency.md).

- `system` owns health, bootstrap, settings, diagnostics, and shutdown.
- `manuscript` owns canonical text, reader state, notes, and import jobs.
- `story_bible` owns guide entities, relationships, audio preview, and build jobs.
- `transcript` owns comparison lifecycle, review results, and marker export.
- `tts` owns the approved voice catalog (`config/tts-assets.json`) and the Piper preview voices; `whisper` owns the transcription model catalog (`config/whisper-assets.json`) and `spacy` the Story Bible language model catalog (`config/spacy-assets.json`). None of them downloads anything itself: each is a catalog on top of the asset manager below.
- `assets` (`internal/assets`) is the one lifecycle every downloadable asset shares: install into a staging folder, verify size and SHA-256, rename into place, resume, repair, verify and remove, with a manifest in each install folder, the free-space check, archive unpacking and the cache location. See [first-use dependency provisioning](first-use-dependency-provisioning.md) and [ADR 0078](../adr/0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md).
- The host files that put the asset manager in front of the UI: `assetcache.go` (the per-user cache location, stale-staging cleanup, and the registry built once at start), `assetregistry.go` and `assetproviders.go` (one provider per kind of asset: voices, Whisper models, spaCy models; [ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md)), `bindings_assets.go` (`AssetsList`, `AssetsInstall`, `AssetsInstallState`, `AssetsInstallCancel`, `AssetsVerify`, `AssetsRemove`), `installjobs.go` (the one install job every asset uses, with real bytes; a second start joins the running job; [ADR 0077](../adr/0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md)) and `jobs.go` (the `job:ended` event every host job finishes with). `guidegate.go` is the Story Bible first-use gate: it decides whether a build gets an installed spaCy model, must ask first (`asset_required`) or runs rules-only this once ([ADR 0080](../adr/0080-the-story-bible-language-model-is-a-catalog-asset-unpacked-at-install-and-the-build-asks-before-it-downloads.md)).
- `update` (`internal/update`, with `update.go`, `update_job.go`, `update_install.go` and `bindings_update.go` in the host) checks GitHub for a newer release of this repository at most once a day (two hours after a failed check), downloads and stages one only after a click, and on Windows replaces the running program ([in-app update](in-app-update.md)). `version.go` holds the stamped version.
- `smoke.go` is the packaged-app smoke test, `narration-utils --smoke`: it runs before the window exists, checks what a release carries and exits non-zero on a failure ([CI and releases](../operations/ci-and-releases.md#the-packaged-app-smoke-test)).
- `apps/desktop/cmd/seed-assets` is the developer-only seeding command behind `pnpm run assets:seed`; it installs approved catalog assets into the same per-user cache through the same managers. `cmd/manuscript-import` is the standalone importer entry point, and `cmd/narration-utils/` holds only the embedded UI bundle and sidecar resources that the release build fills in.
- `apps/desktop/build/windows/installer/project.nsi` is the Windows setup program definition (NSIS, per user; [ADR 0082](../adr/0082-windows-installs-per-user-from-an-nsis-setup-program-that-wails-builds-and-the-release-carries-beside-the-update-zip.md)). Wails regenerates the rest of `build/windows/` on every build.
- `tracks` owns reading a project's `.rpp` file (discovery, selection, track/item metadata). `apps/desktop/media.go` serves those tracks' audio to the webview through the asset server's `/media` route (see [ADR 0012](../adr/0012-media-route-for-track-playback.md)); it is the only non-frontend content the asset server serves.
- `findings` implements the [findings contract](findings-contract.md) record (validation, stable IDs, review state); analyzers emit it without importing REAPER APIs. The `Findings*` bindings (`apps/desktop/bindings_findings.go`) serve Proof, `apps/ui/src/components/proof/` (`ProofPage`), which lists, filters and decides them; `bindings_navigation.go` lets it go to and loop a finding in REAPER through `bridge.Navigator`, and `bindings_marker.go` add one approved take marker for an accepted finding.
- `stages` holds the chapter stage recommendations contract: the tri-state `Signal`, the `Provider` interface signal owners implement, the pure engine that turns a chapter's required signals into a suggestion the narrator confirms, and the service that keeps the narrator's confirmations, dismissals and reverts in `narration-utils/stage-decisions.json` and sets a confirmed status through the manuscript (see [stage recommendations](stage-recommendations.md), [ADR 0160](../adr/0160-stage-recommendations-are-computed-from-tri-state-signals-by-a-pure-engine.md) and [ADR 0161](../adr/0161-stage-decisions-live-in-their-own-sidecar-and-confirm-writes-the-record-before-the-status.md)). The host builds the service per project and `bindings_stages.go` reaches it (`StageRecommendations`, `StageConfirm`, `StageDismiss`, `StageRevert`).
- `production` is production tracking (PRD delivered and deleted; `git log --diff-filter=D -- docs/prds/production-tracking.prd.md` finds it; the guide is [Production](../guides/using-the-app/production.md)): the stage timer and its time log in `narration-utils/production/sessions.json`, PFH and the effective rate from logged hours and measured recorded time only ([ADR 0320](../adr/0320-pfh-and-the-effective-rate-come-only-from-logged-hours-and-measured-recorded-time.md)), and `BuildOverview`, the Production page's board, figures and Next up order ([ADR 0404](../adr/0404-production-next-up-ranks-chapters-by-held-back-readiness-then-stage-and-the-deadline-is-shown-not-projected.md)), and `Burndown`, the book's logged hours by day (Phase 6, Could): data only, for a future chart primitive out of this PRD's scope. The host builds the service per project and `bindings_production.go` reaches it (`ProductionOverview`, `ProductionStartTimer`, `ProductionStopTimer`, `ProductionBurndown`); the page is `apps/ui/src/components/production/`.
  `productionreport` builds the Production page's exported status report (Phase 5) from exactly the same `Overview` the page just read plus the plan's milestones: hours by stage, book PFH, the deadline and milestone status, and chapter readiness counts, rendered as JSON and as a self-contained HTML page, deterministic apart from `generated_at`. The contracted amount and effective rate are left out unless the narrator opts in ([ADR 0406](../adr/0406-the-status-report-leaves-out-the-contracted-amount-and-effective-rate-unless-the-narrator-opts-in.md)). The host writes it into `<project>/narration-utils/production/reports/` (`ProductionStatusReport`, `apps/desktop/production_report.go`).
- `measure` reads WAV files (whole, or a source-time `Range` of one) directly and computes loudness, RMS, peaks, noise floor and clipping, plus `Evaluate` against a caller-supplied profile (see [ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md)); its validation against the EBU loudness test set, a test that runs only when `NARRATION_EBU_DIR` is set, is recorded in [delivery-measurement-validation.md](delivery-measurement-validation.md). `MeasureTake` turns one take of a `tracks.Item` into per-category take evidence (clipping, noise, level consistency, duration, pause profile), each measured or unavailable with a reason, and no combined score ([ADR 0140](../adr/0140-take-metrics-are-per-category-evidence-over-a-takes-source-range.md)); the take comparison is its first caller. `MeasureFile` measures a file (or a range) with a context, real progress (`Progress`, the audio bytes read) and the `Fingerprint` of the whole file (size, modified time, SHA-256), and the host runs it over the files the narrator picked as a job (`apps/desktop/measure_job.go`, `MeasurePickFiles/Analyze/State/Cancel`, [ADR 0156](../adr/0156-measurement-reads-only-files-picked-this-session-as-one-job-and-fingerprints-the-bytes-it-read.md)). Master & QC (`apps/ui/src/components/master/`, stage navigation Phase 8; it replaced the Delivery page) starts and follows that job; every answer of it carries each measured file's `delivery_qc` findings, judged by `Evaluate` in the host against the narrator's Delivery settings as they are when it is read (`judgeMeasureJob` in `apps/desktop/delivery_report.go`, [ADR 0155](../adr/0155-settings-gain-a-number-kind-with-a-declared-range-and-delivery-limits-are-the-narrators-own.md)), and the page shows what they say.
  `Diagnose` runs the windowed analyzers in one pass: clip regions, a short-term loudness series and its level shifts, a silence map and its room-tone segments, and the pause profile when transcript timing exists. Their findings (`audio_quality`, and `pacing` only from transcript timing) are candidates against the narrator's thresholds, labelled raw recording or processed render ([ADR 0158](../adr/0158-windowed-diagnostics-are-one-read-pass-with-fixed-windows-narrator-thresholds-and-candidate-findings.md)). The host runs it as a job over the files picked for measuring (`apps/desktop/diagnostics_job.go`, `DiagnosticsAnalyze/State/Cancel`), and Master & QC's Diagnostics section (`apps/ui/src/components/master/DiagnosticsSection.tsx`) lists each file's `Summary` and its findings with their times, values and thresholds, read-only. The same pass also runs the silence cleanup classifier (`internal/measure/cleanup.go`, [ADR 0238](../adr/0238-silence-cleanup-candidates-are-classed-in-the-diagnostics-pass-and-raised-apart-from-the-diagnostics-findings.md)), against the narrator's own thresholds (`Cleanup` settings tool, `apps/desktop/cleanup_settings.go`). It classes silences (from the silence map), breaths and clicks into `Diagnostics.Cleanup`. `CleanupFindings` raises them as `silence_cleanup` findings, each with a `split_and_trim` action that needs confirmation, apart from `Findings`; `diagnostics_job.go` puts them on each file's `CleanupFindings` and the job's `CleanupThresholds`, and Master & QC's Diagnostics section lists them read-only in its "Silence cleanup candidates" panel.
  `deliveryreport` builds Master & QC's exported report (diagnostics PRD Phase 7) from the last measurement and check, the limits, the review store and the installed assets: one model rendered as JSON and as a self-contained HTML page with the same finding IDs, deterministic apart from `generated_at`, with local paths left out unless the narrator includes them. The host writes it into `<project>/narration-utils/delivery/` (`DeliveryExportReport`, `apps/desktop/delivery_report.go`).
- `takecompare` compares the takes of one take-review group: it re-resolves each read in the saved project, runs `compare.py --take-divergence` over the group's span, measures each read with `measure.MeasureTake` and saves one `take_comparison` finding, evidence side by side and never ranked ([ADR 0165](../adr/0165-a-take-comparison-is-one-finding-per-group-over-its-one-span-built-from-the-saved-project-and-never-ranked.md)). The host runs it as a job (`apps/desktop/takecompare_job.go`, `TakeComparisonStart/State/Cancel`); Proof's `TakeComparisonView` shows it.
- `passagetakes` finds the takes of a chapter passage for the workspace's Takes panel and carries out Use this take: from the saved project, the stored alignment and the findings store it lists the other takes of the item the passage was heard on, the other retakes of its line on a fixed-lane track and the reads of a take-review group that has a read on that item, and it chooses one only by an id it offered, through the DAW port (`set_active_take`, `pick_retake_lane`, `create_take`). `takecompare` compares such a passage over its paragraphs (`Request.Passage`), through the same job (`apps/desktop/bindings_workspace_takes.go`, `WorkspaceTakes`, `WorkspaceTakesCompareStart`, `WorkspaceUseTake`; [ADR 0700](../adr/0700-the-takes-panel-lists-a-passages-takes-from-the-saved-project-and-chooses-one-by-an-id-the-host-offered.md)).

- The provider ports ([ADR 0301](../adr/0301-providers-sit-behind-small-ports-with-a-registry-and-a-capability-descriptor.md), [provider ports](provider-ports.md)) are one package each: `asrport` (speech engines, live and batch), `ttsport` (voice engines), `pronunciationport` (pronunciation sources), `captureport` (capture backends) and `encodeport` (encoders and packagers, declared with no rows), each a registry of `port.Registry[P]` rows with a conformance suite in its `<name>porttest` subpackage. `internal/port` is the vocabulary they share with `dawport` (`Level`, `Support`, `NotSupportedError`, `Registry[P]`). Host code asks a registry by the setting's name and never compares provider names; `providerguard_test.go` fails `go test` otherwise. `bindings_providers.go` serves them read-only as `ProviderCapabilities`. The built-in recorder, `internal/recording` ([ADR 0455](../adr/0455-the-built-in-recorder-records-each-take-to-a-partial-file-in-the-projects-recordings-folder-and-links-it-to-its-take-name.md)), records takes into the project's `Recordings` folder through its own `Engine` port, whose sidecar adapter runs the capture port's `wasapi` row by name (`live_asr.py --record --capture wasapi`); `bindings_recording.go` serves it to the Booth.
- `teleprompter` owns one live listening session: it runs the `manuscript-teleprompter` sidecar, relays its events as `teleprompter:event`, publishes phase changes as `teleprompter:state`, and keeps the last `script` and `position` so a page opened mid-session can catch up (see [ADR 0022](../adr/0022-live-sidecar-events-over-wails-and-stop-file.md)). The Booth page (which replaced the Teleprompter page and the Read aloud dialog) lives in `apps/ui/src/components/booth/` (see [ADR 0024](../adr/0024-teleprompter-highlight-follows-the-sidecars-spans.md)).

`apps/desktop/internal/` holds domain services and infrastructure. The Wails binding
surface is operation-specific; it does not accept arbitrary route names.

- `hostlog` is the host's local log (`SystemReportDiagnostic` writes to it); `persist` reads the files the host keeps without failing silently; `contractfile` pins the payloads the host sends for the UI's contract tests. How data is checked where it crosses a boundary is in [wire contracts](wire-contracts.md).

## UI ownership

Every payload the UI receives is validated by a Zod schema in `apps/ui/src/api/schemas/` through `parseWire` (`apps/ui/src/api/wire/`); a new binding, event or persisted file adds its schema and golden payload in the same pull request ([wire contracts](wire-contracts.md)).

Every call the UI makes to the host has a row in a catalog with a verdict against the interaction feedback standard (`apps/ui/src/interactionFeedback.catalog.ts`, checked by `interactionFeedback.test.ts`), so a new call adds its row in the same pull request; a control that starts something slow takes `pending`, and a host job that ends emits `job:ended` ([interaction feedback](interaction-feedback.md)).

The asset UI is `apps/ui/src/components/assets/` (`AssetInstallPrompt` is the first-use dialog every gated feature shows, `AssetFacts` the version, size, publisher, licence and destination it lists, `LocalAssets` and `LocalAssetRow` the Settings > Local assets page) on the `useAssetInstall` hook (`apps/ui/src/hooks/`), which follows one install job to its end for every kind of asset; `api/assetInstallMock.ts` scripts install steps for the mock host ([ADR 0077](../adr/0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md), [ADR 0081](../adr/0081-local-assets-is-a-settings-list-built-from-the-registry-whose-rows-own-their-download-verify-and-remove.md)).

`apps/ui/src/api/contracts/` contains the TypeScript wire contracts by
domain. `types.ts` is a compatibility barrel during migration. New feature
work should import from its owning contract module and keep component-local
state or hooks beside the feature. For example, Story Bible pronunciation
playback lives in `components/storybible/usePreviewAudio.ts`, while editing and
rendering remain in `GuideDetail.tsx`.

## Sidecar boundary

The Python sidecars retain their stable `core` CLI contracts and are frozen
as immutable packaged sidecars. Go supervises them; feature code must not add
a Python server or a browser transport.

A sidecar reaches an engine (Whisper, Moonshine, Piper, CMU, eSpeak, dshow and WASAPI capture) only through an adapter module in its
`core/` (`asr_adapters.py`, `capture_dshow.py`, `capture_wasapi.py`, `asr_batch.py`, `providers.py`) registered in the `narration_common.ports`
registries, and selects it by name through the registry; `libs/python/tests/test_provider_guard.py` fails on a provider name
compared or listed anywhere else ([provider ports](provider-ports.md)).
