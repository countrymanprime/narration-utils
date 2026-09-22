# Project Workspace: Projects Directory, New Project Dialog and DAW Project Link

**Supersedes:** the open parts of [ADR 0030](../adr/0030-the-app-starts-without-a-project-and-picks-one-from-recents.md) and `docs/architecture/standalone-launch.md` (decisions 3-5 there: "Create new only makes the folder", recents-only project discovery, launcher unchanged). Those stay valid until a phase here lands and a new ADR supersedes them.
**Source:** user request of 2026-09-19 (items 2 and 3). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet.

## Problem Statement

Two gaps in how the app models a project:

1. **A project is "some folder you browse to".** "Create new" opens a raw folder dialog and calls `MkdirAll` on whatever is chosen; there is no home for projects, no name field, and no way to see existing projects except a 10-entry recents list. A narrator expects the Visual Studio model: a default projects location that is created on first run and can be changed, and a New Project dialog asking for a name and (optionally) a location.
2. **The app does not really know which DAW project file a project belongs to.** The Tracks page is always enabled, guesses the `.rpp` by listing the project folder, and cannot tell whether REAPER has that file open, or start REAPER on it when it cannot be reached.

## Evidence

- **Bootstrap and project switching.** `config` is `apps/desktop/app.go:74-86`; `parseConfigArgs` reads only `--project-folder`, `--project-name`, `--daw`, `--session-dir` (`app.go:435-453`), with no project-file argument. `Bootstrap` (`app.go:560-589`, TS type `apps/ui/src/api/contracts/system.ts:14-25`) carries no DAW project file. `ProjectSwitch` always sets `daw="Standalone"` (`apps/desktop/bindings.go:195-217`, `:202`). `App.tsx:156` shows `ProjectPicker` when `projectFolder` is empty.
- **"Create new" is a folder pick.** `ProjectPicker.tsx:99-104` calls `selectProjectFolder` then `createProject(path)`; `ProjectCreate(path, name)` (`bindings.go:219-227`) does `MkdirAll(path)` and switches, with `path` being the full project folder and `name` an optional label defaulting to `filepath.Base`. The UI asks for no name and no location (`ProjectPicker.tsx:92-104`). ADR 0030 decision 4 records this on purpose and says scaffolding would need a superseding ADR.
- **No projects directory exists.** Nothing in `shell` calls `os.UserHomeDir`. Recents live in `%APPDATA%\narration-utils\recent-projects.json` (`apps/desktop/app.go:100-108`), capped at 10, deduped case-insensitively, silently pruned (`apps/desktop/internal/recents/store.go:18,52,94`).
- **The only DAW-file association today** is `Tracks.selectedRpp` in the project's `narration-utils/settings.json`, written by `tracksSelect` (`apps/desktop/tracks.go:39-56`, save at `:52`). `tracks.Discover` lists top-level `*.rpp` in the project folder only, non-recursively (`apps/desktop/internal/tracks/tracks.go:48-64`); `tracksSelect` refuses any path not in that list; `tracksList` errors when none or several are found (`tracks.go:62-80`). The saved value is an absolute path, so moving the folder invalidates it. `apps/desktop/media.go:51-64` calls `tracksList` on every `/media` request, so the media allowlist follows whatever the association resolves to.
- **REAPER does not pass the project file.** The launcher passes `--session-dir`, `--project-folder` (the rpp's dirname), `--project-name` and `--daw REAPER` (`integrations/reaper/NarrationUtils_Launcher.lua:101-109`, context at `:39-47`); an unsaved project yields an empty folder. The project folder is therefore *defined* as the rpp's folder by the launcher, by Lua `prepare_compare` (`integrations/reaper/narration_ui_bridge.lua:97-103,167`, which writes `TranscriptCompare/` next to the rpp) and by `tracksSelect`. `transcript/service.go:77` and `:371-388` only agree with Lua while the project folder equals the rpp folder.
- **Nothing gates or verifies.** Tracks is `alwaysEnabled` (`apps/ui/src/components/layout/AppShell.tsx:18-28`); `isDisabled` (`:52`) tests only the manuscript; `App.tsx` routes gate only on `data.manuscript` and `/tracks` has no gate (`:216`). No bridge command reports the open project: the dispatcher (`narration_ui_bridge.lua:511-560`) has `prepare_compare`, `inspect_compare_results`, `export_compare_markers`, `jump_to_compare_marker`, `stamp_item_lines`, `read_line_ids`, `create_chapter_regions` and `close`; only `prepare_compare` calls `EnumProjects(-1,'')` (`:97`) and never compares it to the app's project.
- **"Can't reach the DAW" is not detectable.** The session dir arrives only through `--session-dir` (`app.go:169-172`); `bridge.New` just `MkdirAll`s `commands/` (`apps/desktop/internal/bridge/bridge.go:59-64`). There is no handshake, heartbeat or liveness check, so a stale session dir yields a "connected" client nobody reads. The session dir is minted by the Lua launcher per run (`NarrationUtils_Launcher.lua:67`).
- **No code launches REAPER.** The only `os/exec` uses are the Python sidecar supervisor (`apps/desktop/internal/process/supervisor.go`), which on Windows assigns children to a kill-on-close job object (`job_windows.go:14-25`), so REAPER started through it would die with the app. There is no DAW executable setting; Settings "DAW Integration" (`Settings.tsx:179-213`) is static text that says "Connected" even for `Standalone`. Passing a project to REAPER is documented in `docs/research/reaper-automation-surface.md:150` (`reaper.exe <project.rpp>`), not verified here.
- **Settings.** Layers are project (`<project>/narration-utils/settings.json`), global (`%APPDATA%\narration-utils\global-settings.json`) and repo `defaults.json` (`apps/desktop/internal/settings/store.go:135-149,42-48`); `fieldSchemas` (`app.go:673-679`) has five tools and validates only `choice` and `color` (`app.go:718-723`). The TS `kind` union already allows `'text'` (`system.ts:7`). A computed default such as `~/NarrationUtils` cannot live in `defaults.json` (`TestBuiltinDefaultsMatchRepoDefaultsFile`, `store_test.go:9`).
- **Second-launch trap.** A second REAPER launch re-attaches to the rpp's folder with `daw=REAPER` (`onSecondInstance`, `app.go:405-429`), replacing whatever project the user chose whenever the rpp lives elsewhere.
- **Tests and docs that change.** `ProjectCreate` tests `app_test.go:266-289`; the `App.test.tsx:159-172` case asserts Tracks stays enabled without a manuscript; `ProjectPicker.test.tsx:29-60` asserts the old Browse/Create flow; visual rows `project/picker-empty` (`state-catalog.ts:11-16`) and Tracks `rpp-picker`/`no-rpp` (`:107-142`, drivers `app.drivers.ts:360-371`) plus their doc screenshots; `docs/guides/using-the-app/{getting-started,navigation,tracks,settings}.md`, `docs/utilities/tracks.md:15-16`, `docs/architecture/{standalone-launch,daw-integration}.md`. The host binding concurrency work (`docs/architecture/host-binding-concurrency.md`) already made `ProjectCreate` check for a busy host before it creates the folder and require an absolute path; reworking it builds on that.

- **Proofing depends on the DAW bridge and is ungated (added 2026-09-20; user items 16 and 17).** Nothing in the UI reads `daw` except to print it. Proofing is gated only on a manuscript: `AppShell.tsx:23,52`, `App.tsx:169-172,205-214`, the Home card `Home.tsx:339-366` (whose copy, "Ready to compare selected REAPER audio", `:359,363`, is wrong in Standalone). The manuscript gate is copied in four places (`AppShell.tsx:52`, `App.tsx:169`, `App.tsx:199-215`, `Home.tsx:44/339/367`). "Start comparison" is never disabled by DAW state (`Transcript.tsx:374`); failure arrives late as a toast (`:158-169`). The bridge commands are `prepare_compare` (`transcript/service.go:100`), `inspect_compare_results` (`:519`), `export_compare_markers` (`:274`), `jump_to_compare_marker` (`:236`); Lua answers at `narration_ui_bridge.lua:92-172,511-560`. Proofing works only when the project folder equals the rpp folder (`service.go:77,80,371-388`; Lua `:97-107,167-169`).
- **Latent bug the gate would also remove.** `transcript.Service.Start` sets phase `preparing` (`service.go:87-96`) and only then checks `s.bridge == nil` (`:97-99`), returning without `fail()` or `notify()`. The host stays in `preparing`, so a retry says "a comparison is already running", `canAttachLocked` refuses project switches (`app.go:495-500`), and `Reset` refuses while preparing (`service.go:121-127`); only Cancel clears it. No Go test covers a nil bridge. Related nil-guard behavior: `Jump` (`:233`) says "that discrepancy is no longer available" (misleading), `Export` (`:267`) and `finishBackend` (`:515`) call `fail()`, `Drain` (`:283`) is a silent no-op.
- **The Whisper prompt fires before the bridge error.** `TranscriptStart` resolves the model and can return `asset_required` (`bindings.go:373-388`) before calling `Start` (`:394`), so in Standalone a narrator can be asked to download roughly 480 MB and then be told the bridge is unavailable.
- **`daw` is a label, not a capability.** `ProjectSwitch` forces `"Standalone"` but keeps the live `sessionDir` (`bindings.go:201-202`), so an unsaved-REAPER launch followed by a picker choice has a working bridge under a "Standalone" label; `daw:"REAPER"` with a dead session dir looks connected (see "Can't reach the DAW"); a dev launch without `--daw` gives `daw:""` (`app.go:91,439`) and the pill renders as a bare dot. Gating on the string would be wrong in both directions.
- **The header pill** (`AppShell.tsx:142-145`) is a `<span>` with a 7px always-green dot and `{daw}`, no role, focus, tooltip or click handler, and no test (no spec, story or unit test mentions the pill, `Standalone` or `daw`). The mock defaults to `'REAPER'` (`mockApi.ts:108`) and flips only via `attachProject` (`:117-123`), so every screenshot at every viewport shows "REAPER"; restyling the pill regenerates them all. The Settings "DAW Integration" category is `scopes: ['global']` only (`Settings.tsx:19`), so a per-project link control cannot live there without a scope change; it always says "Connected - detected automatically from the running project." (`:185`), even in Standalone, and the launcher card renders only if `runtime.Reaper?.launcherPath` exists (`:138`; the mock's `runtime: {}`, `mockApi.ts:307`, hides it from every capture).
- **"Where everything is stored" (user item 17), in code.** (1) the project folder, defined as the rpp's dirname (launcher `project_context()` `NarrationUtils_Launcher.lua:39-47,66`, Lua `prepare_compare` `:97-98`, Go `tracksSelect` `apps/desktop/tracks.go:39-56`, everything under `config.projectFolder`: `narration-utils/{manuscript,settings.json,manuscript-notes.json}`, `TranscriptCompare/`, `ManuscriptGuide/`, `.narration-last-comparison.json`); (2) `sessionDir`, a REAPER-owned per-launch directory `<REAPER resource path>/NarrationUtils/sessions/hub_<t>` (`Launcher.lua:67-68`) holding `commands/`, `events.log`, manifests, results, progress and logs, not derivable from the rpp; (3) REAPER's resource path, which the app never learns; (4) REAPER's media locations (`RECORD_PATH`, render), referenced only in docs (`reaper-automation-surface.md:52,214`). The app receives paths from REAPER only as `--session-dir`, `--project-folder`, `--project-name`, `--daw REAPER` (`Launcher.lua:101-109`; the rpp itself is discarded) and sends `narration-utils-app-path.txt` (`app.go:258-272`, read at `Launcher.lua:37`) and `commands/NNNNNNNN.cmd` files (`bridge.go:66-80`) back; events return through the append-only `events.log` with one offset (`bridge.go:82-105`). In Standalone `sessionDir` is empty, so the Story Bible build's `guide_progress_*`/`guide_log_*` become relative paths in the process working directory (`app.go:855-856`), while the teleprompter falls back to `os.TempDir()` (`:174-177`).
- **Where the DAW is a dependency (one rule, stated once).** Proofing start, export and jump need a live bridge and project folder == rpp folder; Tracks needs a resolved `.rpp` but no REAPER process; the Settings DAW panel is display only; Manuscript, Story Bible and Teleprompter need nothing but a manuscript; later PRDs (review dashboard, REAPER automation follow-through) will need the bridge. The predicate should be a function of Bootstrap capability flags (linked, reachable), defined once (for example `pageAvailability(page, data)`) and used by all four copies of the gate, not of the `daw` string. Existing PRDs record a user decision that the app must work standalone and Lua work is "Lua-only-for-now" (`chapter-stage-recommendations.prd.md:59,288`), which is consistent with gating only Proofing and Tracks.
- **Tests and states to update for the Proofing gate and the pill:** Go (`app_test.go:163-164,171-193,195-240,266-320,399-410`; note `host.config != before` at `:222,240` requires `config` to stay comparable, so no slice or map fields; new: nil-bridge `Start` must not leave `preparing`, Bootstrap fields, the link binding); UI (`App.test.tsx:107-125` clicks Proofing so the mock default must stay "linked", `:127-139` extend for the DAW reason, `:159-172`, `:174-180`; `NavButton.test.tsx`, `NavButton.stories.tsx:5` duplicates the reason literal; `Transcript.test.tsx`, `TracksPage.test.tsx`, `wailsClient.test.ts`; no `AppShell`, Settings-DAW or pill test exists, add them); visual (`proofing/disabled-button`, `state-catalog.ts:75-80`, is a manuscript-only Home state that by reading lands on the sidebar item at 1440 px and on the Home card at the narrower viewports; add a `?mockNoDaw=1` seam in `main.tsx` and the mock while keeping the default "linked", or every `proofing/*` state and `home/hint-chips` (`app.drivers.ts:112-120`) becomes unreachable; new states for Proofing disabled without a DAW and for the pill; `settings/global-daw` copy changes; `visualSuite.test.ts` and `docScreenshots.test.ts` enforce catalog and driver parity and the `nav-*` doc screenshots contain the pill); docs (`navigation.md:19-20`, `proofing.md`, `tracks.md`, `settings.md`, `docs/utilities/transcript-compare.md`, `docs/utilities/tracks.md:15-16`, `docs/architecture/{standalone-launch,daw-integration}.md`; ADR 0030's consequence at line 21 becomes UI-enforced and needs a superseding ADR; ADR 0031 needs a manual checklist for any new bridge event).

**Answer to "do we store that correlation?"** Partly and fragilely: `Tracks.selectedRpp` (absolute path, only among `.rpp` files inside the project folder) is the only record; the REAPER launcher does not pass the file, recents do not hold it, and nothing checks that REAPER has it open.

## Proposed Solution

Two capabilities that share one new piece of state, a small per-project manifest:

- **Workspace.** A per-user *projects directory* (default `~/NarrationUtils`, created on first run, changeable in Settings) and a **New Project** dialog: name plus location (defaulting to the projects directory), validated inline, replacing the raw folder pick. The picker lists the projects found in the directory as well as recents, and keeps an "open existing folder" escape hatch.
- **DAW link.** The project records its DAW project file (`narration-utils/project.json`, absolute path with a relative fallback; migrated from `Tracks.selectedRpp` or a sole `.rpp` in the folder). Tracks is disabled, with a reason, until a file is linked. The REAPER launcher passes the file (`--project-file`); the app can ask REAPER which project is open and confirm it matches, and (after a spike) start REAPER on the linked file when no live bridge is reachable.

Delivery order: workspace first (independent, lower risk), then the link (storage, gating, launcher), then a spike, then bridge verification and DAW launch.

## Key Hypothesis

We believe a projects directory with a New Project dialog will make creating a project a two-field action and stop projects scattering across arbitrary folders. We believe a stored, checked DAW file link will remove the "which .rpp am I working on" ambiguity and let the app recover when REAPER is not running. We'll know we're right when a new user can create and open a project without touching a folder dialog, Tracks is unreachable exactly when no DAW file is linked, and a mismatch between the open REAPER project and the linked file is reported instead of silently operating on the wrong one.

## What We're NOT Building

- Scaffolding beyond the manifest: the `narration-utils/` sidecar folders stay lazily created (ADR 0030 decision 4 is only amended for the manifest).
- Moving or copying existing projects when the projects directory changes.
- Multiple DAW files per project, or non-REAPER DAWs (macOS/Linux and other DAWs stay out of scope; Windows first per ADR 0030).
- Automatically running the launcher script inside REAPER at startup, or modifying REAPER's configuration (`apps/desktop/app.go:244` states REAPER is never modified automatically); it stays a spike question.
- Cloud sync or a project database.
- Changes to the installer or Start Menu entry (`release-readiness-provisioning-and-docs-site.prd.md`).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| First run creates the projects directory | Exists after first launch, with `USERPROFILE`/`HOME` overridden | Go test with a temp home |
| New project creation | Name-only creation lands in `<projectsDir>/<name>`; collision, illegal-character, reserved-name and unwritable-location errors shown inline | Go table tests plus Vitest and visual states |
| Folder dialog needed to create a project | 0 | Manual run |
| Tracks gating | Nav item and `/tracks` disabled/redirected when no DAW file is linked, with a reason tooltip; enabled once linked | Vitest, visual states at four viewports |
| Existing projects keep working | A project with `Tracks.selectedRpp` or a sole `.rpp` opens with the file linked, no prompt | Go migration tests |
| Association survives launch paths | REAPER launch, second launch and picker attach all resolve the same linked file | Go tests plus manual REAPER checklist |
| Mismatch detection | Open REAPER project differing from the linked file is reported; path compare is case-insensitive and normalized on Windows | Manual REAPER checklist (Lua has no tests) |
| DAW launch | REAPER starts on the linked file and outlives the app | Manual, plus Go test through a fake exec seam |
| Regressions | Transcript Compare still prepares, jumps and exports when the rpp is outside the project folder | Go and manual REAPER checklist |
| Proofing gating | Proofing nav item, route, Home card and Start are unavailable, with a reason, until the capability predicate holds; offline review of the last comparison stays available (Q W16) | Vitest, visual states at four viewports |
| No stuck `preparing` | A comparison can never enter `preparing` without a bridge; the bridge and asset checks run before the Whisper download prompt | Go tests (nil bridge, ordering) |
| One predicate | The four copies of the manuscript gate and the DAW gate are one function of Bootstrap flags | Code review, Vitest |
| The pill | Reads "No DAW detected" (or the DAW name when linked and reachable), is a focusable button, and opens the `*.rpp` dialog | Vitest, visual states |

## Open Questions

- [ ] **W1. Where does the association live?** Options: (a) a new per-project `narration-utils/project.json` (also the natural seat for project name, creation date and a scannable marker for the projects directory); (b) keep `Tracks.selectedRpp` in `settings.json`. Recommendation: (a), with `Tracks.selectedRpp` read once as a migration source.
- [ ] **W2. Absolute or relative path?** Absolute breaks when the project or rpp moves. Options: absolute only; relative to the project folder when inside it, absolute otherwise; store both and prefer the one that exists. Recommendation: store both.
- [ ] **W3. Auto-adopt a sole `.rpp`?** If the project folder holds exactly one `.rpp`, link it silently (no existing project regresses to a disabled Tracks page) or require an explicit choice. Recommendation: auto-adopt for migration and standalone projects; an explicit choice when several exist.
- [ ] **W4. Decouple project folder from rpp folder?** Today they are the same by construction (launcher, Lua, `tracksSelect`, transcript paths). Linking an rpp elsewhere needs: relaxing the `tracksSelect` guard (mind the `/media` allowlist), passing the app's project folder to Lua so `TranscriptCompare/` and the manuscript path resolve correctly, and defining where compare output goes. Recommendation: allow it, but deliver the Lua and transcript changes in the same phase as the guard relaxation. Partially delivered by Phase 5: `project.FindByDawFile` (`apps/desktop/internal/project/match.go`) maps an rpp back to its linked project even when that project's folder differs from the rpp's own folder. `TranscriptCompare`/manuscript path resolution and the `tracksSelect` guard still assume the same-folder construction; that piece is deferred to a follow-up phase, not delivered here.
- [x] **W5. REAPER-launched flow.** Pass `--project-file` from the launcher. How does a second launch find the narration project for an rpp (manifest lookup across the projects directory and recents), and what happens for an unsaved REAPER project (empty rpp)? Recommendation: match by linked file; unsaved projects open the picker with a message. Delivered by Phase 5: the launcher passes `--project-file`; `resolveProjectFile`/`project.FindByDawFile` match it against every project's manifest in the projects directory (not recents); an empty (unsaved) rpp, or one no project has linked, falls through to the existing picker and the host emits a `system:attached` explanatory reason (no UI surface for it added in this phase).
- [ ] **W6. What does "New Project" from inside REAPER do?** The launcher hands over a folder today. Options: keep attaching the rpp's folder as the project (current behavior, gains a manifest), or create a project under the projects directory and link the rpp. Recommendation: the former for existing REAPER sessions, to avoid moving anything.
- [ ] **W7. Projects directory default and changes.** `~/NarrationUtils` on Windows resolves through `USERPROFILE`; OneDrive-redirected or unavailable home folders need a fallback and a non-fatal first-run failure. Changing it moves nothing. Recommendation: global-only setting, a Go-side computed default (not in `defaults.json`), a folder-picker control in Settings (a new `text`/path kind or a bespoke control), and a visible current value in the New Project dialog.
- [ ] **W8. "No need to browse to a raw folder."** Removing Browse leaves REAPER-launched projects and projects outside the directory reachable only through recents (which prune silently, ADR 0030). Recommendation: keep an "Open existing folder..." action, list every manifest-bearing project in the projects directory, and stop pruning unreachable recents silently (mark them unavailable).
- [ ] **W9. `ProjectCreate` semantics.** It changes from "full folder" to "parent plus name". A signature change bumps `hostAPIVersion` (5 in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-41`, `apps/ui/src/hostApi.ts:2`; regenerate `Host.{js,d.ts}`). Options: change the existing binding, or add `ProjectCreateIn(parent, name)` and retire the old one. Recommendation: new binding, one bump.
- [x] **W10. Can the app know REAPER is running and which project is open?** Needs a Lua-side heartbeat or `report_project` event and an event route in the transcript-owned reader (`ReadEvents` has one offset, and `Handle` drops events whose second field is not the current run id). `EnumProjects(-1,'')` returns only the active tab and is empty for unsaved projects. Resolved by the Phase 6 spike: confirmed exactly as described above (real, isolated REAPER 7.80); the recommended mechanism is an `events.log` event with an empty run ID (`events.go`'s existing broadcast), not a new polled file. Not yet wired into the bridge - Phase 7's own work.
- [x] **W11. Where is `reaper.exe`?** No setting exists. Options: a global setting with auto-detect, registry lookup, or `ShellExecute` on the `.rpp` (file association). Launching must be detached, not through the sidecar supervisor's kill-on-close job. Resolved by the Phase 6 spike: the Windows Uninstall registry key's `InstallLocation` works (confirmed against a real install), with the `.rpp` file association as fallback; `apps/desktop/internal/daw` implements auto-detect plus a Settings-override precedence rule. The Settings field and the detached launch itself are Phase 8's work.
- [x] **W12. Can the launcher script start automatically when REAPER is launched by the app?** Without it, a launched REAPER has no bridge until the user runs the action, and the session dir is minted by the launcher (`NarrationUtils_Launcher.lua:67`). REAPER 6.80+ can accept a script argument (`reaper-automation-surface.md:150`, unverified). This conflicts with "REAPER is never modified automatically". Resolved by the Phase 6 spike and the owner: confirmed working (`reaper.exe "<rpp>" "<script.lua>"` auto-runs the script with the project already open); ships behind the D10 Settings toggle, default OFF, in Phase 8.
- [ ] **W13. `daw` semantics.** Today `REAPER` or `Standalone`, and `ProjectSwitch` forces `Standalone`. The UI needs three separate facts: "DAW file linked", "DAW reachable" and "open project matches". Recommendation: model them separately in `Bootstrap` and the header pill.

- [ ] **W14. What does "DAW selected" mean for Proofing?** Options: file linked (a stored fact), bridge reachable (needs a heartbeat, W10), or both. Linked-only still lets the toast happen when REAPER is closed; reachable is not observable today (a stale session dir looks connected). Recommendation: linked is the gate for the UI now; add reachable when the Phase 6 spike lands; define the predicate from Bootstrap flags, never from the `daw` string.
- [ ] **W15. Pill click semantics (item 17).** "Clicking it would allow them to select the DAW's project file to get the path of where everything is stored." Readings: (a) link only: the project folder stays and the rpp is stored, which conflicts with Proofing requiring project folder == rpp folder unless W4's Lua changes land; (b) derive: set the project folder to the rpp's dirname, which attaches a different project, orphans the imported manuscript and needs `canAttachLocked`. Recommendation: in an open project, link and warn or refuse if the folders differ; offer "Open DAW project" in the picker, which derives the folder as the launcher does. Also: "No DAW detected" over-promises, because only the absence of a session dir is knowable; a closed REAPER still reads "REAPER" until a heartbeat exists, so the copy must not imply detection.
- [ ] **W16. What is disabled without a DAW?** The whole Proofing page, or only Start and Export? Offline review of the last comparison is useful ("Last narrated take" link `Transcript.tsx:236-248`, Home "Review latest comparison" `Home.tsx:359-363`); Results already disables export outside an active REAPER session (`Results.tsx:59`) but "Play recorded audio" (`:160-168`) calls `transcriptJump` ungated and errors in Standalone. Recommendation: gate the nav item, the Home card and Start; keep last-comparison review reachable; gate Jump and Export individually.
- [ ] **W17. Reason precedence.** When both a manuscript and a DAW are missing, which tooltip shows? The single shared `MANUSCRIPT_REQUIRED_REASON` (`AppShell.tsx:28`) cannot express it. Recommendation: a combined reason listing what is missing.
- [x] **W18. REAPER-launched with several rpp files in the folder.** The launcher knows the exact rpp but drops it (`Launcher.lua:39-47`); until Phase 5's `--project-file` lands, a "linked" gate would lock Proofing for these users even though REAPER is live. Recommendation: treat a live `--daw REAPER` launch as linked until Phase 5. Delivered: `dawLinkFacts` (`apps/desktop/dawfacts.go`) now takes the launch's `daw` fact and treats `daw == "REAPER"` as linked, so Phase 4's gate does not lock Proofing for a live REAPER session with no manifest link yet.
- [ ] **W19. Where the per-project link control lives.** The pill, Tracks and Settings need one shared binding; Settings' DAW category is global-only (`Settings.tsx:19`). Recommendation: one `ProjectLinkDawFile` binding; the Settings panel gains a per-project scope or just links to the pill's action.

## Users & Context

**Primary User**: an independent narrator, using the standalone app or launching from REAPER; Windows first.
**Current behavior**: browses to a folder to create a project; reaches Tracks whether or not a DAW file exists; if REAPER is closed, starts it by hand and then runs the launcher action.
**Trigger**: starting a book, reopening a book days later, or launching the app on its own.
**Success state**: New Project is a name and a click; the project remembers its REAPER file; the app tells the narrator when REAPER has a different file open and can open the right one.
**Job to Be Done**: When I start or resume a book, I want the app to know where the project and its DAW file live, so I can work without hunting folders or wondering which session I am editing.
**Non-Users**: narrators who never open the app outside REAPER (unchanged behavior via the launcher); developers running from a checkout.

## Solution Detail

| Priority | Capability | Cap |
| --- | --- | --- |
| Must | `~/NarrationUtils` created on first run; global projects-directory setting with Go-side default and validation | Workspace |
| Must | New Project dialog: name, location (defaults to the projects directory), inline validation (collision, illegal characters, reserved names, unwritable) | Workspace |
| Must | Picker lists projects in the projects directory plus recents; "Open existing folder..." kept | Workspace |
| Must | Project manifest holding the DAW file link; migration from `Tracks.selectedRpp` and a sole `.rpp` | Link |
| Must | Tracks nav and route disabled, with a reason, until a DAW file is linked; Tracks page can choose the file (`*.rpp` open dialog, replacing the folder-listing picker) | Link |
| Must | Launcher passes `--project-file`; second launch maps the file back to its project | Link |
| Should | Lua and transcript changes so the rpp may live outside the project folder | Link |
| Should | "Open project matches" check through a new bridge command or event | Verify |
| Should | Launch REAPER on the linked file when no live bridge is reachable | Launch |
| Must | Proofing gated together with Tracks through one availability function of Bootstrap flags (`linked`, later `reachable`), replacing the four copies of the manuscript gate (`AppShell.tsx:52`, `App.tsx:169-172,199-215`, `Home.tsx:44,339,367`); Home card copy made truthful for Standalone | Link |
| Must | Go guard: the transcript `Start` checks the bridge before mutating state and before the Whisper download prompt, so `preparing` can never be stuck | Link |
| Must | Header pill reads "No DAW detected" when no DAW file is linked, is a focusable button, and opens the `*.rpp` dialog (`ProjectLinkDawFile`), with a tooltip saying what it does | Link |
| Should | Bootstrap and header pill show linked / reachable / matches separately; Settings DAW panel stops claiming "Connected" for `Standalone` and shows a per-project link control | Verify |
| Could | Project templates or scaffolding beyond the manifest | Workspace |
| Won't | Moving projects on directory change, other DAWs, editing REAPER's configuration | - |

**User flow**
- **First run**: the app creates `~/NarrationUtils`, shows the picker with an empty Recent list and **New Project**.
- **New Project**: dialog with Name and Location (`~/NarrationUtils` prefilled, Change... opens a folder dialog); errors appear under the field; Create makes the folder and manifest and opens it. Tracks is disabled with "Link a REAPER project to use Tracks" until a file is linked from Tracks or Settings.
- **From REAPER**: the launcher passes the rpp; the app attaches, records the link, and Tracks is enabled.
- **Reopen with REAPER closed**: the app shows the link is unreachable and offers "Open in REAPER"; after REAPER starts and the launcher action runs, the bridge reports the open project and the app confirms it matches (or warns).

## Technical Approach

**Feasibility**: Workspace HIGH; DAW link storage and gating HIGH; launcher, verification and launch MEDIUM-LOW (Lua, no tests, several unverified REAPER behaviors).

**Architecture notes**
- New small Go package (for example `apps/desktop/internal/project`) owning the manifest (`project.json`: name, `dawProjectFile` {absolute, relative}, created date) with atomic writes, and the projects-directory helpers (default resolution, validation, scan). `Host` reads it through the `h.services()` snapshot (`docs/architecture/host-binding-concurrency.md`); every attach still goes through `canAttachLocked` (`app.go:467`) before any `MkdirAll`.
- `tracks.Discover` reads the manifest first, then falls back to today's folder listing; `tracksSelect` accepts a path outside the folder only when chosen through the new file dialog (precedent: `ManuscriptSelectFile`, `bindings.go:251-267`), and the media allowlist follows `tracksList` unchanged.
- UI: a `NewProjectDialog` on the existing `Dialog`/`Field` primitives (ADR 0001 width and overflow, ADR 0002 action row); a per-item disabled reason in `AppShell.tsx` (today one shared `MANUSCRIPT_REQUIRED_REASON`); `/tracks` redirects like the manuscript routes. New primitives need stories (`atlasCoverage.test.ts`).
- Lua (`NarrationUtils_Launcher.lua`, `narration_ui_bridge.lua`): pass `--project-file`; any new command or event is added to the single dispatcher (`:511-560`). No automated tests exist, so every Lua change has a written manual REAPER checklist (as in `docs/architecture/manuscript-line-identity.md`) and `stylua --check`.
- Launching REAPER: a detached `exec.Command` behind an interface so tests use a fake; not the process supervisor.
- New ADR (next free number at merge time, 0037 at dc9d01a) supersedes ADR 0030 decisions 3-5 where changed: projects directory, manifest, `--project-file`, recents pruning.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Existing projects suddenly show Tracks disabled | Medium | Migration and auto-adopt of a sole `.rpp` (W3), tested on Alice-style fixtures |
| Decoupling the project folder from the rpp folder breaks Transcript Compare | High if done partially | Deliver Lua, `transcript/service.go` and guard changes together with a manual REAPER checklist (W4) |
| Second launch replaces the user's chosen project | Medium | Map the rpp to its project through the manifest before attaching |
| Lua changes with no automated tests | High | Manual checklist as a merge gate (`full-verification-gate`); keep Lua changes minimal and add the Go side behind interfaces |
| `ProjectCreate` rework builds on the delivered host binding work | Low | `ProjectCreate` already checks for a busy host before it creates the folder and requires an absolute path (`docs/architecture/host-binding-concurrency.md`); write the new binding on `h.services()`; bump `hostAPIVersion` once |
| Path handling on Windows (case, separators, OneDrive-redirected home, reserved names like `CON`) | Medium | Normalize and compare case-insensitively; table tests for validation |
| REAPER cannot be started with a script argument or detected reliably | Medium | Phase 6 spike decides before any code; fall back to "Open in REAPER" plus manual launcher action |
| Tracks visual states and screenshots become unreachable | High | Update `state-catalog.ts`, drivers, `doc-screenshots.json` and the guides in the same phase (`visual-catalog-sync`, `doc-screenshot-sync`) |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Projects directory | Go helpers, first-run creation, global setting with validation, Settings control, Bootstrap field, tests | pending | 3 (files differ) | - | - |
| 2 | New Project dialog | `ProjectCreateIn`, validation, `NewProjectDialog`, picker rewrite, API bump, states, docs, ADR | pending | - | 1 | - |
| 3 | Project manifest and DAW link storage | `project.json`, migration from `Tracks.selectedRpp`/sole `.rpp`, `Bootstrap.dawProjectFile`, `tracks` reads the manifest, file-open dialog binding, API bump | pending | 1 | - | - |
| 4 | Tracks and Proofing gating, pill and choose-file flow | One availability predicate, per-item nav reasons, `/tracks` and `/proofing` redirects, Home card copy, pill as a "No DAW detected" button that links the file, Tracks chooses/changes the file, retire `RppPicker`/no-rpp states, `?mockNoDaw=1` seam, tests, catalog, docs | pending | - | 3 | - |
| 5 | REAPER launcher passes the file | `--project-file`, second-launch mapping, unsaved-project handling, rpp outside the folder (Lua and transcript paths); manual REAPER sign-off | partial | - | 3 | - |
| 6 | Spike: reachability, verification and launch | Heartbeat or `report_project`, `reaper.exe` discovery and detached launch, auto-running the launcher (W10-W12); docs and ADR only | done | 1-5 | - | - |
| 7 | Open-project verification | Bridge command or event, match check, header/status states, Go and manual tests | pending | - | 5, 6 | - |
| 8 | Launch DAW on the project | DAW executable setting, detached launch behind an exec seam, "Open in REAPER" action, states | pending | - | 4, 6 | - |

### Phase Details

**Phase 1 - Projects directory**
- **Goal**: a per-user projects directory exists and is configurable.
- **Scope**: resolve `~/NarrationUtils` (`USERPROFILE`/`HOME`), create it on first run without failing startup, global-only setting with absolute-path and writability validation, Settings control, `Bootstrap` exposes it.
- **Success signal**: Go tests with a temp home (first run, existing, unwritable, invalid path); Settings visual states at four viewports reviewed.

**Phase 2 - New Project dialog**
- **Goal**: create a project by name, in the projects directory or a chosen location.
- **Scope**: `ProjectCreateIn(parent, name)` with a busy pre-check before any `MkdirAll` (`canAttachLocked`), name sanitisation, collision handling; `NewProjectDialog`; picker lists directory projects plus recents and keeps "Open existing folder..."; recents no longer silently prune unreachable entries (W8); API bump; `getting-started.md` and the `project-picker` screenshot; the ADR superseding ADR 0030's create and recents decisions.
- **Success signal**: Go table tests; `ProjectPicker.test.tsx` rewritten; PNGs reviewed at all four viewports for default, changed location and each error.

**Phase 3 - Project manifest and DAW link storage**
- **Goal**: the project remembers its DAW file.
- **Scope**: manifest package, migration and fallback rules (W1-W3), `tracksDiscover`/`tracksList` read it, an open-file dialog for `*.rpp`, `Bootstrap.dawProjectFile` and capability flags (`dawLinked`, later `dawReachable`), a shared `ProjectLinkDawFile` binding used by the pill, Tracks and Settings, the Go nil-bridge guard in `transcript.Start` (check before mutating state and before the Whisper prompt) with its missing test, contract, client, mock, API bump.
- **Success signal**: migration tests; an existing project behaves as before with no prompt.

**Phase 4 - Tracks gating and choose-file flow**
- **Goal**: Tracks is enabled only with a linked DAW file, and the user can link one.
- **Scope**: per-item disabled reason in `AppShell.tsx`/`NavButton`, `/tracks` redirect, link/unlink/change controls on the Tracks page and Settings, `App.test.tsx:159-172` updated, visual rows added or re-driven (a locked-nav state has a precedent in `proofing/disabled-button`, `state-catalog.ts:75-80`), guides (`navigation.md:20`, `tracks.md`), screenshots.
- **Success signal**: PNGs reviewed at four viewports for disabled and enabled; the visual suite green with no unexplained identical renders.

**Phase 5 - REAPER launcher passes the file**
- **Goal**: REAPER-launched projects arrive with their DAW file, and a second launch does not replace the chosen project.
- **Scope**: launcher `--project-file`, `parseConfigArgs`, `onSecondInstance` mapping, empty (unsaved) handling, Lua `prepare_compare` and transcript paths using the app's project folder when the rpp is elsewhere (W4).
- **Success signal**: Go tests for parsing and mapping; manual REAPER checklist run (both launcher paths, a project with the rpp outside the folder, Transcript Compare prepare/jump/export).
- **Status: partial.** Delivered: the launcher passes `--project-file` (Lua harness tests, no other launcher behavior changed); `apps/desktop/internal/project/match.go`'s `FindByDawFile` and `app.go`'s `resolveProjectFile` map the rpp back to its linked project on both the first launch (`Startup`) and a second launch (`onSecondInstance`), overriding the rpp's own folder when a link exists elsewhere (W4/W5); no match (or an unsaved rpp) falls back to the existing picker/rpp-folder behavior unchanged (W6), with a `system:attached` explanatory reason emitted (W5; no UI added to display it in this phase). W18's gating fix (`dawLinkFacts` treats a live `--daw REAPER` launch as linked) shipped alongside it. **Not delivered, deferred to a follow-up phase**: `narration_compare.lua`'s `prepare_compare` and the transcript path resolution in `apps/desktop/internal/transcript` still assume the project folder and the rpp's folder are the same one - the W4 decoupling there is real Lua+transcript work with no test harness precedent to lean on and was out of this phase's reduced scope. No REAPER was available to run the manual checklist (owner-only input, `docs/prds/implementation-plan.md` section 2); recorded as pending, not skipped silently.

**Phase 6 - Spike: reachability, verification and launch**
- **Goal**: decide W10-W12 before building Phases 7 and 8.
- **Scope**: prove on a real REAPER whether a heartbeat/`report_project` is viable, whether `reaper.exe <rpp>` and a script argument work, where the executable can be found, and what happens with unsaved projects; ADR with the result, or "defer".
- **Success signal**: a written decision.
- **Status: done.** All three resolved with clean evidence from a real, isolated REAPER 7.80 (`docs/research/reaper-spike-s6-daw-reachability.md`, [ADR 0090](../adr/0090-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md)). W10: `EnumProjects(-1,'')` confirmed to return the active tab's path for a saved project and the empty string (never `nil`) for an unsaved one, matching the PRD's own evidence claim; a file-based heartbeat is viable, but the recommended Phase 7 mechanism is an `events.log` event reusing `events.go`'s existing empty-run-ID broadcast, not a new polled file. W11: resolved and landed as code - `apps/desktop/internal/daw` (`LocateReaperExecutable`, `Resolve`) finds `reaper.exe` via the Windows Uninstall registry key, falls back to the `.rpp` file association, and lets a Settings override win, verified against the real install on the development machine. W12: confirmed - `reaper.exe -cfgfile <cfg> "<project.rpp>" "<script.lua>"` runs the script automatically at startup with the project already open (REAPER 6.80+, confirmed on 7.80), unblocking Phase 8's auto-start flow behind the D10 Settings toggle (default OFF). **Not delivered, intentionally deferred to Phases 7 and 8**: the Lua heartbeat/defer loop, the `events.log` wire-table row, `daw.Reachable()`/`daw.CurrentProject()`, the Settings DAW panel and override field, and the detached-launch action - this phase is docs, a spike script and the (inert, fully unit-tested) executable locator only, per its own scope line.

**Phase 7 - Open-project verification**
- **Goal**: confirm the project open in the DAW is the linked file.
- **Scope**: the chosen bridge mechanism, normalized case-insensitive comparison, a mismatch state in the UI, Go tests, manual checklist.
- **Success signal**: mismatch reported on a real REAPER; matching sessions show no warning.

**Phase 8 - Launch DAW on the project**
- **Goal**: start REAPER on the linked file when no bridge is reachable.
- **Scope**: DAW executable setting, detached launch behind an interface (fake in tests), "Open in REAPER" action and its states, Settings DAW panel made truthful.
- **Success signal**: REAPER starts on the linked file and survives closing the app; Go tests with a fake launcher including not-found.

**Parallelism Notes**: Phases 1 and 3 touch different Go packages and can run together (both edit `Bootstrap`, so rebase). Phase 2 follows 1; 4 and 5 follow 3; Phase 6 is docs plus scratch work and can start any time; 7 and 8 wait on it.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | new `apps/desktop/internal/project`, `apps/desktop/app.go` (`NewHost`/`Startup`), `fieldSchemas`, `Settings.tsx`, `system.ts`, mock | Other `fieldSchemas`/`Settings.tsx` editors (teleprompter, diagnostics, story-bible PRDs) |
| 2 | `apps/desktop/bindings.go`, `apps/desktop/app.go`, `ProjectPicker.tsx`, new dialog, `hostApi.ts`, `Host.*`, `wailsClient.ts`, `mockApi.ts`, catalog/drivers, `getting-started.md` | the delivered host binding concurrency work (`ProjectCreate` and `bindings.go`, `docs/architecture/host-binding-concurrency.md`), every phase that bumps `hostAPIVersion` |
| 3 | `apps/desktop/internal/{project,tracks}`, `apps/desktop/tracks.go`, `apps/desktop/media.go`, `Bootstrap`, contracts, mock | Analysis PRDs that cite `Tracks.selectedRpp` (`analysis-evidence-ledger.prd.md:18`), API bump |
| 4 | `AppShell.tsx` (nav and the pill markup, which regenerates every screenshot), `NavButton.tsx`, `App.tsx`, `Home.tsx` (Proofing card), `Transcript.tsx`, `TracksPage.tsx`, `Settings.tsx`, `main.tsx`/mock, catalog/drivers, `doc-screenshots.json`, guides | Nav-item additions (each regenerates every screenshot; see README sequencing), dialog/a11y PRDs, the import review redesign (delivered) and the other `Home.tsx` editors, `proofing-vocabulary-hints.prd.md` (`Transcript.tsx`) |
| 5 | `integrations/reaper/{NarrationUtils_Launcher,narration_ui_bridge}.lua`, `apps/desktop/app.go`, `apps/desktop/internal/transcript` | `reaper-automation-follow-through.prd.md` (Lua dispatcher), the delivered launcher rename ([ADR 0073](../adr/0073-the-executable-is-named-narration-utils-and-carries-its-version.md)) and its harness tests, transcript and take-review PRDs |
| 6 | `docs/` only, scratch REAPER scripts out of tree | ADR numbering |
| 7 | Lua dispatcher, `apps/desktop/internal/bridge`, transcript reader, `Bootstrap`, header pill | Same Lua dispatcher PRDs |
| 8 | new launcher package, `fieldSchemas`, `Settings.tsx`, `Bootstrap`, `AppShell.tsx`, mock | `fieldSchemas`/Settings editors, API bump |

Cross-cutting: every phase re-checks `docs/adr/` numbering before writing an ADR and re-checks `hostAPIVersion` at merge time; every `apps/ui` phase runs `visual-catalog-sync`, the Playwright visual suite with PNG review at all four viewports, and `doc-screenshot-sync`; Phases 5, 7 and 8 need manual REAPER verification (`integrations/reaper` has no tests); each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `design-spec-guard`, `feature-cleanup`.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| App may start without a project; recents per user (prior, ADR 0030) | Kept; recents pruning and create-new are amended | - | Standing decision, partly superseded |
| Lua file bridge verified by hand (prior, ADR 0031) | Any new bridge command has a manual checklist | Automated Lua tests | Standing decision |
| Windows first (prior) | `~/NarrationUtils` via `USERPROFILE` | Cross-platform now | Standing scope |
| Projects directory default | `~/NarrationUtils`, user-changeable (from the request) | Fixed location | Requested |
| Link storage | Per-project manifest (proposed) | `settings.json` key | Manifest also marks projects for the directory scan |
| Path form | Store absolute and relative (proposed) | Absolute only | Survives moves |
| Sole `.rpp` | Auto-adopt (proposed) | Always ask | No regression for existing projects |
| Sequence | Workspace, then link, then spike, then verify/launch (proposed) | One large change | Independent value, lower risk first |
| Launching REAPER | Detached spawn behind an interface; never the supervisor (proposed) | Reuse supervisor | Kill-on-close job would end REAPER with the app |

## Research Summary

**Technical Context**: verified in code on this branch: bootstrap and attach flow, `ProjectCreate`, recents store, Tracks discovery and its guard, media allowlist, launcher arguments, Lua dispatcher commands, settings layers and `fieldSchemas`, picker UI and tests, visual rows and doc screenshots.
**Not verified**: that `reaper.exe <rpp>` works, that REAPER accepts a script argument, how to locate `reaper.exe`, whether `EnumProjects(-1,'')` reflects the intended project in a multi-tab session, first-run behavior with a OneDrive-redirected home folder, and how the Wails file dialog behaves for `*.rpp` filters on this machine.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
